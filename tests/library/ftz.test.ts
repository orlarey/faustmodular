// With the application's options ("-ftz 1"), every library module renders the same signal as
// without denormal flushing: no module is affected by the "-ftz 2" defect (tests/faust/ftz.test.ts).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { getCompiler } from "../helpers/faust";

const root = path.resolve(__dirname, "../../public/faust-modules");
const files: string[] = Object.values(JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8")) as Record<string, string[]>).flat();
const LENGTH = 4096;

async function render(code: string, options: string): Promise<Float32Array[]> {
    const generator = new fw.FaustMonoDspGenerator();
    await generator.compile(await getCompiler(), "ftz", code, options);
    const inputs = JSON.parse(generator.factory!.json).inputs;
    const processor = (await generator.createOfflineProcessor(48000, LENGTH))!;
    // deterministic input signals: sines at 220, 440... Hz
    return processor.render(Array.from({ length: inputs }, (_, i) =>
        Float32Array.from({ length: LENGTH }, (_, t) => Math.sin(2 * Math.PI * 220 * (i + 1) * t / 48000))), LENGTH);
}

describe("library modules with the application's compilation options", () => {
    it(`render the same signals with "${FAUST_COMPILE_OPTIONS}" as without denormal flushing`, async () => {
        const differing: string[] = [];
        for (const file of files) {
            const code = fs.readFileSync(path.join(root, "..", file), "utf8");
            const [a, b] = [await render(code, ""), await render(code, FAUST_COMPILE_OPTIONS)];
            let worst = 0;
            a.forEach((channel, c) => channel.forEach((x, t) => { worst = Math.max(worst, Math.abs(x - b[c][t])); }));
            if (worst > 1e-6) differing.push(`${path.basename(file)} (max difference ${worst.toExponential(2)})`);
        }
        expect(differing).toEqual([]);
    }, 300_000);
});
