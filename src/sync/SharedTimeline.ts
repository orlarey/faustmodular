/*				SHAREDTIMELINE.TS
    faust-sync in an application (Documentation/FAUST-SYNC-SPEC.md): the timeline shared with the other Faust
    applications of the browser over a BroadcastChannel, and the Timeline node that gives its position at every
    sample of this application's audio context.

    - The protocol (§ 6): `hello` at the opening, answered by every other application with its timeline and a fresh
      anchor (the position now, on its own audio clock); `state` at every operation; the most recent revision wins.
    - The translation (§ 7.1): an anchor, in common time, becomes a sample of the context by getOutputTimestamp
      (the instant that comes out of the speaker): two applications that aim at the same common time aim at the same
      audible instant. The offset between the two clocks is the median of the last readings.
    - Then the position advances in samples (§ 7.2, TimelineCore.ts): on one sound card, the tabs count their
      samples together, without drift.
*/

import { apply, beatAt, newer, newTimeline, Operation, Timeline } from "./Timeline";
import { TIMELINE_CHANNELS, TimelineCore, TimelineRule } from "./TimelineCore";

export const SYNC_CHANNEL = "faust-sync";
export const SYNC_VERSION = 1;
const READINGS = 11;            // getOutputTimestamp readings in the median
const READ_EVERY = 100;         // ms
const RETRANSLATE = 1;          // ms: the estimate of the clocks moved that much, the timeline is translated again

export type SyncMessage =
    | { protocol: "faust-sync"; version: number; type: "hello"; origin: string }
    | { protocol: "faust-sync"; version: number; type: "state"; origin: string; timeline: Timeline };

export const commonNow = () => performance.timeOrigin + performance.now();

// The AudioWorkletProcessor: TimelineCore, fed with rules by its port.
const PROCESSOR = `${TimelineCore.toString()}
registerProcessor("faust-sync-timeline", class extends AudioWorkletProcessor {
    constructor() {
        super();
        this.core = new TimelineCore(sampleRate);
        this.port.onmessage = (e) => this.core.schedule(e.data);
    }
    process(inputs, outputs) {
        const out = outputs[0];
        this.core.render(currentFrame, out, out[0] ? out[0].length : 128);
        return true;
    }
});`;

export class SharedTimeline {
    readonly origin: string;
    timeline: Timeline;
    // the timeline in samples of this context (TimelineCore), for the positions read here
    private fRule: TimelineRule | null = null;
    private fNode: AudioWorkletNode | null = null;
    private fSplitter: ChannelSplitterNode | null = null;
    private fChannel: BroadcastChannel | null = null;
    private fOffsets: number[] = [];            // contextTime·1000 − performanceTime (ms), the last readings
    private fUsedOffset: number | null = null;  // the estimate the timeline was translated with
    private fListeners: Array<() => void> = [];
    peers = new Set<string>();                  // the other applications heard from

    constructor(private fContext: AudioContext, app: string) {
        const id = typeof crypto != "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
        this.origin = `${app}:${id}`;
        // a fresh timeline: older than any change (revision 0), so that an answer replaces it
        this.timeline = newTimeline(commonNow(), this.origin);
        this.timeline.revision.time = 0;
    }

    // The node and the channel; `hello` to the others.
    async start(): Promise<void> {
        const url = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
        await this.fContext.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.fNode = new AudioWorkletNode(this.fContext, "faust-sync-timeline", {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [TIMELINE_CHANNELS.length],
        });
        this.fSplitter = this.fContext.createChannelSplitter(TIMELINE_CHANNELS.length);
        this.fNode.connect(this.fSplitter);
        this.read();
        setInterval(() => this.read(), READ_EVERY);
        // after a suspension, the samples did not advance: the timeline is translated again
        this.fContext.addEventListener("statechange", () => { if (this.fContext.state == "running") this.translate(); });
        this.translate();
        if (typeof BroadcastChannel == "function") {
            this.fChannel = new BroadcastChannel(SYNC_CHANNEL);
            this.fChannel.onmessage = (e) => this.receive(e.data);
            this.post({ protocol: "faust-sync", version: SYNC_VERSION, type: "hello", origin: this.origin });
        }
    }

