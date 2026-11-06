/*				SHAREDTIMELINE.TS
    faust-sync in an application (Documentation/FAUST-SYNC-SPEC.md): the timeline shared with the other Faust
    applications of the browser over a BroadcastChannel, and the Timeline node that gives its position at every
    sample of this application's audio context.

    - The clock of the application (§ 7.1, ClockLine.ts): the time of its context that comes out of the speaker, at a
      time of the common clock, from getOutputTimestamp; published every 500 ms (`clock`).
    - The differences with the other clocks (§ 7.2, ClockOffset.ts): δ = t_other − t_self at the same common time,
      measured once both clocks are settled, and frozen. On one sound card, the samples of the applications advance
      together: δ does not change. Measured again only when a context resumes after a suspension (its time stopped).
    - The timeline (§ 4): its anchor is on the clock of the application that made the last change; each application
      translates it into samples of its context by δ, once (and again only when δ is frozen or measured again).
    - The protocol (§ 6): `hello` at the opening, answered by every other application with its timeline; `state` at
      every operation; the most recent revision wins.
*/

import { ClockLine, ClockLineMessage, lineAt } from "./ClockLine";
import { ClockOffset } from "./ClockOffset";
import { apply, ClockTime, LEAD, newer, newTimeline, Operation, rebase, Timeline } from "./Timeline";
import { TIMELINE_CHANNELS, TimelineCore, TimelineRule } from "./TimelineCore";

export const SYNC_CHANNEL = "faust-sync";
export const SYNC_VERSION = 2;
const READ_EVERY = 50;          // ms: a reading of getOutputTimestamp
const CLOCK_EVERY = 500;        // ms: the clock published
const ACTIVE = 3000;            // ms: an application not heard for longer has left
// s: a value of δ not yet frozen that moves more: the anchor translated again (the first values, while the clocks
// settle, move by a few ms: each correction would move the gates; the frozen value comes within about 10 s)
const RETRANSLATE = 0.002;

// The clock of an application, as it publishes it: `epoch` changes when its context resumes after a suspension.
export interface ClockPayload { epoch: number; sampleRate: number; line: ClockLineMessage | null }

export type SyncMessage =
    | { protocol: "faust-sync"; version: number; type: "hello"; origin: string }
    | { protocol: "faust-sync"; version: number; type: "clock"; origin: string; clock: ClockPayload }
    | { protocol: "faust-sync"; version: number; type: "state"; origin: string; timeline: Timeline; clock: ClockPayload };

export const commonNow = () => performance.timeOrigin + performance.now();

// The AudioWorkletProcessor: TimelineCore, fed with rules by its port. The class is bound to its name by an
// expression: the production build turns `class TimelineCore {…}` into `var TimelineCore = class {…}`, whose source
// is an anonymous class, not a statement.
export const processorSource = (core: string) => `const TimelineCore = (${core});
registerProcessor("faust-sync-timeline", class extends AudioWorkletProcessor {
    constructor() {
        super();
        this.core = new TimelineCore(sampleRate);
        this.reported = 0;
        this.port.onmessage = (e) => this.core.schedule(e.data);
    }
    process(inputs, outputs) {
        const out = outputs[0];
        this.core.render(currentFrame, out, out[0] ? out[0].length : 128);
        if (this.core.jumps != this.reported) {
            this.reported = this.core.jumps;
            this.port.postMessage({ jumps: this.reported });
        }
        return true;
    }
});
// The diagnosis of a module that reads the timeline: the clock gates on its first output, their period and width
// measured at the sample; any of them that differs from the one before by more than 2 samples is reported.
registerProcessor("faust-sync-probe", class extends AudioWorkletProcessor {
    constructor() {
        super();
        this.prev = 0; this.rise = -1; this.period = 0; this.width = 0;
    }
    process(inputs) {
        const c = inputs[0] && inputs[0][0];
        if (!c) return true;
        for (let i = 0; i < c.length; i++) {
            const x = c[i], frame = currentFrame + i;
            if (x > 0.5 && this.prev <= 0.5) {
                if (this.rise >= 0) {
                    const p = frame - this.rise;
                    if (this.period && Math.abs(p - this.period) > 2) this.port.postMessage({ kind: "period", value: p, expected: this.period });
                    this.period = p;
                }
                this.rise = frame;
            } else if (x <= 0.5 && this.prev > 0.5 && this.rise >= 0) {
                const w = frame - this.rise;
                if (this.width && Math.abs(w - this.width) > 2) this.port.postMessage({ kind: "width", value: w, expected: this.width });
                this.width = w;
            }
            this.prev = x;
        }
        return true;
    }
});`;
const PROCESSOR = processorSource(TimelineCore.toString());

