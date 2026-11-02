// The modulation sources of the library have normalized outputs, as in modular synthesizers:
// bipolar in [-1, 1] (LFO, random), unipolar in [0, 1] (clock gate, envelopes).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { getCompiler } from "../helpers/faust";
import { listWidgets, modulatedCode, modulationSpec } from "../../src/model/Modulation";

const dir = path.resolve(__dirname, "../../public/faust-modules/modulation");
const LENGTH = 48000 * 4;

// Minimum and maximum of each output over 4 s, with parameters set by label prefix.
async function range(file: string, params: Record<string, number> = {}, input?: (t: number) => number): Promise<Array<[number, number]>> {
    const generator = new fw.FaustMonoDspGenerator();
    await generator.compile(await getCompiler(), "m", fs.readFileSync(path.join(dir, file), "utf8"), FAUST_COMPILE_OPTIONS);
    const json = JSON.parse(generator.factory!.json);
    const widgets: any[] = [];
    const walk = (items: any[]) => items.forEach((w) => w.items ? walk(w.items) : widgets.push(w));
    walk(json.ui);
    const processor = (await generator.createOfflineProcessor(48000, 1024))!;
    for (const [label, value] of Object.entries(params)) {
        processor.setParamValue(widgets.find((w) => w.label.startsWith(label)).address, value);
    }
    const inputs = Array.from({ length: json.inputs }, () => Float32Array.from({ length: LENGTH }, (_, t) => input ? input(t) : 0));
    return processor.render(inputs, LENGTH).map((channel) => {
        let min = Infinity, max = -Infinity;
        channel.forEach((x) => { min = Math.min(min, x); max = Math.max(max, x); });
        return [min, max] as [number, number];
    });
}

const within = ([min, max]: [number, number], low: number, high: number) => {
    expect(min).toBeGreaterThanOrEqual(low - 1e-6);
    expect(max).toBeLessThanOrEqual(high + 1e-6);
};

describe("modulation sources", () => {
    it("LFO: [-1, 1] for each shape, reaching both bounds", async () => {
        for (const shape of [0, 1, 2, 3]) {
            const [r] = await range("LFO.dsp", { Shape: shape, Rate: 2 });
            within(r, -1, 1);
            expect(r[0]).toBeLessThan(-0.99);
            expect(r[1]).toBeGreaterThan(0.99);
        }
    });

    it("LFO, Unipolar: [0, 1] for each shape, reaching both bounds", async () => {
        for (const shape of [0, 1, 2, 3]) {
            const [r] = await range("LFO.dsp", { Shape: shape, Rate: 2, Unipolar: 1 });
            within(r, 0, 1);
            expect(r[0]).toBeLessThan(0.01);
            expect(r[1]).toBeGreaterThan(0.99);
        }
    });

    it("a unipolar LFO on a widget (± depth 1): the value of the slider is the minimum of the modulation", async () => {
        // the square of the LFO (0 or 1, unipolar; -1 or 1, bipolar) on a slider at 0.2 in [0, 1]
        const lfo = async (unipolar: number) => {
            const generator = new fw.FaustMonoDspGenerator();
            await generator.compile(await getCompiler(), "lfo", fs.readFileSync(path.join(dir, "LFO.dsp"), "utf8"), FAUST_COMPILE_OPTIONS);
            const widgets = listWidgets(JSON.parse(generator.factory!.json).ui);
            const processor = (await generator.createOfflineProcessor(48000, 1024))!;
            processor.setParamValue(widgets.find((w) => w.label.startsWith("Shape"))!.address, 2);
            processor.setParamValue(widgets.find((w) => w.label.startsWith("Rate"))!.address, 4);
            processor.setParamValue(widgets.find((w) => w.label == "Unipolar")!.address, unipolar);
            return processor.render([], 48000)[0];
        };
        const target = `process = vgroup("T", hslider("level", 0.2, 0, 1, 0.01));`;
        const generator = new fw.FaustMonoDspGenerator();
        await generator.compile(await getCompiler(), "t", target, FAUST_COMPILE_OPTIONS);
        const widgets = listWidgets(JSON.parse(generator.factory!.json).ui);
        const spec = modulationSpec(widgets.find((w) => w.label == "level")!, widgets, "modulate");
        const modulated = new fw.FaustMonoDspGenerator();
        await modulated.compile(await getCompiler(), "m", modulatedCode(target, 0, [spec]), FAUST_COMPILE_OPTIONS);
        const depth = listWidgets(JSON.parse(modulated.factory!.json).ui).find((w) => w.label == "depth level")!.address;
        const run = async (unipolar: number) => {
            const processor = (await modulated.createOfflineProcessor(48000, 1024))!;
            processor.setParamValue(depth, 1);
            const [out] = processor.render([await lfo(unipolar)], 48000);
            const settled = out.slice(24000);            // after the smoothing of the depth
            return [Math.min(...settled), Math.max(...settled)];
        };
        const [lo, hi] = await run(1);
        expect(lo).toBeCloseTo(0.2, 3);                     // the slider: the minimum
        expect(hi).toBeCloseTo(1, 3);
        const [blo, bhi] = await run(0);
        expect(blo).toBeCloseTo(0, 3);                      // bipolar: around the slider
        expect(bhi).toBeCloseTo(1, 3);
    });

    it("Quad LFO: 4 outputs in [-1, 1], or in [0, 1] (Unipolar)", async () => {
        const ranges = await range("QuadLFO.dsp");
        expect(ranges).toHaveLength(4);
        ranges.forEach((r) => within(r, -1, 1));
        const unipolar = await range("QuadLFO.dsp", { Unipolar: 1 });
        unipolar.forEach((r) => {
            within(r, 0, 1);
            expect(r[0]).toBeLessThan(0.01);
            expect(r[1]).toBeGreaterThan(0.99);
        });
    });

    it("Random: in [-1, 1], or in [0, 1] (Unipolar); Clock: a 0/1 gate", async () => {
        const [bipolar] = await range("Random.dsp");
        within(bipolar, -1, 1);
        expect(bipolar[0]).toBeLessThan(-0.5);              // 4 values per second over 4 s: both signs
        const [unipolar] = await range("Random.dsp", { Unipolar: 1 });
        within(unipolar, 0, 1);
        expect(unipolar[1] - unipolar[0]).toBeGreaterThan(0.5);
        expect((await range("Clock.dsp"))[0]).toEqual([0, 1]);
    });

    it("ADSR and Envelope Follower: in [0, 1]", async () => {
        const gate = (t: number) => ((t / 48000) % 1 < 0.5 ? 1 : 0);
        const adsr = (await range("ADSR.dsp", {}, gate))[0];
        within(adsr, 0, 1);
        expect(adsr[1]).toBeGreaterThan(0.99);
        const sine = (t: number) => 0.8 * Math.sin(2 * Math.PI * 220 * t / 48000);
        within((await range("EnvelopeFollower.dsp", {}, sine))[0], 0, 1);
        within((await range("EnvelopeFollower.dsp", { Gain: 10 }, sine))[0], 0, 1);
    });
});
