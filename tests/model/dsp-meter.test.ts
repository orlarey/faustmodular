import { describe, expect, it } from "vitest";
import { HIGH, isReport, loadOf, meterLevel, newDropouts, percent, smooth } from "../../src/audio/DspMeter";

describe("the load of the audio thread", () => {
    it("is the time spent over the duration of the audio rendered", () => {
        // 120 ms counted over 24000 frames at 48 kHz (500 ms)
        expect(loadOf({ busy: 120, blocks: 187, frames: 24000, sampleRate: 48000 })).toBeCloseTo(0.24, 9);
        expect(loadOf({ busy: 0, blocks: 0, frames: 24000, sampleRate: 48000 })).toBe(0);
        expect(loadOf({ busy: 1000, blocks: 187, frames: 24000, sampleRate: 48000 })).toBe(2);   // overloaded
    });

    it("the 1 ms clock: the counts of contiguous blocks add up; the bursts of the device, not locked to it, average out", () => {
        // blocks of 2.667 ms, each busy 0.8 ms, run back to back by bursts of 4 (a buffer of the device of 10.667 ms);
        // the start of a burst jitters by up to 0.3 ms (the device has its own clock, the thread is scheduled)
        let seed = 1;
        const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (const phase of [0, 0.13, 0.5, 0.77]) {
            let counted = 0, spent = 0;
            for (let burst = 0; burst < 2000; burst++) {
                let t = phase + burst * 4 * (128 / 48) + 0.3 * random();
                for (let b = 0; b < 4; b++) {
                    counted += Math.floor(t + 0.8) - Math.floor(t);
                    spent += 0.8;
                    t += 0.8;
                }
            }
            expect(counted / spent).toBeGreaterThan(0.98);
            expect(counted / spent).toBeLessThan(1.02);
        }
    });

    it("is smoothed, the first one as is", () => {
        expect(smooth(null, 0.4, 0.5)).toBe(0.4);
        expect(smooth(0, 1, 1, 1)).toBeCloseTo(1 - Math.exp(-1), 9);
        expect(smooth(0.3, 0.3, 0.5)).toBe(0.3);
    });

    it("reads only the reports of the meter", () => {
        expect(isReport({ busy: 1, blocks: 2, frames: 24000, sampleRate: 48000 })).toBe(true);
        expect(isReport({ busy: 1, blocks: 2, frames: 0, sampleRate: 48000 })).toBe(false);
        expect(isReport({ busy: "1", blocks: 2, frames: 1, sampleRate: 48000 })).toBe(false);
        expect(isReport(null)).toBe(false);
    });

    it("counts the new dropouts of the device", () => {
        const c = (n: number) => ({ underrunEvents: n, underrunDuration: 0, totalDuration: 0 });
        expect(newDropouts(c(3), c(5))).toBe(2);
        expect(newDropouts(c(5), c(0))).toBe(0);         // started again
        expect(newDropouts(null, c(5))).toBe(0);
        expect(newDropouts(c(5), null)).toBe(0);
    });

    it("is quiet, amber from 70 %, red after a dropout, a dash when suspended", () => {
        expect(meterLevel(false, 0.9, 3)).toBe("suspended");
        expect(meterLevel(true, 0.2, 0)).toBe("normal");
        expect(meterLevel(true, null, 0)).toBe("normal");
        expect(meterLevel(true, HIGH, 0)).toBe("high");
        expect(meterLevel(true, 0.1, 1)).toBe("dropouts");
        expect(percent(0.234)).toBe(23);
        expect(percent(25)).toBe(999);
    });
});