    // The channels of the Timeline node (beat, run, start, tempo, meter), to feed the reserved inputs of a module.
    get output(): ChannelSplitterNode | null {
        return this.fSplitter;
    }

    onChange(listener: () => void): void {
        this.fListeners.push(listener);
    }

    // An operation of this application (the transport), shared at once.
    operate(op: Operation): void {
        const next = apply(this.timeline, op, commonNow(), this.origin, (time) => this.positionAt(time));
        if (next === this.timeline) return;
        this.adopt(next);
        this.post({ protocol: "faust-sync", version: SYNC_VERSION, type: "state", origin: this.origin, timeline: next });
    }

    // The position at a common time, as this application plays it (its samples); by the rule before the node.
    positionAt(time: number): number {
        const rule = this.fRule;
        if (!rule || !this.mapped()) return beatAt(this.timeline, time);
        const frame = this.frameOf(time);
        // a rule not yet in effect: the position it will have
        return rule.playing ? rule.beat + (frame - rule.frame) * rule.tempo / (60 * this.fContext.sampleRate) : rule.beat;
    }

    // The sample of this context that comes out of the speaker at a common time.
    frameOf(time: number): number {
        const offset = this.offset();
        return (time - performance.timeOrigin + offset) / 1000 * this.fContext.sampleRate;
    }

    /******************** PRIVATE ********************/

    private receive(message: SyncMessage): void {
        if (!message || message.protocol != "faust-sync" || message.version != SYNC_VERSION || message.origin == this.origin) return;
        this.peers.add(message.origin);
        if (message.type == "hello") {
            // the timeline with a fresh anchor: the position now, on this audio clock; the same revision
            const now = commonNow();
            const timeline: Timeline = { ...this.timeline, anchor: { time: now, beat: this.positionAt(now) } };
            this.post({ protocol: "faust-sync", version: SYNC_VERSION, type: "state", origin: this.origin, timeline });
            this.emit();
            return;
        }
        if (newer(message.timeline, this.timeline)) this.adopt(message.timeline);
        else this.emit();
    }

    private adopt(timeline: Timeline): void {
        this.timeline = timeline;
        this.translate();
        this.emit();
    }

    // The timeline, from common time to samples, to the node.
    private translate(): void {
        const t = this.timeline;
        this.fUsedOffset = this.mapped() ? this.offset() : null;
        const rule: TimelineRule = { frame: Math.round(this.frameOf(t.anchor.time)), beat: t.anchor.beat, tempo: t.tempo, meter: t.meter, playing: t.playing };
        this.fRule = rule;
        this.fNode?.port.postMessage(rule);
    }

    private post(message: SyncMessage): void {
        try { this.fChannel?.postMessage(message); } catch { /* closed */ }
    }

    private emit(): void {
        this.fListeners.forEach((l) => l());
    }

    // A reading of the two clocks: the context time that comes out of the speaker at a performance time.
    private read(): void {
        if (this.fContext.state != "running" || typeof this.fContext.getOutputTimestamp != "function") return;
        const ts = this.fContext.getOutputTimestamp();
        if (!ts.contextTime || !ts.performanceTime) return;
        this.fOffsets.push(ts.contextTime * 1000 - ts.performanceTime);
        if (this.fOffsets.length > READINGS) this.fOffsets.shift();
        // the estimate of the clocks moved (the first readings after the context starts or resumes are off by
        // tens of ms; before any, the latency of the output was not known): the timeline translated again
        if (this.fUsedOffset === null || Math.abs(this.offset() - this.fUsedOffset) > RETRANSLATE) this.translate();
    }

    private mapped(): boolean {
        return this.fOffsets.length > 0;
    }

    // The median of the readings; before any (a context not yet running), the current time of the context.
    private offset(): number {
        if (this.fOffsets.length == 0) return this.fContext.currentTime * 1000 - performance.now();
        const sorted = [...this.fOffsets].sort((a, b) => a - b);
        return sorted[sorted.length >> 1];
    }
}
