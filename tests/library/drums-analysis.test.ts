// The drums and voices of synths.lib (scripts/faust-drum-modules.mjs) and the analyzers of analyzers.lib
// (scripts/faust-analysis-modules.mjs) as modules: their interface (a Gate driven by a gate, Freq and Pitch,
// times in ms) and their signals, measured offline: the frequencies they play, the decays, the silence before
// the gate and after its release; the pitch, brightness, zero crossings and level the analyzers measure.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { getCompiler, TEST_OPTIONS } from "../helpers/faust";
import { allowedModes, listWidgets } from "../../src/model/Modulation";
// @ts-ignore: Node.js scripts
import { DRUM_MODULES } from "../../scripts/faust-drum-modules.mjs";
// @ts-ignore
import { ANALYSIS_MODULES } from "../../scripts/faust-analysis-modules.mjs";
// @ts-ignore
import { modulePath } from "../../scripts/build-faust-library-modules.mjs";

const root = path.resolve(__dirname, "../..");
const SR = 48000;
const C4 = 261.6256;
const all = [...DRUM_MODULES, ...ANALYSIS_MODULES];
const byFile = (file: string) => all.find((m: any) => m.file == file);

async function compile(file: string) {
    const g = new fw.FaustMonoDspGenerator();
    await g.compile(await getCompiler(), "m", fs.readFileSync(path.join(root, "public", modulePath(byFile(file))), "utf8"), TEST_OPTIONS);
    const json = JSON.parse(g.factory!.json);
    return { g, json, widgets: listWidgets(json.ui) };
}

// A module to play: its widgets set by label, rendered by chunks (the gate pressed, then released...).
async function instance(file: string, params: Record<string, number> = {}) {
    const { g, widgets } = await compile(file);
    const p = (await g.createOfflineProcessor(SR, 512))!;
    const set = (o: Record<string, number>) => {
        for (const [label, v] of Object.entries(o)) {
            const w = widgets.find((x) => x.label == label);
            if (!w) throw new Error(`${file}: no widget ${label}`);
            p.setParamValue(w.address, v);
        }
    };
    set(params);
    return { set, render: (seconds: number, input?: Float32Array) => p.render(input ? [input] : [], Math.round(seconds * SR)) };
}

// a drum: the gate pressed for `held` seconds, then released for `after` seconds
async function play(file: string, params: Record<string, number>, held = 0.5, after = 1): Promise<{ on: Float32Array; off: Float32Array }> {
    const d = await instance(file, params);
    d.set({ Gate: 1 });
    const [on] = d.render(held);
    d.set({ Gate: 0 });
    const [off] = d.render(after);
    return { on, off };
}

const win = (x: Float32Array, t0: number, t1: number) => x.slice(Math.round(t0 * SR), Math.round(t1 * SR));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const db = (x: number) => 20 * Math.log10(x);
const cents = (f: number, g: number) => 1200 * Math.log2(f / g);
// the magnitude of a signal at a frequency (its Fourier transform, Hann window)
function magnitude(x: Float32Array, f: number): number {
    const w = (2 * Math.PI * f) / SR;
    let re = 0, im = 0;
    for (let n = 0; n < x.length; n++) {
        const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (x.length - 1));
        re += h * x[n] * Math.cos(w * n); im -= h * x[n] * Math.sin(w * n);
    }
    return Math.hypot(re, im);
}
// the frequency of the strongest component between lo and hi (1/1000 octave, refined by a parabola)
function strongest(x: Float32Array, lo: number, hi: number): number {
    const fs_: number[] = [];
    for (let f = lo; f <= hi; f *= 2 ** (1 / 1000)) fs_.push(f);
    const m = fs_.map((f) => db(magnitude(x, f)));
    const i = Math.max(1, Math.min(m.length - 2, m.indexOf(Math.max(...m))));
    const d = (0.5 * (m[i - 1] - m[i + 1])) / (m[i - 1] - 2 * m[i] + m[i + 1]);
    return fs_[i] * 2 ** (d / 1000);
}
const sine = (f: number, a: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, n) => a * Math.sin((2 * Math.PI * f * n) / SR));
const saw = (f: number, a: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, n) => a * (2 * (((f * n) / SR) % 1) - 1));
// a white noise, reproducible
const noise = (seconds: number) => { let s = 1; return Float32Array.from({ length: Math.round(seconds * SR) }, () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1); };
const mean = (x: Float32Array) => x.reduce((s, v) => s + v, 0) / x.length;

describe("drums and analyzers: interface", () => {
    it("drums: a Gate driven by a gate, Freq in Hz modulated in octaves, Pitch added; no input", async () => {
        for (const m of DRUM_MODULES) {
            const { json, widgets } = await compile(m.file);
            expect(json.inputs, m.name).toBe(0);
            expect(json.outputs, m.name).toBe(1);
            const gate = widgets.find((w) => w.label == "Gate")!;
            expect(gate.type, m.name).toBe("button");
            expect(allowedModes(gate), m.name).toContain("drive");
            const freq = widgets.find((w) => w.label == "Freq");
            if (freq) {
                expect(allowedModes(freq)[0], m.name).toBe("modulate");
                expect(allowedModes(widgets.find((w) => w.label == "Pitch")!), m.name).toEqual(["add"]);
            }
            expect(m.body, m.name).not.toMatch(/si\.smoo/);
        }
    }, 120_000);

    it("analyzers: one input, the outputs named", async () => {
        for (const m of ANALYSIS_MODULES) {
            const { json } = await compile(m.file);
            expect(json.inputs, m.name).toBe(1);
            expect(json.outputs, m.name).toBe(m.outlets.split(";").length);
        }
    }, 120_000);
});

