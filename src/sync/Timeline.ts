/*				TIMELINE.TS
    The shared timeline of faust-sync (Documentation/FAUST-SYNC-SPEC.md, § 4 and 5): a tempo, a meter, a
    transport, and the rule giving the musical position at any common time (ms, performance.timeOrigin +
    performance.now(), the same clock for every tab of the browser). Pure: the protocol is SharedTimeline.ts.

    An operation decided at the common time t takes effect at t + LEAD, so that every application receives it
    before and switches at the same audible sample; the position does not jump, unless asked (play from the
    start, locate). Its revision is (t, origin): the most recent one wins everywhere (§ 6.2).
*/

export const LEAD = 20;                 // ms between an operation and its effect
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 999;

export interface Timeline {
    tempo: number;                      // beats (quarter notes) per minute
    meter: number;                      // beats per bar
    playing: boolean;
    anchor: { time: number; beat: number };     // at the common time `time` (ms), the position was (will be) `beat`
    revision: { time: number; origin: string };
}

export function newTimeline(now: number, origin: string): Timeline {
    return { tempo: 120, meter: 4, playing: false, anchor: { time: now, beat: 0 }, revision: { time: now, origin } };
}

// The position at a common time (beats).
export function beatAt(timeline: Timeline, time: number): number {
    const { anchor } = timeline;
    return timeline.playing ? anchor.beat + (time - anchor.time) * timeline.tempo / 60000 : anchor.beat;
}

// `a` is more recent than `b`: a later revision, then the larger origin (a total order).
export function newer(a: Timeline, b: Timeline): boolean {
    if (a.revision.time != b.revision.time) return a.revision.time > b.revision.time;
    return a.revision.origin > b.revision.origin;
}

export function clampTempo(tempo: number): number {
    return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(tempo * 100) / 100));
}

export type Operation =
    | { type: "tempo"; tempo: number }
    | { type: "play"; fromStart?: boolean }
    | { type: "stop" }
    | { type: "locate"; beat: number }
    | { type: "meter"; meter: number };

// The timeline after an operation decided at the common time `now` by `origin` (effect at now + LEAD).
// `position` gives the position at a common time as this application hears it (its audio clock); by default the
// rule of the timeline.
export function apply(timeline: Timeline, op: Operation, now: number, origin: string,
    position: (time: number) => number = (time) => beatAt(timeline, time)): Timeline {
    const effect = now + LEAD;
    const revision = { time: now, origin };
    const here = { time: effect, beat: position(effect) };
    switch (op.type) {
        case "tempo":
            return { ...timeline, tempo: clampTempo(op.tempo), anchor: here, revision };
        case "play":
            if (timeline.playing && !op.fromStart) return timeline;
            return { ...timeline, playing: true, anchor: op.fromStart ? { time: effect, beat: 0 } : here, revision };
        case "stop":
            if (!timeline.playing) return timeline;
            return { ...timeline, playing: false, anchor: here, revision };
        case "locate":
            return { ...timeline, anchor: { time: effect, beat: op.beat }, revision };
        case "meter":
            return { ...timeline, meter: Math.max(1, Math.min(16, Math.round(op.meter))), revision };
    }
}

// Bar and beat (from 1) of a position.
export function barBeat(beat: number, meter: number): { bar: number; beat: number } {
    const b = Math.max(0, beat);
    return { bar: Math.floor(b / meter) + 1, beat: Math.floor(b % meter) + 1 };
}
