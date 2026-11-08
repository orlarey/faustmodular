/*				RECORDER.TS
    ● Record, in the transport (Documentation/STORE-SPEC.md, "Enregistrer depuis faustmodular"): the main output of
    the scene, after the volume and the limiter (what one hears), sample by sample, by an AudioWorklet in parallel
    of the device (its output to a gain of 0: it is processed, nothing is heard twice).

    - It starts at the start of a bar (src/audio/Recording.ts): the next one while the transport plays; when it is
      stopped, the transport starts and the recording with it (at the start of the bar if it stood there).
    - It lasts a number of bars, or until it is stopped (● again, or ■ of the transport, here or in another
      application). A change of tempo while recording moves its end to the right sample.
    - The file, WAV 24 bits, is downloaded: `<scene>-YYYYMMDD-HHMMSS.wav`. The recording is kept with its
      description (the material of the store, its timeline in ticks), for publishing it with its scene later.
*/

import { barsEnd, barStart, encodePcm24Wav, joinBlocks, recordingName, ticksPerBar } from "./Recording";
import type { SharedTimeline } from "../sync/SharedTimeline";
import type { TimelineRule } from "../sync/TimelineCore";

const PROCESSOR = `
registerProcessor("faustmodular-recorder", class extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.channels = options.processorOptions.channels;
        this.start = null;
        this.end = null;
        this.done = false;
        this.started = false;
        this.alloc();
        this.port.onmessage = (e) => {
            const m = e.data;
            if (m.type == "arm") { this.start = m.start; this.end = m.end; }
            else if (m.type == "end") this.end = m.end;
            else if (m.type == "abort") this.done = true;
        };
    }
    alloc() {
        this.block = [];
        for (let c = 0; c < this.channels; c++) this.block.push(new Float32Array(4096));
        this.fill = 0;
    }
    ship() {
        if (this.fill == 0) return;
        const chunk = this.block.map((b) => b.slice(0, this.fill));
        this.port.postMessage({ type: "block", chunk }, chunk.map((b) => b.buffer));
        this.alloc();
    }
    process(inputs) {
        if (this.done) return false;
        const input = inputs[0] || [];
        const length = input[0] ? input[0].length : 128;
        const f0 = currentFrame;
        if (this.start === null) return true;
        const a = Math.max(f0, this.start);
        const b = this.end === null ? f0 + length : Math.min(f0 + length, this.end);
        if (!this.started && b > a) {
            this.started = true;
            this.port.postMessage({ type: "started", frame: a });
        }
        for (let i = a; i < b; i++) {
            for (let c = 0; c < this.channels; c++) this.block[c][this.fill] = input[c] ? input[c][i - f0] : 0;
            if (++this.fill == 4096) this.ship();
        }
        if (this.end !== null && f0 + length >= this.end) {
            this.ship();
            this.port.postMessage({ type: "done", frame: this.end });
            this.done = true;
            return false;
        }
        return true;
    }
});
`;

export type RecorderState = "idle" | "waiting" | "recording" | "writing";

export interface RecordingResult {
    name: string;
    blob: Blob;
    sampleRate: number;
    channels: number;
    frames: number;
    clipped: number;
    // the material of the store (Documentation/STORE-SPEC.md, "Les matériaux"), without its media and its recipe yet
    material: {
        format: "fauststore-material"; version: 1; kind: "recording"; name: string;
        sampleRate: number; channels: number; frames: number;
        generator: string;
        timeline: { tempo: number; meter: number; startTick: number; lengthTicks: number };
        live: string[];
        date: string;
    };
}

export interface RecorderSetup {
    context: AudioContext;
    sync: SharedTimeline;
    source: () => AudioNode;                    // the main output, after the volume and the limiter
    channels: () => number;
    scene: () => string;
    generator: string;
    live: () => string[];                       // what the recipe does not replay (microphone, sync…)
    done: (result: RecordingResult) => void;
    failed: (error: unknown) => void;
}

export class Recorder {
    state: RecorderState = "idle";
    bars: number | null = null;                 // the length asked, null: until stopped
    startTick = 0;
    startFrame = 0;
    last: RecordingResult | null = null;
    private fNode: AudioWorkletNode | null = null;
    private fSink: GainNode | null = null;
    private fBlocks: Float32Array[][] = [];
    private fChannels = 2;
    private fLoaded: Promise<void> | null = null;
    private fListeners: Array<() => void> = [];
    private fRule: TimelineRule | null = null;
    private fDate = new Date();
    private fLive = new Set<string>();

    constructor(private fSetup: RecorderSetup) {
        // the timeline changed (tempo, stop, another application): the end follows
        fSetup.sync.onChange(() => this.follow());
    }

    onChange(listener: () => void): void {
        this.fListeners.push(listener);
    }

    private emit(): void {
        this.fListeners.forEach((l) => l());
    }

    private load(): Promise<void> {
        if (!this.fLoaded) {
            const url = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
            this.fLoaded = this.fSetup.context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
        }
        return this.fLoaded;
    }

    // The position in bars since the start (for the display), while recording.
    elapsedBars(): number {
        if (this.state != "recording" && this.state != "waiting") return 0;
        const beats = this.fSetup.sync.positionNow();
        return Math.max(0, (beats * 960 - this.startTick) / ticksPerBar(this.fSetup.sync.timeline.meter));
    }

