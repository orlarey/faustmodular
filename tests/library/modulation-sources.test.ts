// The modulation sources of the library have normalized outputs, as in modular synthesizers:
// bipolar in [-1, 1] (LFO, random), unipolar in [0, 1] (clock gate, envelopes).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { getCompiler } from "../helpers/faust";

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

    it("Quad LFO: 4 outputs in [-1, 1]", async () => {
        const ranges = await range("QuadLFO.dsp");
        expect(ranges).toHaveLength(4);
        ranges.forEach((r) => within(r, -1, 1));
    });

    it("Random: in [-1, 1]; Clock: a 0/1 gate", async () => {
        within((await range("Random.dsp"))[0], -1, 1);
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
