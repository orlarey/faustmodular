// What a module shows of its signals (Modules/Displays.ts): bargraphs, declared oscilloscope or spectrum.
import { describe, expect, it } from "vitest";
import { barFraction, bargraphsOf, declaredDisplay, rollColumns } from "../../src/Modules/Displays";

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

    // A gate of 100 samples every 400, scrolled at 10 samples per column: frames far apart lose samples, shown as
    // a gap of their duration; the gates after it stay in place (a squeezed trace would move them).
    it("scrolls the waveform: lost samples make a gap of their duration, the time stays right", () => {
        const gate = (n: number) => (n % 400 < 100 ? 1 : 0);
        const column = { lo: Infinity, hi: -Infinity, filled: 0, real: 0 };
        const roll: Array<[number, number] | null> = [];
        const frame = (start: number, fresh: number, buffer: number) => {
            const data = Float32Array.from({ length: buffer }, (_, i) => gate(start + fresh - buffer + i));
            const available = Math.min(buffer, fresh);
            rollColumns(column, roll, fresh - available, data, buffer - available, 10);
        };
        frame(0, 800, 1000);           // 80 columns
        frame(800, 1600, 1000);        // 600 lost (60 null columns), then 1000 samples (100 columns)
        expect(roll.length).toBe(240);
        expect(roll.slice(80, 140).every((c) => c === null)).toBe(true);
        // every column at its time: a gate of 10 columns every 40
        roll.forEach((c, i) => { if (c) expect(c[1]).toBe(i % 40 < 10 ? 1 : 0); });
    });
});
