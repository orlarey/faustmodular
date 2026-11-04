// The monophonic voice of the MIDI to CV module (src/midi/MonoVoice.ts): the note that sounds by priority, the
// gate and its new attacks (legato or not), the release that hands over to a note still held, the channel, the
// pitch bend, the modulation wheel, the aftertouch, all notes off.
import { describe, expect, it } from "vitest";
import { MonoSettings, MonoVoice } from "../../src/midi/MonoVoice";

const LAST: MonoSettings = { channel: 0, priority: 0, legato: false };
const on = (note: number, velocity = 100, channel = 1) => [0x90 | (channel - 1), note, velocity];
const off = (note: number, channel = 1) => [0x80 | (channel - 1), note, 0];

describe("MIDI mono voice", () => {
    it("plays a note: its pitch, a gate with a new attack, its velocity; the release keeps the pitch", () => {
        const v = new MonoVoice();
        expect(v.handle(on(64, 127), LAST)).toEqual({ note: 64, gate: 1, velocity: 1, retrigger: true });
        expect(v.handle(off(64), LAST)).toEqual({ gate: 0 });
        expect(v.note).toBe(64);
        // a note on of velocity 0 is a note off
        v.handle(on(60), LAST);
        expect(v.handle(on(60, 0), LAST)).toEqual({ gate: 0 });
        // a note off of a note not held: nothing
        expect(v.handle(off(70), LAST)).toBeNull();
    });

    it("gives the last note priority, a new attack for each, and hands back to the note still held", () => {
        const v = new MonoVoice();
        v.handle(on(60), LAST);
        expect(v.handle(on(67, 64), LAST)).toMatchObject({ note: 67, gate: 1, retrigger: true });
        expect(v.handle(off(67), LAST)).toEqual({ note: 60, velocity: 100 / 127 });      // no new attack
        expect(v.gate).toBe(1);
        expect(v.handle(off(60), LAST)).toEqual({ gate: 0 });
    });

    it("in legato, a note played while another is held changes the pitch without a new attack", () => {
        const v = new MonoVoice();
        const legato = { ...LAST, legato: true };
        expect(v.handle(on(60), legato)!.retrigger).toBe(true);
        expect(v.handle(on(62), legato)!.retrigger).toBe(false);
    });

    it("gives the lowest or the highest note priority", () => {
        const low = new MonoVoice(), high = new MonoVoice();
        const lowest = { ...LAST, priority: 1 }, highest = { ...LAST, priority: 2 };
        low.handle(on(60), lowest);
        expect(low.handle(on(67), lowest)).toBeNull();            // higher: the lowest still sounds
        expect(low.handle(on(55), lowest)).toMatchObject({ note: 55 });
        expect(low.handle(off(55), lowest)).toMatchObject({ note: 60 });
        high.handle(on(60), highest);
        expect(high.handle(on(55), highest)).toBeNull();
        expect(high.handle(on(72), highest)).toMatchObject({ note: 72 });
        expect(high.held).toEqual([60, 55, 72]);
    });

    it("listens to its channel only, or to all (omni)", () => {
        const v = new MonoVoice();
        const two = { ...LAST, channel: 2 };
        expect(v.handle(on(60, 100, 1), two)).toBeNull();
        expect(v.handle(on(60, 100, 2), two)).toMatchObject({ note: 60 });
        expect(new MonoVoice().handle(on(60, 100, 16), LAST)).toMatchObject({ note: 60 });
    });

    it("reads the pitch bend, the modulation wheel and the aftertouch", () => {
        const v = new MonoVoice();
        expect(v.handle([0xe0, 0x00, 0x40], LAST)).toEqual({ bend: 0 });
        expect(v.handle([0xe0, 0x7f, 0x7f], LAST)!.bend).toBeCloseTo(8191 / 8192, 9);
        expect(v.handle([0xe0, 0x00, 0x00], LAST)).toEqual({ bend: -1 });
        expect(v.handle([0xb0, 1, 127], LAST)).toEqual({ mod: 1 });
        expect(v.handle([0xb0, 7, 100], LAST)).toBeNull();          // another controller
        expect(v.handle([0xd0, 64], LAST)).toEqual({ aftertouch: 64 / 127 });
        // the pressure of a key: of the note that sounds only
        v.handle(on(60), LAST);
        expect(v.handle([0xa0, 60, 127], LAST)).toEqual({ aftertouch: 1 });
        expect(v.handle([0xa0, 61, 127], LAST)).toBeNull();
    });

    it("releases everything on all notes off, and ignores the system messages", () => {
        const v = new MonoVoice();
        v.handle(on(60), LAST);
        v.handle(on(64), LAST);
        expect(v.handle([0xb0, 123, 0], LAST)).toEqual({ gate: 0 });
        expect(v.held).toEqual([]);
        expect(v.handle([0xf8], LAST)).toBeNull();                   // the MIDI clock
    });
});