describe("drums: signals", () => {
    it("silent until the gate, a sound after it, silent again after its release (the string rings on)", async () => {
        for (const m of DRUM_MODULES) {
            const d = await instance(m.file);
            const [before] = d.render(0.2);
            expect(peak(before), m.name).toBe(0);
            const { on, off } = await play(m.file, {});
            expect(peak(on), m.name).toBeGreaterThan(0.1);
            expect(peak(on), m.name).toBeLessThanOrEqual(1.05);
            if (m.file != "CombString") expect(rms(win(off, 0.5, 1)), m.name).toBeLessThan(1e-4);
        }
    }, 300_000);

    it("Kick: its tail at Freq transposed by Pitch, from up to five times higher; a linear envelope, silent at Attack + Decay", async () => {
        for (const [freq, pitch] of [[50, 0], [50, 0.1], [80, -0.05]]) {
            const { on } = await play("Kick", { Freq: freq, Pitch: pitch, Decay: 1000 }, 1);
            const f = freq * 2 ** (10 * pitch);
            expect(Math.abs(cents(strongest(win(on, 0.3, 0.8), f / 2, 2 * f), f)), `${freq} Hz, pitch ${pitch}`).toBeLessThan(5);
            // the first 20 ms: the pitch envelope near its top (1 + 4 x pitchenv), by the zero crossings
            const start = win(on, 0, 0.02);
            let crossings = 0;
            for (let n = 1; n < start.length; n++) if ((start[n] > 0) != (start[n - 1] > 0)) crossings++;
            expect(crossings / 2 / 0.02, `${freq} Hz, pitch ${pitch}`).toBeGreaterThan(2.5 * f);
        }
        // the envelope, linear (en.adsr): half way at Attack + Decay/2, where tanh(0.5)/tanh(1) = 0.607 of the top;
        // silent from Attack + Decay
        const { on } = await play("Kick", { Freq: 50, Attack: 5, Decay: 500, Click: 5 }, 1);
        expect(peak(win(on, 0.245, 0.265)) / peak(on)).toBeCloseTo(Math.tanh(0.5) / Math.tanh(1), 1);
        expect(peak(win(on, 0.51, 1))).toBe(0);
    }, 120_000);

    it("Pop Drum: rings at Freq transposed by Pitch; its level about the same from 50 Hz to 5 kHz", async () => {
        for (const [freq, pitch] of [[150, 0], [150, 0.1], [1000, 0]]) {
            const { on } = await play("PopDrum", { Freq: freq, Pitch: pitch, Q: 20 });
            const f = freq * 2 ** (10 * pitch);
            expect(Math.abs(cents(strongest(win(on, 0.005, 0.3), f / 2, 2 * f), f)), `${freq} Hz, pitch ${pitch}`).toBeLessThan(5);
        }
        for (const freq of [50, 150, 1000, 5000]) {
            const { on } = await play("PopDrum", { Freq: freq, Q: 5 });
            expect(peak(on), `${freq} Hz`).toBeGreaterThan(0.1);
            expect(peak(on), `${freq} Hz`).toBeLessThan(1.2);
        }
    }, 120_000);

    it("Additive Drum: the modes of a membrane (1, 1.594) or of a bar (1, 2.756)", async () => {
        for (const [mode, ratio] of [[0, 1.594], [1, 2.756]]) {
            const { on } = await play("AdditiveDrum", { Mode: mode, Freq: 200, Damping: 0 });
            const x = win(on, 0.02, 0.32);
            for (const f of [200, 200 * ratio]) {
                expect(Math.abs(cents(strongest(x, f * 0.95, f * 1.05), f)), `mode ${mode} at ${f} Hz`).toBeLessThan(5);
                expect(db(magnitude(x, f) / magnitude(x, f * 1.3)), `mode ${mode} at ${f} Hz`).toBeGreaterThan(20);
            }
        }
    }, 120_000);

    it("Comb String: tuned to Freq transposed by Pitch, its decay to -60 dB in Decay", async () => {
        for (const [freq, pitch] of [[220, 0], [220, 0.1], [110, 0]]) {
            const { on } = await play("CombString", { Freq: freq, Pitch: pitch, Decay: 2 }, 1);
            const f = freq * 2 ** (10 * pitch);
            expect(Math.abs(cents(strongest(win(on, 0.05, 0.55), f * 0.95, f * 1.05), f)), `${freq} Hz, pitch ${pitch}`).toBeLessThan(5);
        }
        // the decay of the fundamental: its level 0.5 s apart
        for (const decay of [1, 3]) {
            const { on } = await play("CombString", { Freq: 220, Decay: decay }, 2);
            const slope = (db(magnitude(win(on, 0.6, 0.8), 220)) - db(magnitude(win(on, 0.1, 0.3), 220))) / 0.5;
            expect(Math.abs(slope / (-60 / decay) - 1), `Decay ${decay} s: ${slope.toFixed(1)} dB/s`).toBeLessThan(0.1);
        }
    }, 120_000);

    it("Dub Synth and Saw Trombone: play Freq transposed by Pitch while the gate is held", async () => {
        for (const file of ["DubSynth", "SawTrombone"]) {
            for (const [freq, pitch] of [[110, 0], [110, 0.1], [220, -0.05]]) {
                const { on } = await play(file, { Freq: freq, Pitch: pitch });
                const f = freq * 2 ** (10 * pitch);
                expect(Math.abs(cents(strongest(win(on, 0.1, 0.5), f * 0.9, f * 1.1), f)), `${file} ${freq} Hz, pitch ${pitch}`).toBeLessThan(5);
                expect(rms(win(on, 0.3, 0.5)), file).toBeGreaterThan(0.05);
            }
        }
    }, 120_000);

    it("Clap and Hi-Hat: Tone makes them brighter", async () => {
        // the centroid of the spectrum, from 100 Hz to 20 kHz
        const centroid = (x: Float32Array) => {
            let s = 0, w = 0;
            for (let f = 100; f < 20000; f *= 2 ** (1 / 12)) { const m = magnitude(x, f) ** 2; s += f * m; w += m; }
            return s / w;
        };
        for (const [file, low, high] of [["Clap", 500, 3000], ["HiHat", 2000, 15000]] as Array<[string, number, number]>) {
            const a = (await play(file, { Tone: low, Decay: 300 })).on, b = (await play(file, { Tone: high, Decay: 300 })).on;
            expect(centroid(win(b, 0, 0.2)), file).toBeGreaterThan(1.3 * centroid(win(a, 0, 0.2)));
        }
    }, 120_000);
});

