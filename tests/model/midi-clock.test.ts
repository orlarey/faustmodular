// The MIDI clock followed for the MIDI Clock modules (src/midi/ClockFollower.ts): Start, the position of the
// clock messages (the first one after Start is the downbeat), Stop, Continue, the song position pointer, the
// tempo measured, and no clock.
import { describe, expect, it } from "vitest";
import { ClockFollower } from "../../src/midi/ClockFollower";

const TICK = [0xf8], START = [0xfa], STOP = [0xfc], CONTINUE = [0xfb];
const AT_120 = 60000 / 120 / 24;        // ms between two clock messages at 120 BPM

describe("MIDI clock follower", () => {
    it("counts the clock messages from Start, the first one on the downbeat; Stop and Continue", () => {
        const c = new ClockFollower();
        expect(c.handle(TICK, 0)).toBeNull();                       // not running: no tick (and no tempo yet)
        expect(c.handle(START, 1)).toEqual({ start: true, running: true });
        const ticks = Array.from({ length: 30 }, (_, i) => c.handle(TICK, 2 + i * AT_120)?.tick);
        expect(ticks.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
        expect(c.handle(STOP, 700)).toEqual({ running: false });
        expect(c.handle(TICK, 700 + AT_120)?.tick).toBeUndefined();
        expect(c.handle(CONTINUE, 710)).toEqual({ running: true });
        expect(c.handle(TICK, 710 + AT_120)?.tick).toBe(30);       // goes on where it stopped
    });

    it("measures the tempo over a quarter note", () => {
        const c = new ClockFollower();
        let tempo = 0;
        for (let i = 0; i < 30; i++) tempo = c.handle(TICK, i * AT_120)?.tempo ?? tempo;
        expect(tempo).toBe(120);
        expect(c.tempo).toBe(120);
        // 90 BPM: the tempo follows
        for (let i = 0; i < 30; i++) c.handle(TICK, 1000 + i * (60000 / 90 / 24));
        expect(c.tempo).toBe(90);
    });

    it("moves to a song position (sixteenth notes: 6 clock messages each)", () => {
        const c = new ClockFollower();
        c.handle([0xf2, 4, 0], 0);
        c.handle(CONTINUE, 0);
        expect(c.handle(TICK, 1)?.tick).toBe(24);
    });

    it("says no clock (tempo 0) and stopped when the clock messages stop for 2 beats", () => {
        const c = new ClockFollower();
        c.handle(START, 0);
        for (let i = 0; i < 30; i++) c.handle(TICK, i * AT_120);
        const last = 29 * AT_120;
        expect(c.check(last + 900)).toBeNull();                     // 2 beats at 120: 1 s
        expect(c.check(last + 1100)).toEqual({ tempo: 0, running: false });
        expect(c.check(last + 2000)).toBeNull();
    });
});
