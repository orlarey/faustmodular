// The modules taken from the Faust libraries (public/faust-modules/faustlib, scripts/faust-library-modules.mjs):
// up to date with their generator; a MIDI instrument has a Pitch slider (0.1 per octave from C4) in place of
// its freq widget, and plays as the instrument set at that frequency. Their compilation is checked with the
// other modules of the library (modules.test.ts).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { getCompiler, TEST_OPTIONS } from "../helpers/faust";
import { allowedModes, listWidgets } from "../../src/model/Modulation";
// @ts-ignore: Node.js scripts
import { FAUST_LIBRARY_MODULES } from "../../scripts/faust-library-modules.mjs";
// @ts-ignore
import { moduleCode, modulePath } from "../../scripts/build-faust-library-modules.mjs";

const root = path.resolve(__dirname, "../..");
const SR = 48000;
const C4 = 261.6256;

async function generator(code: string) {
    const g = new fw.FaustMonoDspGenerator();
    await g.compile(await getCompiler(), "m", code, TEST_OPTIONS);
    return { g, widgets: listWidgets(JSON.parse(g.factory!.json).ui) };
}

// 1.4 s of the instrument, its widgets set by label
async function play(code: string, params: Record<string, number>): Promise<Float32Array> {
    const { g, widgets } = await generator(code);
    const processor = (await g.createOfflineProcessor(SR, 512))!;
    for (const [label, value] of Object.entries(params)) {
        const w = widgets.find((x) => x.label == label);
        if (w) processor.setParamValue(w.address, value);
    }
    return processor.render([], Math.round(1.4 * SR))[0];
}

// The fundamental, by the normalized autocorrelation (40 to 2000 Hz, from 0.3 to 1.3 s): the first lag whose
// correlation is close to the best one, refined by a parabola.
function fundamental(x: Float32Array): number {
    const a = x.slice(Math.round(0.3 * SR), Math.round(1.3 * SR));
    const minLag = Math.floor(SR / 2000), maxLag = Math.ceil(SR / 40);
    const r = (lag: number) => {
        let s = 0, e1 = 0, e2 = 0;
        for (let i = 0; i + lag < a.length; i++) { s += a[i] * a[i + lag]; e1 += a[i] * a[i]; e2 += a[i + lag] * a[i + lag]; }
        return s / Math.sqrt(e1 * e2 + 1e-30);
    };
    const rs = Array.from({ length: maxLag + 2 }, (_, l) => (l >= minLag ? r(l) : -1));
    const best = Math.max(...rs);
    let lag = minLag;
    for (let l = minLag + 1; l <= maxLag; l++) if (rs[l] > 0.9 * best && rs[l] >= rs[l - 1] && rs[l] >= rs[l + 1]) { lag = l; break; }
    const d = (0.5 * (rs[lag - 1] - rs[lag + 1])) / (rs[lag - 1] - 2 * rs[lag] + rs[lag + 1]);
    return SR / (lag + d);
}

const cents = (f: number, g: number) => Math.abs(1200 * Math.log2(f / g));
const code = (m: any) => fs.readFileSync(path.join(root, "public", modulePath(m)), "utf8");

describe("modules of the Faust libraries", () => {
    it("are up to date with their generator (npm run faustlib-modules), each in the index", () => {
        const index = JSON.parse(fs.readFileSync(path.join(root, "public/faust-modules/index.json"), "utf8"));
        expect(index.faustlib).toEqual(FAUST_LIBRARY_MODULES.map(modulePath));
        for (const m of FAUST_LIBRARY_MODULES) expect(code(m), m.file).toBe(moduleCode(m));
    });

    it("a MIDI instrument: a Pitch slider (+ add) in place of freq, a gate button", async () => {
        for (const m of FAUST_LIBRARY_MODULES.filter((x: any) => x.pitch)) {
            const { widgets } = await generator(code(m));
            expect(widgets.some((w) => w.label == "freq"), m.name).toBe(false);
            const pitch = widgets.find((w) => w.label == "Pitch")!;
            expect(allowedModes(pitch), m.name).toEqual(["add"]);
            expect(widgets.find((w) => w.label == "gate")?.type, m.name).toBe("button");
        }
    }, 300_000);

    it("plays as the instrument set at the frequency of its pitch (the same signal); the models in tune within 5 cents", async () => {
        for (const m of FAUST_LIBRARY_MODULES.filter((x: any) => x.pitch)) {
            for (const p of [0, 0.1]) {
                const hz = C4 * 2 ** (10 * p);
                const module = await play(code(m), { Pitch: p, gate: 1, gain: 1 });
                const original = await play(`import("stdfaust.lib");\nprocess = ${m.expr};`, { freq: hz, gate: 1, gain: 1 });
                // the same signal, but for the rounding of the frequency computed in single precision (measured:
                // identical for 8 instruments, within 6e-6 of the peak for the others)
                let diff = 0, peak = 0;
                for (let i = 0; i < module.length; i++) { diff = Math.max(diff, Math.abs(module[i] - original[i])); peak = Math.max(peak, Math.abs(original[i])); }
                expect(diff / peak, `${m.name} at ${hz.toFixed(1)} Hz`).toBeLessThan(1e-4);
                // the models whose default settings play in tune (the others as the library makes them: an
                // overblowing flute, a brass that needs its lips tension, a strong partial of the marimba...)
                if (["Clarinet Model", "Guitar Model", "Nylon Guitar Model", "Interpolated Instrument"].includes(m.name)) {
                    expect(cents(fundamental(module), hz), `${m.name} at ${hz.toFixed(1)} Hz`).toBeLessThan(5);
                }
            }
        }
    }, 900_000);
});
