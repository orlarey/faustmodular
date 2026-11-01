// What a module shows of its signals (Modules/Displays.ts): bargraphs, declared oscilloscope or spectrum.
import { describe, expect, it } from "vitest";
import { barFraction, bargraphsOf, declaredDisplay } from "../../src/Modules/Displays";

describe("displays", () => {
    it("finds the bargraphs of a module, in nested groups", () => {
        const ui = [{ type: "vgroup", label: "M", address: "/M", items: [
            { type: "hslider", label: "gain", address: "/M/gain" },
            { type: "hgroup", label: "G", address: "/M/G", items: [{ type: "vbargraph", label: "level", address: "/M/G/level", min: -70, max: 0 }] },
            { type: "hbargraph", label: "value", address: "/M/value", min: -1, max: 1 },
        ] }];
        expect(bargraphsOf(ui).map((b) => b.address)).toEqual(["/M/G/level", "/M/value"]);
    });

    it("reads the display a module declares", () => {
        expect(declaredDisplay({ meta: [{ name: "Scope" }, { display: "scope" }] })).toBe("scope");
        expect(declaredDisplay({ meta: [{ display: " Spectrum " }] })).toBe("spectrum");
        expect(declaredDisplay({ meta: [{ display: "other" }] })).toBeNull();
        expect(declaredDisplay({})).toBeNull();
    });

    it("fills a bar in proportion, within [0, 1]", () => {
        expect(barFraction(-35, -70, 0)).toBe(0.5);
        expect(barFraction(10, -70, 0)).toBe(1);
        expect(barFraction(-100, -70, 0)).toBe(0);
        expect(barFraction(NaN, 0, 1)).toBe(0);
        expect(barFraction(1, 1, 1)).toBe(0);
    });
});
