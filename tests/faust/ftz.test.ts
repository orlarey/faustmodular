// libfaust defect of 2.90.17 (wasm backend, faustwasm 0.19.2), fixed in 2.90.19 (faustwasm 0.19.6):
// with "-ftz 2" (the option used by the application up to 1.7.1), a recursion driven by a constant
// output zeros. The application compiles with "-ftz 1" since 2.0.0 (src/FaustOptions.ts); this test
// now guards against a regression.
// Why "-ftz 1" is kept (src/FaustOptions.ts): it flushes a NaN of a recursion to 0, "-ftz 2" keeps it, so that a
// single NaN reaching a recursion silences the module for ever with "-ftz 2", for a sample with "-ftz 1".
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { getCompiler, renderConstant } from "../helpers/faust";

const CODE = "process = (0.3, _ : -) ~ *(0.5);";       // y = 0.3 - 0.5 y'
const EXPECTED = [0.3, 0.15, 0.225, 0.1875];

describe("libfaust -ftz 2", () => {
    it("is correct without -ftz and with -ftz 1", async () => {
        for (const options of ["", "-ftz 1"]) {
            const [out] = await renderConstant("ftz", CODE, [], 4, options);
            out.forEach((x, t) => expect(x).toBeCloseTo(EXPECTED[t], 6));
        }
    });

    it("is correct with -ftz 2 (defect of libfaust 2.90.17, fixed in 2.90.19)", async () => {
        const [out] = await renderConstant("ftz", CODE, [], 4, "-ftz 2");
        out.forEach((x, t) => expect(x).toBeCloseTo(EXPECTED[t], 6));
    });
});

// A sine with a single NaN at sample 1000, through a one-pole low pass and a 2nd order low pass: the samples of
// the output that are NaN.
async function nanSamples(options: string): Promise<number[]> {
    const counts: number[] = [];
    for (const code of ['process = _ : *(0.1) : + ~ *(0.9);', 'import("stdfaust.lib"); process = fi.lowpass(2, 1000);']) {
        const generator = new fw.FaustMonoDspGenerator();
        await generator.compile(await getCompiler(), "nan", code, options);
        const processor = (await generator.createOfflineProcessor(48000, 128))!;
        const input = Float32Array.from({ length: 48000 }, (_, t) => t == 1000 ? NaN : 0.5 * Math.sin(2 * Math.PI * 440 * t / 48000));
        const [out] = processor.render([input], 48000);
        counts.push(out.reduce((n, x) => n + (Number.isNaN(x) ? 1 : 0), 0));
    }
    return counts;
}

describe("a NaN reaching a recursion", () => {
    it("lasts one sample at most with the options of the application", async () => {
        expect(FAUST_COMPILE_OPTIONS).toBe("-ftz 1");
        for (const n of await nanSamples(FAUST_COMPILE_OPTIONS)) expect(n).toBeLessThanOrEqual(1);
    });

    it("stays for ever with -ftz 2 (why -ftz 1 is kept)", async () => {
        for (const n of await nanSamples("-ftz 2")) expect(n).toBe(47000);
    });
});