export class SharedTimeline {
    readonly origin: string;
    timeline: Timeline;
    readonly clock = new ClockLine();
    private fEpoch = 0;
    private fEverReady = false;
    private fPeers = new Map<string, { offset: ClockOffset; line: ClockLineMessage | null; epoch: number; heard: number }>();
    // the timeline in samples of this context (TimelineCore), and the δ it was translated with
    private fRule: TimelineRule | null = null;
    private fTranslated: number | null = null;
    private fNode: AudioWorkletNode | null = null;
    private fSplitter: ChannelSplitterNode | null = null;
    private fChannel: BroadcastChannel | null = null;
    private fListeners: Array<() => void> = [];
    // the corrections of the position while playing the same timeline (a difference measured again), for the
    // diagnosis: when, why, by how much (s; positive: the position moved forward)
    readonly corrections: Array<{ T: number; reason: string; shift: number }> = [];
    // the blocks of the Timeline node that did not follow the one before; the irregular gates of the modules
    frameJumps = 0;
    readonly gates: Array<{ T: number; kind: string; value: number; expected: number }> = [];
    private fProbed = new WeakSet<AudioNode>();

    constructor(private fContext: AudioContext, app: string) {
        const id = typeof crypto != "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
        this.origin = `${app}:${id}`;
        // a new timeline: older than any change (revision 0), so that an answer replaces it
        this.timeline = newTimeline(this.origin);
    }

    // The node and the channel; `hello` to the others.
    async start(): Promise<void> {
        const url = URL.createObjectURL(new Blob([PROCESSOR], { type: "application/javascript" }));
        await this.fContext.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.fNode = new AudioWorkletNode(this.fContext, "faust-sync-timeline", {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [TIMELINE_CHANNELS.length],
        });
        this.fNode.onprocessorerror = (e) => console.warn("faust-sync: the Timeline node stopped", e);
        this.fNode.port.onmessage = (e) => { if (typeof e.data?.jumps == "number") this.frameJumps = e.data.jumps; };
        this.fSplitter = this.fContext.createChannelSplitter(TIMELINE_CHANNELS.length);
        this.fNode.connect(this.fSplitter);
        setInterval(() => this.read(), READ_EVERY);
        setInterval(() => this.announce(), CLOCK_EVERY);
        // after a suspension, the time of the context stopped: its clock and the differences are measured again
        this.fContext.addEventListener("statechange", () => {
            if (this.fContext.state != "running" || !this.fEverReady) return;
            this.fEpoch++;
            this.clock.reset();
            this.fPeers.forEach((p) => p.offset.reset());
            this.fTranslated = null;
            this.corrections.push({ T: commonNow(), reason: "resumed", shift: 0 });
            this.announce();
        });
        this.translate();
        if (typeof BroadcastChannel == "function") {
            this.fChannel = new BroadcastChannel(SYNC_CHANNEL);
            this.fChannel.onmessage = (e) => this.receive(e.data);
            this.post({ protocol: "faust-sync", version: SYNC_VERSION, type: "hello", origin: this.origin });
            this.announce();
        }
    }

    // The channels of the Timeline node (beat, run, start, tempo, meter), to feed the reserved inputs of a module.
    get output(): ChannelSplitterNode | null {
        return this.fSplitter;
    }

    get peers(): string[] {
        const now = commonNow();
        return [...this.fPeers].filter(([, p]) => now - p.heard < ACTIVE).map(([o]) => o);
    }

    onChange(listener: () => void): void {
        this.fListeners.push(listener);
    }

