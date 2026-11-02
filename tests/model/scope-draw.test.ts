// The computations of the Scope display (src/Modules/ScopeDraw.ts).
import { describe, expect, it } from "vitest";
import { columnLevels, freqAxis, freqOfX, freqTicks, noteOf, semitones, SINE_DB, strongestPeak, triggerIndex, xOfFreq } from "../../src/Modules/ScopeDraw";

describe("scope display", () => {
    it("triggers on the last crossing of the threshold with the slope that leaves room for the window", () => {
        // a ramp from -1 to 1, twice: rising crossings of 0 at 5 and 15
        const data = Array.from({ length: 20 }, (_, i) => ((i % 10) - 5) / 5);
        expect(triggerIndex(data, 5, 0, "rising")).toBe(15);
        expect(triggerIndex(data, 6, 0, "rising")).toBe(5);              // 15 + 6 > 20: the previous one
        expect(triggerIndex(data, 5, 0.5, "rising")).toBe(8);               // 0.4 → 0.6 at 8 and 18; 18 + 5 > 20
        expect(triggerIndex(data, 5, 0, "falling")).toBe(10);            // 0.8 → -1
        expect(triggerIndex(data, 5, 2, "rising")).toBe(-1);             // never reached
    });

    it("places the frequencies on a log or a linear axis, and back", () => {
        const log = freqAxis(true, 48000, 600), lin = freqAxis(false, 48000, 600);
        expect(xOfFreq(log, 20)).toBeCloseTo(0, 9);
        expect(xOfFreq(log, 24000)).toBeCloseTo(600, 9);
        expect(xOfFreq(lin, 12000)).toBeCloseTo(300, 9);
        for (const f of [20, 440, 5000]) expect(freqOfX(log, xOfFreq(log, f))).toBeCloseTo(f, 6);
        expect(freqTicks(log)).toEqual([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
        expect(freqTicks(freqAxis(true, 16000, 600))).toEqual([20, 50, 100, 200, 500, 1000, 2000, 5000]);
    });

    it("draws a line per semitone, the C named with their octave; names a frequency with its deviation", () => {
        const notes = semitones(freqAxis(true, 48000, 600));
        expect(notes.filter((n) => n.octave !== null).map((n) => n.octave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(notes.find((n) => n.octave == 4)!.freq).toBeCloseTo(261.6256, 3);
        expect(noteOf(440)).toBe("A4 +0¢");
        expect(noteOf(440 * 2 ** (10 / 1200))).toBe("A4 +10¢");
        expect(noteOf(261.6256 * 2 ** (-20 / 1200))).toBe("C4 −20¢");
    });

    it("finds the strongest peak between bins (parabola in dB)", () => {
        // bins of 10 Hz; a parabola peaking at bin 30.25 (302.5 Hz), -6 dB
        const data = Array.from({ length: 100 }, (_, i) => -6 - 2 * (i - 30.25) ** 2);
        const peak = strongestPeak(data, 2000, 20)!;
        expect(peak.freq).toBeCloseTo(302.5, 6);
        expect(peak.db).toBeCloseTo(-6, 6);
    });

    it("keeps the height of a peak in each column of pixels", () => {
        // 1000 bins of 24 Hz; one bin at -6 dB, the rest at -100; 100 columns on a linear axis
        const data = Array.from({ length: 1000 }, (_, i) => (i == 417 ? -6 : -100));
        const levels = columnLevels(data, 48000, freqAxis(false, 48000, 100), 100, -110);
        expect(Math.max(...levels)).toBe(-6);
        expect(levels.filter((v) => v == -6)).toHaveLength(1);
    });

    it("calibrates the analyser: a full scale sine reads 0 dB (Blackman window, coherent gain 0.42)", () => {
        expect(SINE_DB).toBeCloseTo(13.556, 3);
    });
});
