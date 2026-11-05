/*				TIMELINE.TS
    The shared timeline of faust-sync (Documentation/FAUST-SYNC-SPEC.md, § 4 and 5): a tempo, a meter, a transport,
    and the rule giving the musical position. Its anchor is on the clock of an application (the time of its audio
    context that comes out of the speaker, s): the others translate it by the difference of their clocks, measured
    once and frozen (§ 7.2). Pure: the protocol is SharedTimeline.ts.

    An operation decided at the common time `now` (ms, performance.timeOrigin + performance.now(), the same clock for
    every tab) takes effect LEAD ms later, so that every application receives it before and switches at the same
    audible sample; the position does not jump, unless asked (play from the start, locate). Its revision is
    (now, origin): the most recent one wins everywhere (§ 6.2).
*/

export const LEAD = 20;                 // ms between an operation and its effect
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 999;

// A time on the clock of an application: `clock` its origin, `time` the time of its context (s).
export interface ClockTime { clock: string; time: number }

export interface Timeline {
    tempo: number;                      // beats (quarter notes) per minute
    meter: number;                      // beats per bar
    playing: boolean;
    anchor: ClockTime & { beat: number };       // at that time of that clock, the position was (will be) `beat`
    revision: { time: number; origin: string };
}

// A new timeline, stopped at 0, anchored on the clock of `origin`; `revision`: its time (0, older than any change).
export function newTimeline(origin: string, revision = 0): Timeline {
    return { tempo: 120, meter: 4, playing: false, anchor: { clock: origin, time: 0, beat: 0 }, revision: { time: revision, origin } };
}

// The position at a time of the clock of its anchor (beats).
export function beatAt(timeline: Timeline, time: number): number {
    const { anchor } = timeline;
    return timeline.playing ? anchor.beat + (time - anchor.time) * timeline.tempo / 60 : anchor.beat;
}

// The same timeline, anchored on another clock: `offset` = t_clock − t_other, the difference of the two clocks (s).
// Nothing changes but the reference of the anchor.
export function rebase(timeline: Timeline, clock: string, offset: number): Timeline {
    if (timeline.anchor.clock == clock) return timeline;
    return { ...timeline, anchor: { clock, time: timeline.anchor.time - offset, beat: timeline.anchor.beat } };
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

// The timeline after an operation decided at the common time `now` by `origin`. `effect`: the time of its clock at
// which it takes effect (its time now + LEAD); `position`: the position at a time of that clock, as this application
// plays it.
export function apply(timeline: Timeline, op: Operation, now: number, origin: string, effect: ClockTime,
    position: (time: number) => number): Timeline {
    const revision = { time: now, origin };
    const at = (beat: number) => ({ clock: effect.clock, time: effect.time, beat });
    switch (op.type) {
        case "tempo":
            return { ...timeline, tempo: clampTempo(op.tempo), anchor: at(position(effect.time)), revision };
        case "play":
            if (timeline.playing && !op.fromStart) return timeline;
            return { ...timeline, playing: true, anchor: at(op.fromStart ? 0 : position(effect.time)), revision };
        case "stop":
            if (!timeline.playing) return timeline;
            return { ...timeline, playing: false, anchor: at(position(effect.time)), revision };
        case "locate":
            return { ...timeline, anchor: at(op.beat), revision };
        case "meter":
            return { ...timeline, meter: Math.max(1, Math.min(16, Math.round(op.meter))), revision };
    }
}

// Bar and beat (from 1) of a position.
export function barBeat(beat: number, meter: number): { bar: number; beat: number } {
    const b = Math.max(0, beat);
    return { bar: Math.floor(b / meter) + 1, beat: Math.floor(b % meter) + 1 };
}
