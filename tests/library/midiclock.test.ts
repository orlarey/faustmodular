// The MIDI Clock module (public/faust-modules/modular/MidiClock.dsp), rendered offline with its hidden widgets set
// as the application sets them: no gate before a step, a gate per step lasting Width × the period at the tempo
// measured, nothing when not running, a short reset at Start.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { getCompiler, TEST_OPTIONS } from "../helpers/faust";

const code = fs.readFileSync(path.resolve(__dirname, "../../public/faust-modules/modular/MidiClock.dsp"), "utf8");
const SR = 48000;

describe("MIDI Clock module", () => {
    it("outputs a gate per step, Width of its period at the tempo, a reset at Start, the run", async () => {
        const generator = new fw.FaustMonoDspGenerator();
        await generator.compile(await getCompiler(), "midiclock", code, TEST_OPTIONS);
        expect(JSON.parse(generator.factory!.json)).toMatchObject({ inputs: 0, outputs: 3 });
        const p = (await generator.createOfflineProcessor(SR, 128))!;
        const a = "/MidiClock/";
        const high = (x: Float32Array) => x.reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0);
        // at rest: nothing
        let [clock, reset, run] = p.render([], 4800);
        expect(high(clock) + high(reset) + high(run)).toBe(0);
        // Start at 120 BPM, a step (sixteenth note: period 125 ms = 6000 samples, Width 0.5: 3000 samples high)
        p.setParamValue(a + "tempo", 120);
        p.setParamValue(a + "run", 1);
        p.setParamValue(a + "reset", 1);
        p.setParamValue(a + "step", 1);
        [clock, reset, run] = p.render([], 12000);
        expect(high(clock)).toBe(3000);
        expect(clock[0]).toBe(1);
        expect(high(reset)).toBe(96);                           // 2 ms
        expect(high(run)).toBe(12000);
        // Width 0.25, quarter notes: 24000 × 0.25 = 6000 samples
        p.setParamValue(a + "Width", 0.25);
        p.setParamValue(a + "Division", 24);
        p.setParamValue(a + "step", 2);
        [clock] = p.render([], 30000);
        expect(high(clock)).toBe(6000);
        // stopped: a step gives no gate
        p.setParamValue(a + "run", 0);
        p.setParamValue(a + "step", 3);
        [clock, , run] = p.render([], 12000);
        expect(high(clock) + high(run)).toBe(0);
    });
});
