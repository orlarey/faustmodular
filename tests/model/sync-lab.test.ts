// The computations of the synchronization lab (public/sync-lab/stats.js): the line of a clock, robust to a stale
// reading; the onsets of the clicks in a recording, at a fraction of a sample; the error of each window from the
// groups of clicks (a known delay, through a resonance and noise, found within 20 µs).
import { describe, expect, it } from "vitest";
// @ts-ignore: a plain module of the page
import { fitLine, groupClicks, onsets, robustFit, summary } from "../../public/sync-lab/stats.js";

// a deterministic noise
function noise(seed: number) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
}

describe("sync lab: the line of a clock", () => {
    it("finds the line of large values exactly", () => {
        const xs = Array.from({ length: 100 }, (_, i) => 1.7e12 + i * 50);
        const ys = xs.map((x) => 3e7 + 48.0024 * (x - 1.7e12));
        const fit = fitLine(xs, ys);
        expect(fit.slope).toBeCloseTo(48.0024, 9);
        expect(Math.max(...fit.residuals.map(Math.abs))).toBeLessThan(1e-6);
    });

    it("leaves out a stale reading", () => {
        const rnd = noise(1);
        const xs = Array.from({ length: 200 }, (_, i) => i * 50);
        const ys = xs.map((x) => 48 * x + 20 * rnd());
        ys[77] += 5000;
        const fit = robustFit(xs, ys);
        expect(fit.outliers).toBeGreaterThanOrEqual(1);
        expect(Math.abs(fit.slope - 48)).toBeLessThan(0.01);
    });
});

describe("sync lab: the clicks", () => {
    const sr = 48000;
    // a click through a resonance (a loudspeaker, a room), at a time in seconds (any fraction of a sample)
    const click = (t: number) => (t < 0 ? 0 : Math.sin(2 * Math.PI * 2000 * t) * Math.exp(-t / 0.002));
    function recording(seconds: number, delays: number[], level: number[], seed = 2) {
        const rnd = noise(seed);
        const x = new Float32Array(Math.round(seconds * sr));
        const start = 0.0123;
        for (let k = 0; start + k * 0.5 + 0.4 < seconds; k++) {
            delays.forEach((d, r) => {
                const t0 = start + k * 0.5 + r * 0.1 + d;
                const i0 = Math.floor(t0 * sr);
                for (let i = i0; i < Math.min(x.length, i0 + Math.round(0.03 * sr)); i++) x[i] += level[r] * click(i / sr - t0);
            });
        }
        for (let i = 0; i < x.length; i++) x[i] += 0.002 * rnd();
        return x;
    }

    it("finds the error of each window within 20 µs, at any fraction of a sample", () => {
        const x = recording(10, [0, 0.00037, -0.00081], [0.5, 0.3, 0.7]);
        const found = onsets(x, sr);
        expect(found.length).toBe(60);
        const groups = groupClicks(found, sr, 0.1);
        expect(groups.size).toBe(3);
        expect(groups.groups).toBe(20);
        expect(Math.abs(summary(groups.errors[0]).median - 0.37)).toBeLessThan(0.02);
        expect(Math.abs(summary(groups.errors[1]).median + 0.81)).toBeLessThan(0.02);
        expect(summary(groups.errors[0]).std).toBeLessThan(0.02);
    });

    it("finds nothing in silence", () => {
        expect(onsets(new Float32Array(48000), sr)).toEqual([]);
    });
});
