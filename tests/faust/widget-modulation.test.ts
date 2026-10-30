// Faust widget modulation, ["label" : circuit -> expression], as measured with the libfaust of the
// project. The widget modulation extension (Documentation/widget-modulation/PLAN.md) relies on it.
import { describe, expect, it } from "vitest";
import { compileJson, renderConstant, widgetAddresses } from "../helpers/faust";

const GAIN = 'hslider("gain", 0.5, 0, 1, 0.01)';

// Output of `code` (one output) for constant inputs.
async function value(code: string, inputs: number[]): Promise<number> {
    const [out] = await renderConstant("wm", 'import("stdfaust.lib");\n' + code, inputs, 2);
    return out[1];
}

describe("Faust widget modulation", () => {
    it("adds the modulation input first, before the inputs of the expression", async () => {
        // m = 2, x = 3: x * (gain + m)
        expect(await value(`process = ["gain": + -> *(${GAIN})];`, [2, 3])).toBeCloseTo(3 * (0.5 + 2));
        expect((await compileJson("wm", `process = ["gain" -> *(${GAIN})];`)).inputs).toBe(2);
    });

    it("replaces the widget w by circuit(w, m); the default circuit is *", async () => {
        expect(await value(`process = ["gain" -> *(${GAIN})];`, [2, 3])).toBeCloseTo(3 * 0.5 * 2);
        expect(await value(`process = ["gain": - -> *(${GAIN})];`, [2, 3])).toBeCloseTo(3 * (0.5 - 2));
        expect(await value(`process = ["gain": (_, *(0.5) : + : max(0) : min(1)) -> *(${GAIN})];`, [0.6, 1])).toBeCloseTo(0.8);
    });

    it("keeps the widget with (ro.cross(2) : attach) but removes it with (!, _)", async () => {
        const attach = `import("stdfaust.lib"); process = ["gain": (ro.cross(2) : attach) -> *(${GAIN})];`;
        expect(await value(attach.slice(attach.indexOf("process")), [2, 3])).toBeCloseTo(6);
        expect(widgetAddresses(await compileJson("wm", attach))).toEqual(["/wm/gain"]);
        expect(widgetAddresses(await compileJson("wm", `process = ["gain": (!, _) -> *(${GAIN})];`))).toEqual([]);
    });

    it("matches the source label without its metadata, spaces included, but not the address form", async () => {
        expect(await value(`process = ["Volume" -> *(hslider("Volume[acc:1 0 -10 0 10]", 0.5, 0, 1, 0.01))];`, [2, 3])).toBeCloseTo(3);
        expect(await value(`process = ["Echo Delay" -> *(hslider("Echo Delay", 0.5, 0, 1, 0.01))];`, [2, 3])).toBeCloseTo(3);
        expect(await value(`process = ["Echo_Delay" -> *(hslider("Echo Delay", 0.5, 0, 1, 0.01))];`, [2, 3])).toBeCloseTo(1.5);   // not modulated
    });

    it("modulates every widget with the label; a path suffix selects one", async () => {
        const two = (target: string) => `process = ["${target}" -> hgroup("A", *(${GAIN})), hgroup("B", *(hslider("gain", 0.25, 0, 1, 0.01)))];`;
        expect(await renderConstant("wm", two("gain"), [2, 1, 1], 1)).toEqual([[1], [0.5]]);
        expect(await renderConstant("wm", two("A/gain"), [2, 1, 1], 1)).toEqual([[1], [0.25]]);
        // the group wrapping every playground module
        const wrapped = (target: string) => `process = ["${target}" -> vgroup("Echo", environment{ process = *(hslider("h:[1]/Delay", 0.5, 0, 1, 0.01)); }.process)];`;
        expect(await value(wrapped("Echo/Delay"), [2, 3])).toBeCloseTo(3);
    });

    it("applies the outermost modulation closest to the widget", async () => {
        // inputs: outer m = 10, inner m = 2, x = 3
        expect(await value(`process = ["gain": + -> ["gain": * -> *(${GAIN})]];`, [10, 2, 3])).toBeCloseTo(3 * (0.5 + 10) * 2);
        expect(await value(`process = ["gain": +, "freq": * -> *(${GAIN}) : *(hslider("freq", 1, 0, 10, 1))];`, [2, 3, 4])).toBeCloseTo(4 * (0.5 + 2) * 3);
    });

    it("adds an input even when no widget matches (silently unused)", async () => {
        expect((await compileJson("wm", `process = ["nothing" -> *(${GAIN})];`)).inputs).toBe(2);
        expect(await value(`process = ["nothing" -> *(${GAIN})];`, [2, 3])).toBeCloseTo(1.5);
    });
});
