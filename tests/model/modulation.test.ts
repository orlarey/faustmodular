// Effective code of modules with widget modulations, compiled and run with libfaust.
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import {
    allowedModes, isModulable, listWidgets, ModulationError, ModulationMode, modulatedCode, modulationSpec, octaves, WidgetDescription, widgetTarget,
} from "../../src/model/Modulation";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { compileJson, getCompiler } from "../helpers/faust";

// Values through the smoothed depth (si.smoo) settle within ~1e-5 in float32: relative tolerance 1e-4.
const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-4 * Math.max(1, Math.abs(expected)));

// A module as the playground stores it: its code wrapped in a group named after the module.
const wrap = (name: string, body: string) => `process = vgroup("${name}", environment{\nimport("stdfaust.lib");\n${body}\n}.process);`;

// Two audio inputs: (x1 * gain, x2 * 10); a frequency, a gate, homonym and unlabelled-group widgets.
const MODULE = wrap("M", `process = (*(gain), *(10)) : (_, attach(_, other)) with {
    gain = hslider("gain", 0.5, 0, 1, 0.01);
    other = hgroup("A", hslider("level", 0.5, 0, 1, 0.01)) + hgroup("B", hslider("level", 0.5, 0, 1, 0.01))
          + hslider("freq[unit:Hz]", 440, 20, 20000, 1) + button("gate")
          + hslider("h:[1]/Hand", 0.5, 0, 1, 0.01)
          + hgroup("C", hslider("h:[1]/Twin", 0, 0, 1, 1)) + hgroup("D", hslider("h:[1]/Twin", 0, 0, 1, 1));
};`);

async function widgetsOf(code: string): Promise<WidgetDescription[]> {
    return listWidgets((await compileJson("m", code)).ui);
}

// Compiles `code`, sets parameters (by label), renders constant inputs; returns the last sample of each output.
async function run(code: string, inputs: number[], params: Record<string, number> = {}): Promise<{ inputs: number; out: number[]; widgets: WidgetDescription[] }> {
    const generator = new fw.FaustMonoDspGenerator();
    await generator.compile(await getCompiler(), "m", code, FAUST_COMPILE_OPTIONS);
    const json = JSON.parse(generator.factory!.json);
    const widgets = listWidgets(json.ui);
    const processor = (await generator.createOfflineProcessor(48000, 1024))!;
    for (const [label, v] of Object.entries(params)) {
        processor.setParamValue(widgets.find((w) => w.label == label)!.address, v);
    }
    const length = 48000;     // 1 s: lets si.smoo settle
    const out = processor.render(inputs.map((v) => new Float32Array(length).fill(v)), length);
    return { inputs: json.inputs, out: out.map((channel) => channel[length - 1]), widgets };
}

async function modulated(base: string, numInputs: number, targets: Array<[string, ModulationMode]>): Promise<string> {
    const widgets = await widgetsOf(base);
    return modulatedCode(base, numInputs, targets.map(([label, mode]) => modulationSpec(widgets.find((w) => w.label == label || w.address.endsWith(label))!, widgets, mode)));
}

describe("widget descriptions and Faust targets", () => {
    it("lists the widgets with their source labels, paths, ranges and metadata", async () => {
        const widgets = await widgetsOf(MODULE);
        const freq = widgets.find((w) => w.label == "freq")!;
        expect(freq).toMatchObject({ path: ["M", "freq"], type: "hslider", min: 20, max: 20000, meta: { unit: "Hz" } });
        expect(widgets.find((w) => w.label == "Hand")!.path).toEqual(["M", "0x00", "Hand"]);
    });

    it("designates a widget by its label, or by the shortest unambiguous path suffix", async () => {
        const widgets = await widgetsOf(MODULE);
        const address = (suffix: string) => widgets.find((w) => w.address.endsWith(suffix))!.address;
        expect(widgetTarget(widgets, address("/gain"))).toBe("gain");
        expect(widgetTarget(widgets, address("/A/level"))).toBe("A/level");
        expect(widgetTarget(widgets, address("/B/level"))).toBe("B/level");
        expect(widgetTarget(widgets, address("/Hand"))).toBe("Hand");          // unique: no need of its unnamed group
        // homonyms told apart only by groups above an unnamed group: not designated (conservative)
        expect(() => widgetTarget(widgets, address("/D/0x00/Twin"))).toThrow(ModulationError);
    });

    it("offers drive only for buttons and checkboxes, exponential modulation for frequencies", async () => {
        const widgets = await widgetsOf(MODULE);
        const byLabel = (label: string) => widgets.find((w) => w.label == label)!;
        expect(allowedModes(byLabel("gate"))).toEqual(["drive"]);
        expect(allowedModes(byLabel("gain"))).toEqual(["modulate", "scale", "drive"]);
        expect(modulationSpec(byLabel("freq"), widgets, "modulate").exponential).toBe(true);
        expect(modulationSpec(byLabel("gain"), widgets, "modulate").exponential).toBe(false);
        expect(() => modulationSpec(byLabel("gate"), widgets, "scale")).toThrow(ModulationError);
    });
});

