/*				TIMELINE.TS
    The shared timeline of faust-sync (Documentation/FAUST-SYNC-SPEC.md, § 4 and 5): a tempo, a meter, a transport,
    and the rule giving the musical position. The position is counted in ticks, PPQ = 960 per quarter note. The
    anchor is on the clock of an application, at a sample of its context (an integer), with the position there: a
    tick (an integer) and its phase (the fraction of a tick, from 0 to 1). The others translate it by the difference
    of their clocks, measured once and frozen (§ 7.2). Pure: the protocol is SharedTimeline.ts.

    An operation decided at the common time `now` (ms, performance.timeOrigin + performance.now(), the same clock for
    every tab) takes effect LEAD ms later, so that every application receives it before and switches at the same
    audible sample; the position does not jump, unless asked (play from the start, locate). Its revision is
    (now, origin): the most recent one wins everywhere (§ 6.2).
*/

import { TimelineCore } from "./TimelineCore";

export const LEAD = 20;                 // ms between an operation and its effect
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 999;
export const PPQ = TimelineCore.PPQ;    // ticks per quarter note

// A sample of the context of an application: `clock` its origin.
export interface ClockFrame { clock: string; frame: number; sampleRate: number }
// A position: a tick and its phase (from 0 to 1).
export interface Position { tick: number; phase: number }

export interface Timeline {
    tempo: number;                      // beats (quarter notes) per minute, to the hundredth
    meter: number;                      // beats per bar
    playing: boolean;
    anchor: ClockFrame & Position;      // at that sample of that clock, the position was (will be) there
    revision: { time: number; origin: string };
}

// A new timeline, stopped at 0, anchored on the clock of `origin`; `revision`: its time (0, older than any change).
export function newTimeline(origin: string, sampleRate = 48000, revision = 0): Timeline {
    return {
        tempo: 120, meter: 4, playing: false,
        anchor: { clock: origin, frame: 0, sampleRate, tick: 0, phase: 0 }, revision: { time: revision, origin },
    };
}

// Ticks per sample at a tempo.
export const ticksPerSample = (tempo: number, sampleRate: number) => Math.round(tempo * 100) * PPQ / (6000 * sampleRate);

// The position at a sample of the clock of its anchor, in beats (approximate: for the display).
export function beatAt(timeline: Timeline, frame: number): number {
    const { anchor } = timeline;
    const ticks = anchor.tick + anchor.phase + (timeline.playing ? (frame - anchor.frame) * ticksPerSample(timeline.tempo, anchor.sampleRate) : 0);
    return ticks / PPQ;
}

// The same timeline, anchored on another clock: `offset` = t_clock − t_other, the difference of the two clocks (s).
// Nothing changes but the reference of the anchor (its sample there, rounded).
export function rebase(timeline: Timeline, clock: string, sampleRate: number, offset: number): Timeline {
    const a = timeline.anchor;
    if (a.clock == clock) return timeline;
    const frame = a.sampleRate == sampleRate ? a.frame - Math.round(offset * sampleRate) : Math.round((a.frame / a.sampleRate - offset) * sampleRate);
    return { ...timeline, anchor: { clock, frame, sampleRate, tick: a.tick, phase: a.phase } };
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

// The timeline after an operation decided at the common time `now` by `origin`. `effect`: the sample of its clock at
// which it takes effect (its time now + LEAD); `position`: the position there, as this application plays it (exact).
export function apply(timeline: Timeline, op: Operation, now: number, origin: string, effect: ClockFrame,
    position: (frame: number) => Position): Timeline {
    const revision = { time: now, origin };
    const at = (p: Position) => ({ ...effect, tick: p.tick, phase: p.phase });
    switch (op.type) {
        case "tempo":
            return { ...timeline, tempo: clampTempo(op.tempo), anchor: at(position(effect.frame)), revision };
        case "play":
            if (timeline.playing && !op.fromStart) return timeline;
            return { ...timeline, playing: true, anchor: at(op.fromStart ? { tick: 0, phase: 0 } : position(effect.frame)), revision };
        case "stop":
            if (!timeline.playing) return timeline;
            return { ...timeline, playing: false, anchor: at(position(effect.frame)), revision };
        case "locate":
            return { ...timeline, anchor: at({ tick: Math.max(0, Math.round(op.beat * PPQ)), phase: 0 }), revision };
        case "meter":
            return { ...timeline, meter: Math.max(1, Math.min(16, Math.round(op.meter))), revision };
    }
}

// Bar and beat (from 1) of a position.
export function barBeat(beat: number, meter: number): { bar: number; beat: number } {
    const b = Math.max(0, beat);
    return { bar: Math.floor(b / meter) + 1, beat: Math.floor(b % meter) + 1 };
}