describe("analyzers: signals", () => {
    it("Pitch Tracker: the pitch of a sine or a sawtooth within 1 cent, a gate; the pitch held in the silence", async () => {
        for (const [name, wave] of [["sine", sine], ["saw", saw]] as const) {
            for (const f of [110, 220, 440, 880]) {
                const t = await instance("PitchTracker");
                const [pitch, gate] = t.render(1, wave(f, 0.5, 1));
                const tail = win(pitch, 0.5, 1);
                const expected = Math.log2(f / C4) / 10;
                expect(Math.abs(mean(tail) - expected) * 12000, `${name} ${f} Hz`).toBeLessThan(1);
                expect(peak(tail.map((v) => v - expected)) * 12000, `${name} ${f} Hz`).toBeLessThan(2);
                expect(win(gate, 0.5, 1).every((g) => g == 1), `${name} ${f} Hz`).toBe(true);
                // then the silence: the gate closes, the pitch stays
                const [held, closed] = t.render(0.5, new Float32Array(SR / 2));
                expect(closed[closed.length - 1], `${name} ${f} Hz`).toBe(0);
                expect(Math.abs(held[held.length - 1] - expected) * 12000, `${name} ${f} Hz`).toBeLessThan(2);
            }
        }
    }, 300_000);

    it("Spectral Centroid: a sine at its frequency, a white noise at SR/4", async () => {
        for (const f of [200, 1000, 4000]) {
            const [c] = (await instance("SpectralCentroid")).render(2, sine(f, 0.5, 2));
            expect(Math.abs(cents(C4 * 2 ** (10 * mean(win(c, 1, 2))), f)), `${f} Hz`).toBeLessThan(10);
        }
        const [c] = (await instance("SpectralCentroid")).render(2, noise(2));
        expect(C4 * 2 ** (10 * mean(win(c, 1, 2))) / (SR / 4)).toBeCloseTo(1, 1);
    }, 120_000);

    it("Zero Crossings: 2f/SR for a sine, 0.5 for a white noise", async () => {
        for (const f of [100, 1000, 5000]) {
            const [r] = (await instance("ZeroCrossings")).render(2, sine(f, 0.5, 2));
            expect(mean(win(r, 1, 2)) / ((2 * f) / SR), `${f} Hz`).toBeCloseTo(1, 2);
        }
        const [r] = (await instance("ZeroCrossings")).render(2, noise(2));
        expect(mean(win(r, 1, 2))).toBeCloseTo(0.5, 1);
    }, 120_000);

    it("RMS Level: the level in dB from the floor (0) to 0 dB (1)", async () => {
        for (const [a, bottom] of [[1, -60], [0.1, -60], [0.01, -60], [0.01, -30], [0.0001, -60]]) {
            const [l] = (await instance("RMSLevel", { Floor: bottom })).render(2, sine(1000, a, 2));
            const expected = Math.min(1, Math.max(0, (db(a / Math.SQRT2) - bottom) / -bottom));
            expect(Math.abs(mean(win(l, 1, 2)) - expected), `amplitude ${a}, floor ${bottom} dB`).toBeLessThan(0.002);
        }
    }, 120_000);
});
