// The MIDI to CV module (public/faust-modules/modular/MidiCV.dsp), rendered offline with its hidden widgets set as
// the application sets them: the pitch (0.1 per octave from C4, the bend added in semitones), the gate, and its
// fall of one sample when the trigger counter changes (a new attack, even within a block).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { getCompiler, TEST_OPTIONS } from "../helpers/faust";

const code = fs.readFileSync(path.resolve(__dirname, "../../public/faust-modules/modular/MidiCV.dsp"), "utf8");

describe("MIDI to CV module", () => {
    it("outputs the pitch, the gate with its new attacks, the velocity", async () => {
        const generator = new fw.FaustMonoDspGenerator();
        await generator.compile(await getCompiler(), "midicv", code, TEST_OPTIONS);
        expect(JSON.parse(generator.factory!.json)).toMatchObject({ inputs: 0, outputs: 5 });
        const processor = (await generator.createOfflineProcessor(48000, 64))!;
        const p = "/MidiCV/";
        processor.setParamValue(p + "note", 64);
        processor.setParamValue(p + "gate", 1);
        processor.setParamValue(p + "velocity", 0.5);
        let [pitch, gate, velocity] = processor.render([], 64);
        expect(pitch[63]).toBeCloseTo(4 / 120, 6);
        expect(Array.from(gate)).toEqual(new Array(64).fill(1));
        expect(velocity[63]).toBeCloseTo(0.5, 6);
        // a new attack: the gate falls for one sample
        processor.setParamValue(p + "trigger", 1);
        processor.setParamValue(p + "note", 67);
        [pitch, gate] = processor.render([], 64);
        expect(gate[0]).toBe(0);
        expect(Array.from(gate.slice(1))).toEqual(new Array(63).fill(1));
        expect(pitch[0]).toBeCloseTo(7 / 120, 6);
        // the bend, +1 over 2 semitones (smoothed): a whole tone up
        processor.setParamValue(p + "bend", 1);
        for (let i = 0; i < 100; i++) [pitch] = processor.render([], 64);
        expect(pitch[63]).toBeCloseTo(9 / 120, 4);
    });
});
