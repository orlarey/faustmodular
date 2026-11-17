import { describe, expect, it } from "vitest";
import { computedModules, decay, FLOOR_DB, levelOf } from "../../src/view/PortMeters";

describe("the ports lit by their signal", () => {
    it("shows a peak in dB from −48 to 0", () => {
        expect(levelOf(0)).toBe(0);
        expect(levelOf(-1)).toBe(0);
        expect(levelOf(10 ** (FLOOR_DB / 20))).toBeCloseTo(0, 6);
        expect(levelOf(10 ** (-24 / 20))).toBeCloseTo(0.5, 6);
        expect(levelOf(1)).toBe(1);
        expect(levelOf(4)).toBe(1);
        expect(levelOf(1e-4)).toBe(0);
    });

    it("rises at once, falls in about 150 ms", () => {
        expect(decay(0.2, 0.9, 0.05)).toBe(0.9);
        expect(decay(1, 0, 0.15)).toBeCloseTo(Math.exp(-1), 6);
        expect(decay(1, 0.8, 0.5)).toBe(0.8);       // not below the new level
    });

    it("meters only the modules computed: those leading to a root (the speakers, a display)", () => {
        const c = (from: string, to: string) => ({ from: { module: from, port: 0 }, to: { module: to, port: 0 } });
        const links = [c("lfo", "vca"), c("osc", "vca"), c("vca", "output"), c("alone", "other"), c("env", "scope")];
        expect([...computedModules(links, ["output", "scope"])].sort()).toEqual(["env", "lfo", "osc", "output", "scope", "vca"]);
        // a feedback loop ends
        expect([...computedModules([c("a", "b"), c("b", "a"), c("b", "output")], ["output"])].sort()).toEqual(["a", "b", "output"]);
    });
});
