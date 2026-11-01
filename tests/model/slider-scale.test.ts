// The scale of a slider: linear, or logarithmic with [scale:log] when 0 < min < max (model/SliderScale.ts).
import { describe, expect, it } from "vitest";
import { positionOf, sliderRange, sliderSteps, valueAt } from "../../src/model/SliderScale";

const rate = sliderRange({ min: "0.01", max: "20", step: "0.01", meta: [{ unit: "Hz" } as any, { scale: "log" }] });

describe("slider scale", () => {
    it("is linear by default: min + position·step", () => {
        const r = sliderRange({ min: 0, max: 1, step: 0.01 });
        expect(r.log).toBe(false);
        expect(sliderSteps(r)).toBe(100);
        expect(valueAt(r, 25)).toBeCloseTo(0.25, 10);
        expect(positionOf(r, 0.25)).toBe(25);
    });

    it("is logarithmic with [scale:log]: equal ratios for equal moves, min and max at the ends", () => {
        expect(rate.log).toBe(true);
        const n = sliderSteps(rate);
        expect(n).toBe(1999);
        expect(valueAt(rate, 0)).toBe(0.01);
        expect(valueAt(rate, n)).toBe(20);
        expect(valueAt(rate, n / 2)).toBeCloseTo(Math.sqrt(0.01 * 20), 2);          // the geometric middle
        // equal moves, equal ratios (away from the minimum, where the step of 0.01 dominates)
        expect(valueAt(rate, 3 * n / 4) / valueAt(rate, n / 2)).toBeCloseTo(valueAt(rate, n) / valueAt(rate, 3 * n / 4), 0);
        expect(positionOf(rate, 1)).toBe(Math.round(n * Math.log(100) / Math.log(2000)));
    });

    it("gives values > 0, on the step of the widget, kept in [min, max]", () => {
        for (let p = -10; p <= sliderSteps(rate) + 10; p++) {
            const v = valueAt(rate, p);
            expect(v).toBeGreaterThan(0);
            expect(v).toBeGreaterThanOrEqual(0.01);
            expect(v).toBeLessThanOrEqual(20);
            expect(Math.abs(Math.round(v / 0.01) * 0.01 - v)).toBeLessThan(1e-9);
        }
        expect(positionOf(rate, 0)).toBe(0);                // out of range values: at the ends
        expect(positionOf(rate, -3)).toBe(0);
        expect(positionOf(rate, 1e6)).toBe(sliderSteps(rate));
    });

    it("stays linear when the range is not positive (the logarithm is undefined)", () => {
        expect(sliderRange({ min: 0, max: 20, step: 1, meta: [{ scale: "log" }] }).log).toBe(false);
        expect(sliderRange({ min: -1, max: 1, step: 0.1, meta: [{ scale: "log" }] }).log).toBe(false);
        expect(sliderRange({ min: 20, max: 20, step: 1, meta: [{ scale: "log" }] }).log).toBe(false);
    });
});