    // Starts a recording of `bars` bars (null: until stopped), at the next start of a bar.
    async start(bars: number | null): Promise<void> {
        if (this.state != "idle") return;
        const { context, sync } = this.fSetup;
        this.bars = bars;
        this.state = "waiting";
        this.emit();
        try {
            await this.load();
            if (context.state != "running") await context.resume();
            // stopped: the transport starts, and the recording with it
            if (!sync.timeline.playing) sync.operate({ type: "play" });
            const rule = sync.rule;
            // 50 ms ahead at least: the time for the message to reach the processor
            const now = Math.ceil(context.currentTime * context.sampleRate + 0.05 * context.sampleRate);
            const at = rule ? barStart(rule, now) : null;
            if (!rule || !at) throw new Error("the transport does not play");
            this.fRule = rule;
            this.startTick = at.tick;
            this.startFrame = at.frame;
            this.fChannels = Math.max(1, this.fSetup.channels());
            this.fBlocks = [];
            this.fDate = new Date();
            this.fLive = new Set(this.fSetup.live());
            if (sync.peers.length > 0) this.fLive.add("sync");     // another application plays with this one
            const node = new AudioWorkletNode(context, "faustmodular-recorder", {
                numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
                channelCount: this.fChannels, channelCountMode: "explicit", channelInterpretation: "discrete",
                processorOptions: { channels: this.fChannels },
            });
            const sink = context.createGain();
            sink.gain.value = 0;
            node.connect(sink).connect(context.destination);
            this.fSetup.source().connect(node);
            node.port.onmessage = (e) => this.receive(e.data);
            this.fNode = node;
            this.fSink = sink;
            const end = bars ? barsEnd(rule, at.tick, bars) : null;
            node.port.postMessage({ type: "arm", start: at.frame, end });
        } catch (e) {
            this.reset();
            this.fSetup.failed(e);
        }
    }

    // Stops it now (● again): what was recorded is kept. Waiting for its bar: nothing.
    stop(): void {
        if (!this.fNode) return;
        if (this.state == "waiting") {
            this.fNode.port.postMessage({ type: "abort" });
            this.reset();
            return;
        }
        if (this.state != "recording") return;
        const { context } = this.fSetup;
        this.fNode.port.postMessage({ type: "end", end: Math.ceil(context.currentTime * context.sampleRate) });
    }

    // The timeline changed: a new tempo moves the end of a recording of some bars; the transport stopped ends it.
    private follow(): void {
        if (!this.fNode || (this.state != "recording" && this.state != "waiting")) return;
        const sync = this.fSetup.sync, rule = sync.rule;
        if (!rule || rule === this.fRule) return;
        this.fRule = rule;
        if (!rule.playing) {
            if (this.state == "waiting") { this.stop(); return; }
            this.fNode.port.postMessage({ type: "end", end: rule.frame });
            return;
        }
        if (this.state == "waiting") {
            const at = barStart(rule, Math.ceil(this.fSetup.context.currentTime * this.fSetup.context.sampleRate + 0.05 * this.fSetup.context.sampleRate));
            if (at) {
                this.startTick = at.tick;
                this.startFrame = at.frame;
                this.fNode.port.postMessage({ type: "arm", start: at.frame, end: this.bars ? barsEnd(rule, at.tick, this.bars) : null });
            }
        } else if (this.bars) {
            const end = barsEnd(rule, this.startTick, this.bars);
            if (end !== null) this.fNode.port.postMessage({ type: "end", end });
        }
    }

    private receive(m: any): void {
        if (m?.type == "started") {
            this.startFrame = m.frame;
            this.state = "recording";
            this.emit();
        } else if (m?.type == "block") {
            this.fBlocks.push(m.chunk);
        } else if (m?.type == "done") {
            this.finish();
        }
    }

    private finish(): void {
        const { context, sync } = this.fSetup;
        this.state = "writing";
        this.emit();
        try {
            const channels = joinBlocks(this.fBlocks, this.fChannels);
            const frames = channels[0]?.length ?? 0;
            const { bytes, clipped } = encodePcm24Wav(channels, context.sampleRate);
            const name = recordingName(this.fSetup.scene(), this.fDate);
            const t = sync.timeline;
            const rule = this.fRule;
            // its length in ticks, from its samples at the tempo it ended with
            const lengthTicks = rule ? Math.round(frames * rule.inc / rule.den) : 0;
            const result: RecordingResult = {
                name, blob: new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" }), sampleRate: context.sampleRate, channels: this.fChannels, frames, clipped,
                material: {
                    format: "fauststore-material", version: 1, kind: "recording", name: name.replace(/\.wav$/, ""),
                    sampleRate: context.sampleRate, channels: this.fChannels, frames,
                    generator: this.fSetup.generator,
                    timeline: { tempo: rule?.tempo ?? t.tempo, meter: rule?.meter ?? t.meter, startTick: this.startTick, lengthTicks },
                    live: [...this.fLive].sort(),
                    date: this.fDate.toISOString().replace(/\.\d+Z$/, "Z"),
                },
            };
            this.last = result;
            this.reset();
            this.fSetup.done(result);
        } catch (e) {
            this.reset();
            this.fSetup.failed(e);
        }
    }

    private reset(): void {
        try { this.fSetup.source().disconnect(this.fNode!); } catch { /* not connected */ }
        this.fNode?.disconnect();
        this.fSink?.disconnect();
        this.fNode = null;
        this.fSink = null;
        this.fBlocks = [];
        this.state = "idle";
        this.emit();
    }
}