    // An operation of this application (the transport), shared at once: anchored on its clock, LEAD ms ahead.
    operate(op: Operation): void {
        const now = commonNow();
        const effect: ClockTime = { clock: this.origin, time: this.timeAt(now + LEAD) };
        const next = apply(this.timeline, op, now, this.origin, effect, (time) => this.positionAt(time));
        if (next === this.timeline) return;
        this.adopt(next);
        this.post({ protocol: "faust-sync", version: SYNC_VERSION, type: "state", origin: this.origin, timeline: next, clock: this.payload() });
    }

    // The time of this clock that comes out of the speaker at a common time (s); before the clock is ready, from the
    // time of the context.
    timeAt(T: number): number {
        if (this.clock.ready) return this.clock.at(T);
        return this.fContext.currentTime + (T - commonNow()) / 1000;
    }

    // The position at a time of this clock, as this application plays it (its samples); by the rule before the node.
    positionAt(time: number): number {
        const rule = this.fRule, t = this.timeline;
        if (!rule) return t.playing && t.anchor.clock == this.origin ? t.anchor.beat + (time - t.anchor.time) * t.tempo / 60 : t.anchor.beat;
        const frame = time * this.fContext.sampleRate;
        // a rule not yet in effect: the position it will have
        return rule.playing ? rule.beat + (frame - rule.frame) * rule.tempo / (60 * this.fContext.sampleRate) : rule.beat;
    }

    // The position that comes out of the speaker now.
    positionNow(): number {
        return this.positionAt(this.timeAt(commonNow()));
    }

    // δ to the clock of another application: t_other − t_self (s); 0 for this one; null if unknown.
    offsetTo(clock: string): number | null {
        if (clock == this.origin) return 0;
        return this.fPeers.get(clock)?.offset.value ?? null;
    }

    // The diagnosis of a module that reads the timeline (its node, after each compilation): its gates watched.
    probe(node: AudioNode): void {
        if (!this.fNode || this.fProbed.has(node) || node.numberOfOutputs == 0) return;
        this.fProbed.add(node);
        const probe = new AudioWorkletNode(this.fContext, "faust-sync-probe", {
            numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit", channelInterpretation: "discrete",
        });
        const sink = this.fContext.createGain();
        sink.gain.value = 0;
        node.connect(probe).connect(sink).connect(this.fContext.destination);
        probe.port.onmessage = (e) => {
            this.gates.push({ T: commonNow(), ...e.data });
            if (this.gates.length > 100) this.gates.shift();
        };
    }

    // For the tooltip of the transport: the other applications, the differences frozen, the corrections, the blocks
    // of the Timeline node that jumped, the irregular gates.
    diagnosis(): {
        peers: number; frozen: number; corrections: number; last: { shift: number; ago: number; reason: string } | null;
        frameJumps: number; gates: number; gate: { kind: string; value: number; expected: number; ago: number } | null;
    } {
        const peers = this.peers;
        const frozen = this.offsets().filter((o) => o.active && o.frozen).length;
        const last = this.corrections[this.corrections.length - 1];
        const gate = this.gates[this.gates.length - 1];
        return {
            peers: peers.length, frozen, corrections: this.corrections.length,
            last: last ? { shift: last.shift * 1000, ago: (commonNow() - last.T) / 1000, reason: last.reason } : null,
            frameJumps: this.frameJumps, gates: this.gates.length,
            gate: gate ? { kind: gate.kind, value: gate.value, expected: gate.expected, ago: (commonNow() - gate.T) / 1000 } : null,
        };
    }

    // The differences measured, for the diagnosis.
    offsets(): Array<{ origin: string; offset: number | null; frozen: boolean; active: boolean }> {
        const now = commonNow();
        return [...this.fPeers].map(([origin, p]) => ({ origin, offset: p.offset.value, frozen: p.offset.frozen !== null, active: now - p.heard < ACTIVE }));
    }

    /******************** PRIVATE ********************/

    private payload(): ClockPayload {
        return { epoch: this.fEpoch, sampleRate: this.fContext.sampleRate, line: this.clock.message() };
    }

    private announce(): void {
        this.post({ protocol: "faust-sync", version: SYNC_VERSION, type: "clock", origin: this.origin, clock: this.payload() });
    }

