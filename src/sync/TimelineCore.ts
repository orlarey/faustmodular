/*				TIMELINECORE.TS
    The heart of the Timeline node (Documentation/FAUST-SYNC-SPEC.md, § 7.2): the musical position at every sample
    of the audio context, from rules translated into its samples. Pure and self-contained (no import): it is
    tested under Node.js and embedded as is in the AudioWorkletProcessor (SharedTimeline.ts, by its source).

    A rule takes effect at its frame: it waits until then, and the switch happens exactly at that sample (a rule
    that arrives late, its frame already rendered, takes effect at once, the position following it). A new rule
    replaces those still waiting at or after its frame (it is more recent).

    The outputs, one channel each, at every sample: the position in the bar (beats, from 0 to meter), running (0 or
    1), start (1 for a sample when the playing starts from the beginning of the song), the tempo, the meter.
*/

export interface TimelineRule {
    frame: number;          // the sample of the context at which the rule takes effect
    beat: number;           // the position there
    tempo: number;
    meter: number;
    playing: boolean;
}

export const TIMELINE_CHANNELS = ["beat", "run", "start", "tempo", "meter"];

export class TimelineCore {
    sampleRate: number;
    current: TimelineRule;
    pending: TimelineRule[];
    started: boolean;

    constructor(sampleRate: number) {
        this.sampleRate = sampleRate;
        this.current = { frame: 0, beat: 0, tempo: 120, meter: 4, playing: false };
        this.pending = [];
        this.started = false;
    }

    schedule(rule: TimelineRule): void {
        this.pending = this.pending.filter((r) => r.frame < rule.frame);
        this.pending.push(rule);
    }

    beatAt(frame: number): number {
        const c = this.current;
        return c.playing ? c.beat + (frame - c.frame) * c.tempo / (60 * this.sampleRate) : c.beat;
    }

    // Renders `length` samples from the frame `start` into `out` (one array per channel).
    render(start: number, out: Float32Array[], length: number): void {
        for (let i = 0; i < length; i++) {
            const frame = start + i;
            while (this.pending.length > 0 && this.pending[0].frame <= frame) {
                const rule = this.pending.shift()!;
                // the playing starts from the beginning of the song: a start, at this very sample
                if (rule.playing && !this.current.playing && rule.beat == 0) this.started = true;
                this.current = rule;
            }
            const c = this.current;
            const beat = this.beatAt(frame);
            if (out[0]) out[0][i] = ((beat % c.meter) + c.meter) % c.meter;
            if (out[1]) out[1][i] = c.playing ? 1 : 0;
            if (out[2]) out[2][i] = this.started ? 1 : 0;
            if (out[3]) out[3][i] = c.tempo;
            if (out[4]) out[4][i] = c.meter;
            this.started = false;
        }
    }
}
