// No library module outputs a non-finite value (NaN, ±∞), fed with sines or with silence, compiled with the
// options of the application: such a value, dropped on a setting, would lose the module it drives (the
// Pitch Tracker gave −∞ at the start of a note, the log of a frequency not yet measured, until 3.40.1).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { getCompiler } from "../helpers/faust";

const root = path.resolve(__dirname, "../../public/faust-modules");
const files: string[] = Object.values(JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8")) as Record<string, string[]>).flat();
const LENGTH = 8192;
const SR = 48000;

describe("library modules", () => {
    it("output only finite values, with sines and with silence", async () => {
        const failing: string[] = [];
        for (const file of files) {
            const generator = new fw.FaustMonoDspGenerator();
            await generator.compile(await getCompiler(), "finite", fs.readFileSync(path.join(root, "..", file), "utf8"), FAUST_COMPILE_OPTIONS);
            const inputs = JSON.parse(generator.factory!.json).inputs;
            for (const [kind, signal] of [["sines", (i: number, t: number) => 0.5 * Math.sin(2 * Math.PI * 220 * (i + 1) * t / SR)], ["silence", () => 0]] as const) {
                const processor = (await generator.createOfflineProcessor(SR, 128))!;
                const out = processor.render(Array.from({ length: inputs }, (_, i) => Float32Array.from({ length: LENGTH }, (_, t) => signal(i, t))), LENGTH);
                out.forEach((channel, c) => {
                    const t = channel.findIndex((x) => !Number.isFinite(x));
                    if (t >= 0) failing.push(`${path.basename(file)} (${kind}, output ${c}, sample ${t}: ${channel[t]})`);
                });
            }
        }
        expect(failing).toEqual([]);
    }, 300_000);
});
