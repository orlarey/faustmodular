/*				TIMELINECORE.TS
    The heart of the Timeline node (Documentation/FAUST-SYNC-SPEC.md, § 7.3): the musical position at every sample
    of the audio context, in integers. Pure and self-contained (no import, everything in the class): it is tested
    under Node.js and embedded as is in the AudioWorkletProcessor (SharedTimeline.ts, by its source alone).

    The position is counted in ticks, PPQ = 960 per quarter note: an integer tick k and its phase, the remainder
    r ∈ [0, den), the position being k + r/den. At every sample, while playing, r grows by inc = Tc · PPQ (Tc: the tempo
    in hundredths of BPM), and every time it reaches den = 6000 · sampleRate, k grows by one: exact (no rounding, no
    drift, the same samples in every application), as Bresenham's algorithm. Tick k falls on the first sample where the
    position reaches it.

    A rule takes effect at its frame: it waits until then, and the switch happens exactly at that sample (a rule
    that arrives late, its frame already rendered, takes effect at once, the position following it). A new rule
    replaces those still waiting at or after its frame (it is more recent). Its position at a later sample is
    computed exactly, with big integers (a rule late, a block that does not follow the one before).

    A small correction backwards (less than 50 ms: the difference with another clock measured again, while playing)
    does not take the position back: it waits until the new rule reaches it.

    The outputs, one channel each, at every sample: the position in the bar (beats, from 0 to meter, continuous),
    running (0 or 1), start (1 for a sample when the playing starts from the beginning of the song), the tempo, the
    meter, the index (the tick in the bar, an integer from 0 to PPQ · meter − 1, exact in a float), tick (1 at the
    sample of each tick), bar (the bar from the start of the song, an integer from 0: where a player plays its material,
    Documentation/MATERIALS-SPEC.md).
*/

export interface TimelineRule {
    frame: number;          // the sample of the context at which the rule takes effect (an integer)
    tick: number;           // the position there: the tick (an integer)...
    rem: number;            // ...and its phase, from 0 to den − 1
    inc: number;            // Tc · PPQ: the phase added at every sample
    den: number;            // 6000 · sampleRate: a tick
    tempo: number;          // BPM, for the tempo channel
    meter: number;
    playing: boolean;
}

export const TIMELINE_CHANNELS = ["beat", "run", "start", "tempo", "meter", "index", "tick", "bar"];

export class TimelineCore {
    static PPQ = 960;

    // The position `samples` later (or earlier): exact, with big integers.
    static advance(tick: number, rem: number, samples: number, inc: number, den: number): { tick: number; rem: number } {
        const d = BigInt(den);
        const total = BigInt(rem) + BigInt(samples) * BigInt(inc);
        let q = total / d, r = total % d;
        if (r < 0n) { r += d; q -= 1n; }
        return { tick: tick + Number(q), rem: Number(r) };
    }

    // The rule of a timeline: its anchor (frame, position in ticks and phase) and its tempo, in this context.
    static rule(frame: number, tick: number, phase: number, tempo: number, meter: number, playing: boolean, sampleRate: number): TimelineRule {
        const den = 6000 * sampleRate;
        return {
            frame, tick, rem: Math.min(den - 1, Math.max(0, Math.round(phase * den))),
            inc: Math.round(tempo * 100) * TimelineCore.PPQ, den, tempo, meter, playing,
        };
    }

    sampleRate: number;
    current: TimelineRule;
    pending: TimelineRule[];
    started: boolean;
    k: number;                  // the position at the sample `at`
    r: number;
    at: number | null;
    hold: { k: number; r: number } | null;     // the position held while a new rule catches up with it
    holdMax: number;            // s: the largest correction backwards that is held
    previous: number | null;    // the tick of the sample before (a tick: it grew)
    next: number | null;        // the frame the next block should start at
    jumps: number;              // the blocks that did not start there (for the diagnosis)

    constructor(sampleRate: number) {
        this.sampleRate = sampleRate;
        this.current = TimelineCore.rule(0, 0, 0, 120, 4, false, sampleRate);
        this.pending = [];
        this.started = false;
        this.k = 0;
        this.r = 0;
        this.at = null;
        this.hold = null;
        this.holdMax = 0.05;
        this.previous = null;
        this.next = null;
        this.jumps = 0;
    }

    schedule(rule: TimelineRule): void {
        this.pending = this.pending.filter((r) => r.frame < rule.frame);
        this.pending.push(rule);
    }

    // The position of a rule at a sample.
    positionOf(rule: TimelineRule, frame: number): { tick: number; rem: number } {
        return rule.playing ? TimelineCore.advance(rule.tick, rule.rem, frame - rule.frame, rule.inc, rule.den) : { tick: rule.tick, rem: rule.rem };
    }

    // The position at `frame`: one sample after the last one, by the integer step; otherwise computed again.
    private step(frame: number): void {
        const c = this.current;
        if (this.at !== null && frame == this.at + 1) {
            if (c.playing) {
                this.r += c.inc;
                while (this.r >= c.den) { this.r -= c.den; this.k++; }
            }
        } else {
            const p = this.positionOf(c, frame);
            this.k = p.tick;
            this.r = p.rem;
        }
        this.at = frame;
    }

    // Renders `length` samples from the frame `start` into `out` (one array per channel).
    render(start: number, out: Float32Array[], length: number): void {
        if (this.next !== null && start != this.next) this.jumps++;
        this.next = start + length;
        for (let i = 0; i < length; i++) {
            const frame = start + i;
            this.step(frame);
            while (this.pending.length > 0 && this.pending[0].frame <= frame) {
                const rule = this.pending.shift()!;
                const was = this.current.playing;
                const before = this.hold ?? { k: this.k, r: this.r };
                const p = this.positionOf(rule, frame);
                // the playing starts from the beginning of the song: a start, at this very sample
                if (rule.playing && !was && rule.tick == 0 && rule.rem == 0) this.started = true;
                this.current = rule;
                this.k = p.tick;
                this.r = p.rem;
                // a small correction backwards (the same den: the same context): held
                const back = (before.k - p.tick) + (before.r - p.rem) / rule.den;
                const ticksPerSecond = rule.inc * this.sampleRate / rule.den;
                this.hold = was && rule.playing && back > 0 && back < this.holdMax * ticksPerSecond ? before : null;
            }
            let k = this.k, r = this.r;
            if (this.hold !== null) {
                if (k > this.hold.k || (k == this.hold.k && r >= this.hold.r)) this.hold = null;
                else { k = this.hold.k; r = this.hold.r; }
            }
            const c = this.current;
            const bar = TimelineCore.PPQ * c.meter;
            const index = ((k % bar) + bar) % bar;
            if (out[0]) out[0][i] = (index + r / c.den) / TimelineCore.PPQ;
            if (out[1]) out[1][i] = c.playing ? 1 : 0;
            if (out[2]) out[2][i] = this.started ? 1 : 0;
            if (out[3]) out[3][i] = c.tempo;
            if (out[4]) out[4][i] = c.meter;
            if (out[5]) out[5][i] = index;
            if (out[6]) out[6][i] = this.previous !== null && k > this.previous ? 1 : 0;
            if (out[7]) out[7][i] = Math.floor(k / bar);
            this.previous = k;
            this.started = false;
        }
    }
}