    private read(): void {
        if (this.fContext.state != "running" || typeof this.fContext.getOutputTimestamp != "function") return;
        const ts = this.fContext.getOutputTimestamp();
        if (!ts.contextTime || !ts.performanceTime) return;
        this.clock.add(performance.timeOrigin + ts.performanceTime, ts.contextTime);
        if (this.clock.ready && !this.fEverReady) {
            this.fEverReady = true;
            // the time of this clock now known: an anchor on it translated again (an operation before was estimated)
            if (this.timeline.anchor.clock == this.origin) this.translate("clock ready");
        }
    }

    private receive(message: SyncMessage): void {
        if (!message || message.protocol != "faust-sync" || message.version != SYNC_VERSION || message.origin == this.origin) return;
        const peer = this.peerOf(message.origin);
        peer.heard = commonNow();
        if (message.type == "hello") {
            this.post({ protocol: "faust-sync", version: SYNC_VERSION, type: "state", origin: this.origin, timeline: this.answer(), clock: this.payload() });
            this.announce();
            this.emit();
            return;
        }
        this.measure(message.origin, message.clock);
        if (message.type == "state") {
            if (newer(message.timeline, this.timeline)) this.adopt(message.timeline);
            else this.emit();
        }
    }

    // The timeline for an application that arrives: as is, its anchor on a clock it can measure; anchored on this
    // clock if the application of the anchor has left.
    private answer(): Timeline {
        const t = this.timeline, clock = t.anchor.clock;
        if (clock == this.origin || this.peers.includes(clock)) return t;
        const offset = this.offsetTo(clock);
        return offset === null ? t : rebase(t, this.origin, offset);
    }

    private peerOf(origin: string) {
        let peer = this.fPeers.get(origin);
        if (!peer) {
            peer = { offset: new ClockOffset(), line: null, epoch: -1, heard: 0 };
            this.fPeers.set(origin, peer);
        }
        return peer;
    }

    // A value of δ to an application, from its clock and this one at the same common time.
    private measure(origin: string, payload: ClockPayload): void {
        const peer = this.peerOf(origin);
        if (payload.epoch != peer.epoch) {
            peer.epoch = payload.epoch;
            peer.offset.reset();
        }
        peer.line = payload.line;
        const own = this.clock.message();
        if (!own || !peer.line) return;
        const T = Math.min(own.T, peer.line.T);
        const frozen = peer.offset.add(T, lineAt(peer.line, T) - this.clock.at(T), own.settled && peer.line.settled);
        const d = peer.offset.value!;
        if (this.timeline.anchor.clock == origin && (frozen || this.fTranslated === null || (peer.offset.frozen === null && Math.abs(d - this.fTranslated) > RETRANSLATE))) {
            this.translate(frozen ? "frozen" : "provisional");
        }
    }

    private adopt(timeline: Timeline): void {
        this.timeline = timeline;
        this.translate();
        this.emit();
    }

    // The timeline, from the clock of its anchor to samples of this context, to the node; not before δ is known.
    // `reason`: why the same timeline is translated again (a correction), or none for a new one.
    private translate(reason?: string): void {
        const t = this.timeline;
        const offset = this.offsetTo(t.anchor.clock);
        if (offset === null) return;
        this.fTranslated = t.anchor.clock == this.origin ? null : offset;
        const rule: TimelineRule = {
            frame: (t.anchor.time - offset) * this.fContext.sampleRate, beat: t.anchor.beat, tempo: t.tempo, meter: t.meter, playing: t.playing,
        };
        const before = this.fRule;
        if (reason && before && before.playing && rule.playing) {
            const frame = this.timeAt(commonNow()) * this.fContext.sampleRate;
            const at = (r: TimelineRule) => r.beat + (frame - r.frame) * r.tempo / (60 * this.fContext.sampleRate);
            const shift = (at(rule) - at(before)) * 60 / rule.tempo;
            if (Math.abs(shift) > 1e-6) this.corrections.push({ T: commonNow(), reason, shift });
            if (this.corrections.length > 100) this.corrections.shift();
        }
        this.fRule = rule;
        this.fNode?.port.postMessage(rule);
    }

    private post(message: SyncMessage): void {
        try { this.fChannel?.postMessage(message); } catch { /* closed */ }
    }

    private emit(): void {
        this.fListeners.forEach((l) => l());
    }
}