describe("effective code", () => {
    it("keeps the audio ports first and puts the modulation ports after them", async () => {
        // inputs: x1 = 3, x2 = 4, m = 2 → (3 · 0.5 · 2, 40)
        const code = await modulated(MODULE, 2, [["gain", "scale"]]);
        const r = await run(code, [3, 4, 2]);
        expect(r.inputs).toBe(3);
        expect(r.out[0]).toBeCloseTo(3, 5);
        expect(r.out[1]).toBeCloseTo(40, 5);
    });

    it("± moduler: clip(w + D·m·(max−min)/2), with a depth adjusted live", async () => {
        const code = await modulated(MODULE, 2, [["gain", "modulate"]]);
        close((await run(code, [1, 0, 0.6])).out[0], 0.8);
        close((await run(code, [1, 0, 0.6], { "depth 1": 0.5 })).out[0], 0.65);
        close((await run(code, [1, 0, 0.6], { "depth 1": -1 })).out[0], 0.2);
        close((await run(code, [1, 0, 3])).out[0], 1);                     // clipped to the range of the widget
        // the depth slider is marked, and cannot itself be modulated
        const depth = (await run(code, [1, 0, 0])).widgets.find((w) => w.label == "depth 1")!;
        expect(depth.meta).toMatchObject({ modulation: "1" });
        expect(isModulable(depth)).toBe(false);
    });

    it("± moduler a frequency: clip(w·2^(D·m·N)), N = half the range in octaves", async () => {
        const osc = wrap("Osc", `process = hslider("freq[unit:Hz]", 440, 20, 20000, 1);`);
        const code = await modulated(osc, 0, [["freq", "modulate"]]);
        const n = octaves(20, 20000);
        expect(n).toBeCloseTo(Math.log2(1000) / 2, 10);
        close((await run(code, [0.5])).out[0], 440 * 2 ** (0.5 * n));
        close((await run(code, [-0.25])).out[0], 440 * 2 ** (-0.25 * n));
        close((await run(code, [-1])).out[0], 20);                          // clipped
    });

    it("× doser: w·m; ⇐ piloter: clip(m), the widget staying in the interface", async () => {
        expect((await run(await modulated(MODULE, 2, [["gain", "scale"]]), [1, 0, 0.3])).out[0]).toBeCloseTo(0.15, 5);
        const drive = await modulated(MODULE, 2, [["gain", "drive"]]);
        expect((await run(drive, [1, 0, 0.3])).out[0]).toBeCloseTo(0.3, 5);
        expect((await run(drive, [1, 0, -2])).out[0]).toBeCloseTo(0, 5);
        expect((await run(drive, [1, 0, 0])).widgets.some((w) => w.label == "gain")).toBe(true);
    });

    it("drives a gate with a signal", async () => {
        const synth = wrap("Synth", `process = button("gate");`);
        const code = await modulated(synth, 0, [["gate", "drive"]]);
        expect((await run(code, [1])).out[0]).toBe(1);
        expect((await run(code, [0])).out[0]).toBe(0);
    });

    it("combines several modulations, one port each, in their order", async () => {
        // ports: x1, x2, m1 (± on A/level), m2 (× on gain); output 0 = x1 · gain · m2
        const code = await modulated(MODULE, 2, [["/A/level", "modulate"], ["gain", "scale"]]);
        const r = await run(code, [2, 1, 0.4, 0.5]);
        expect(r.inputs).toBe(4);
        expect(r.out[0]).toBeCloseTo(2 * 0.5 * 0.5, 5);
        expect(r.widgets.filter((w) => w.meta.modulation).map((w) => w.label)).toEqual(["depth 1"]);
    });

    it("leaves a module without modulation unchanged", () => {
        expect(modulatedCode(MODULE, 2, [])).toBe(MODULE);
    });
});
