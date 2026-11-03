// The saturators of aanl.lib (scripts/faust-saturation-modules.mjs) and the delays and modulation effects of
// misceffects.lib, phaflangers.lib and delays.lib (scripts/faust-delay-modules.mjs) as modules, measured
// offline: the curves kept within [-1, 1], their slope at 0, the aliasing the antiderivative method removes,
// the folds of the wavefolder; the echoes of the delays, the notches of the flanger, the depth of the vibrato
// in cents, the interval of the pitch shifter, the granulator as a delay, the dry sound of each at Mix 0.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { getCompiler, TEST_OPTIONS } from "../helpers/faust";
import { allowedModes, listWidgets } from "../../src/model/Modulation";
// @ts-ignore: Node.js scripts
import { SATURATION_MODULES } from "../../scripts/faust-saturation-modules.mjs";
// @ts-ignore
import { DELAY_MODULES } from "../../scripts/faust-delay-modules.mjs";
// @ts-ignore
import { modulePath } from "../../scripts/build-faust-library-modules.mjs";

const root = path.resolve(__dirname, "../..");
const SR = 48000;
const all = [...SATURATION_MODULES, ...DELAY_MODULES];
const byFile = (file: string) => all.find((m: any) => m.file == file);

async function compile(file: string) {
    const g = new fw.FaustMonoDspGenerator();
    await g.compile(await getCompiler(), "m", fs.readFileSync(path.join(root, "public", modulePath(byFile(file))), "utf8"), TEST_OPTIONS);
    const json = JSON.parse(g.factory!.json);
    return { g, json, widgets: listWidgets(json.ui) };
}

// the outputs of a module for its inputs, its widgets set by label
async function run(file: string, params: Record<string, number>, ...inputs: Float32Array[]): Promise<Float32Array[]> {
    const { g, widgets } = await compile(file);
    const p = (await g.createOfflineProcessor(SR, 512))!;
    for (const [label, v] of Object.entries(params)) {
        const w = widgets.find((x) => x.label == label);
        if (!w) throw new Error(`${file}: no widget ${label}`);
        p.setParamValue(w.address, v);
    }
    return p.render(inputs, inputs[0].length);
}

const sine = (f: number, a: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, n) => a * Math.sin((2 * Math.PI * f * n) / SR));
const impulse = (seconds: number) => { const x = new Float32Array(Math.round(seconds * SR)); x[0] = 1; return x; };
const noise = (seconds: number) => { let s = 1; return Float32Array.from({ length: Math.round(seconds * SR) }, () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1); };
const win = (x: Float32Array, t0: number, t1: number) => x.slice(Math.round(t0 * SR), Math.round(t1 * SR));
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const db = (x: number) => 20 * Math.log10(x);
const cents = (f: number, g: number) => 1200 * Math.log2(f / g);
// the gain of an impulse response at a frequency
function gainDb(h: Float32Array, f: number): number {
    const w = (2 * Math.PI * f) / SR;
    let re = 0, im = 0;
    for (let n = 0; n < h.length; n++) { re += h[n] * Math.cos(w * n); im -= h[n] * Math.sin(w * n); }
    return 10 * Math.log10(re * re + im * im + 1e-300);
}
// the magnitude of a signal at a frequency (Hann window)
function magnitude(x: Float32Array, f: number): number {
    const w = (2 * Math.PI * f) / SR;
    let re = 0, im = 0;
    for (let n = 0; n < x.length; n++) {
        const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (x.length - 1));
        re += h * x[n] * Math.cos(w * n); im -= h * x[n] * Math.sin(w * n);
    }
    return Math.hypot(re, im);
}
function strongest(x: Float32Array, lo: number, hi: number): number {
    const fs_: number[] = [];
    for (let f = lo; f <= hi; f *= 2 ** (1 / 2000)) fs_.push(f);
    const m = fs_.map((f) => db(magnitude(x, f)));
    const i = Math.max(1, Math.min(m.length - 2, m.indexOf(Math.max(...m))));
    const d = (0.5 * (m[i - 1] - m[i + 1])) / (m[i - 1] - 2 * m[i] + m[i + 1]);
    return fs_[i] * 2 ** (d / 2000);
}

// The power spectrum of a signal (radix 2 FFT, 4-term Blackman-Harris window), and the part of its power that is
// not at a harmonic of f0 below Nyquist (within 3 bins): the aliases, in dB relative to the whole power.
function aliasing(x: Float32Array, f0: number): number {
    const N = x.length;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let n = 0; n < N; n++) {
        const t = (2 * Math.PI * n) / (N - 1);
        re[n] = x[n] * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t));
    }
    for (let i = 1, j = 0; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= N; len <<= 1) {
        const a = (-2 * Math.PI) / len;
        for (let i = 0; i < N; i += len) {
            for (let k = 0; k < len / 2; k++) {
                const c = Math.cos(a * k), s = Math.sin(a * k);
                const ur = re[i + k], ui = im[i + k];
                const vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
                re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            }
        }
    }
    const harmonic = new Set<number>();
    for (let m = 1; m * f0 < SR / 2; m++) {
        const b = Math.round((m * f0 * N) / SR);
        for (let d = -3; d <= 3; d++) harmonic.add(b + d);
    }
    let total = 0, alias = 0;
    for (let b = 4; b < N / 2; b++) {
        const p = re[b] * re[b] + im[b] * im[b];
        total += p;
        if (!harmonic.has(b)) alias += p;
    }
    return 10 * Math.log10(alias / total);
}

describe("saturators and delays: interface", () => {
    it("one input and one output (the expander: two), times in ms and rates in Hz on a log scale, no smoothing", async () => {
        for (const m of all) {
            const { json, widgets } = await compile(m.file);
            const ports = m.inlets.split(";").length;
            expect(json.inputs, m.name).toBe(ports);
            expect(json.outputs, m.name).toBe(m.outlets.split(";").length);
            for (const w of widgets) {
                if (["Time", "Delay", "Grain", "Window"].includes(w.label)) expect(w.meta.scale, `${m.name} ${w.label}`).toBe("log");
                if (["Rate", "Min", "Max", "Width"].includes(w.label)) {
                    expect(w.meta.unit, `${m.name} ${w.label}`).toBe("Hz");
                    expect(allowedModes(w)[0], `${m.name} ${w.label}`).toBe("modulate");
                }
            }
            expect(m.body, m.name).not.toMatch(/si\.smoo/);
        }
    }, 120_000);
});

describe("saturators", () => {
    const SLOPES = [1, 1.5, 1, 2 / Math.PI, 1, 1, 1, 2, 1];
    it("Waveshaper: each curve within [-1, 1] (but asinh), its slope at 0 (1, 1.5 cubic, 2/pi arctan, 2 quadratic)", async () => {
        for (let shape = 0; shape < 9; shape++) {
            for (const order of [0, 1]) {
                // within [-1, 1]: the first order up to 36 dB of drive, low and high; the second order, which
                // overshoots in single precision at low frequencies when driven hard, up to 24 dB (measured: 1%)
                if (shape != 8) {
                    for (const f of [50, 5000]) {
                        const [y] = await run("Waveshaper", { Shape: shape, Antialiasing: order, Drive: order ? 24 : 36 }, sine(f, 1, 0.5));
                        expect(peak(win(y, 0.1, 0.5)), `shape ${shape} order ${order} at ${f} Hz`).toBeLessThan(order ? 1.02 : 1.002);
                    }
                }
                const [small] = await run("Waveshaper", { Shape: shape, Antialiasing: order, Drive: 0 }, sine(1000, 0.001, 0.5));
                const gain = magnitude(win(small, 0.1, 0.5), 1000) / magnitude(win(sine(1000, 0.001, 0.5), 0.1, 0.5), 1000);
                // the kernel of the method, (x[n] + x[n-1])/2 at the first order, is a low pass: -0.02 dB at 1 kHz
                expect(Math.abs(db(gain / SLOPES[shape])), `shape ${shape} order ${order}`).toBeLessThan(0.05);
            }
        }
    }, 300_000);

    it("Waveshaper: the antiderivative method removes the aliases of a hard clip", async () => {
        // a sine at 4987 Hz driven by 24 dB into a hard clip: its harmonics above 24 kHz fold between the others
        const f0 = 4987, x = sine(f0, 1, 1.5), N = 32768, drive = 10 ** (24 / 20);
        const naive = win(x.map((v) => Math.max(-1, Math.min(1, drive * v))), 0.5, 0.5 + N / SR);
        const [first] = await run("Waveshaper", { Shape: 0, Antialiasing: 0, Drive: 24 }, x);
        const [second] = await run("Waveshaper", { Shape: 0, Antialiasing: 1, Drive: 24 }, x);
        const a0 = aliasing(naive, f0), a1 = aliasing(win(first, 0.5, 0.5 + N / SR), f0), a2 = aliasing(win(second, 0.5, 0.5 + N / SR), f0);
        // measured: -11.1 dB through the curve itself, -18.1 dB at the first order, -22.3 dB at the second
        expect(a1).toBeLessThan(a0 - 5);
        expect(a2).toBeLessThan(a1 - 3);
    }, 120_000);

    it("Waveshaper and Wavefolder: the dry sound at Mix 0, the level in dB", async () => {
        const x = noise(0.3);
        for (const file of ["Waveshaper", "Wavefolder"]) {
            const [y] = await run(file, { Mix: 0, Level: -6 }, x);
            expect(peak(y.map((v, n) => v - x[n] * 10 ** (-6 / 20))), file).toBeLessThan(1e-6);
        }
    }, 120_000);

    it("Wavefolder: unchanged within [-1, 1]; folded beyond (a sine of amplitude 3 crosses zero 6 times a period), within [-1, 1]", async () => {
        for (const [shape, order] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const [y] = await run("Wavefolder", { Shape: shape, Antialiasing: order, Drive: 0 }, sine(1000, 0.5, 0.5));
            const g = magnitude(win(y, 0.1, 0.5), 1000) / magnitude(win(sine(1000, 0.5, 0.5), 0.1, 0.5), 1000);
            expect(Math.abs(db(g)), `shape ${shape} order ${order}`).toBeLessThan(0.05);
            const [w] = await run("Wavefolder", { Shape: shape, Antialiasing: order, Drive: 36 }, sine(100, 1, 0.5));
            expect(peak(win(w, 0.1, 0.5)), `shape ${shape} order ${order} at 36 dB`).toBeLessThan(1.02);
            const [z] = await run("Wavefolder", { Shape: shape, Antialiasing: order, Drive: db(3) }, sine(100, 1, 0.5));
            const tail = win(z, 0.2, 0.5);
            let crossings = 0;
            for (let n = 1; n < tail.length; n++) if ((tail[n] > 0) != (tail[n - 1] > 0)) crossings++;
            expect(crossings / 30, `shape ${shape} order ${order}`).toBeCloseTo(6, 0);
            expect(peak(tail), `shape ${shape} order ${order}`).toBeLessThan(1.02);
        }
    }, 120_000);
});

describe("delays and modulation", () => {
    it("Echo: echoes every Time, the first Feedback times the sound, each next one Feedback times the previous one, Mix times their level", async () => {
        const [h] = await run("Echo", { Time: 100, Feedback: 0.5, Mix: 0.8 }, impulse(0.5));
        const D = 4800;
        expect(h[0]).toBeCloseTo(0.2, 5);
        for (let k = 1; k <= 3; k++) expect(h[k * D], `echo ${k}`).toBeCloseTo(0.8 * 0.5 ** k, 5);
        expect(peak(h.map((v, n) => (n % D == 0 ? 0 : v)))).toBeLessThan(1e-6);
    }, 60_000);

    it("Delay: the delayed sound every Time (fractional), each echo Feedback times the previous one", async () => {
        const [h] = await run("Delay", { Time: 10.5, Feedback: 0.5, Mix: 1 }, impulse(0.1));
        // 10.5 ms = 504 samples
        expect(h[0]).toBeCloseTo(0, 6);
        expect(h[504]).toBeCloseTo(1, 4);
        expect(h[1008]).toBeCloseTo(0.5, 4);
        const [g] = await run("Delay", { Time: 10.51, Feedback: 0, Mix: 1 }, impulse(0.1));
        // 504.48 samples: shared by the two samples around it
        expect(g[504] + g[505]).toBeCloseTo(1, 3);
        expect(g[505] / (g[504] + g[505])).toBeCloseTo(0.48, 2);
    }, 60_000);

    it("Flanger: a comb, with the delay fixed (Sweep 0): notches at odd multiples of 1/(2 Delay), at multiples of 1/Delay inverted", async () => {
        const [h] = await run("Flanger", { Delay: 1, Sweep: 0, Depth: 1, Feedback: 0 }, impulse(0.1));
        expect(gainDb(h, 500)).toBeLessThan(-40);
        expect(gainDb(h, 1500)).toBeLessThan(-40);
        expect(gainDb(h, 1000)).toBeCloseTo(0, 1);
        const [i] = await run("Flanger", { Delay: 1, Sweep: 0, Depth: 1, Feedback: 0, Invert: 1 }, impulse(0.1));
        expect(gainDb(i, 1000)).toBeLessThan(-40);
        expect(gainDb(i, 500)).toBeCloseTo(0, 1);
    }, 60_000);

    it("Phaser: the dry sound at Depth 0; notches with depth", async () => {
        const x = noise(0.3);
        const [y] = await run("Phaser", { Depth: 0 }, x);
        expect(peak(y.map((v, n) => v - x[n]))).toBeLessThan(1e-5);
        for (const notches of [0, 1, 2]) {
            const [h] = await run("Phaser", { Notches: notches, Rate: 0.01, Depth: 1, Min: 100, Max: 100, Ratio: 1.5, Width: 100 }, impulse(0.5));
            const fs_: number[] = [];
            for (let f = 50; f < 20000; f *= 2 ** (1 / 96)) fs_.push(f);
            const g = fs_.map((f) => gainDb(h, f));
            const minima = g.filter((v, k) => k > 0 && k < g.length - 1 && v < g[k - 1] && v < g[k + 1] && v < -20).length;
            expect(minima, `notches ${notches}`).toBe([2, 4, 8][notches]);
        }
    }, 120_000);

    it("Vibrato: its pitch rises by Depth cents at most, at Rate", async () => {
        for (const [rate, depth] of [[5, 20], [2, 50], [10, 10]]) {
            const [y] = await run("Vibrato", { Rate: rate, Depth: depth }, sine(1000, 0.5, 2));
            // the frequency of each period, by its rising zero crossings (interpolated)
            const ups: number[] = [];
            for (let n = Math.round(0.5 * SR); n < y.length; n++) if (y[n - 1] <= 0 && y[n] > 0) ups.push(n - 1 + y[n - 1] / (y[n - 1] - y[n]));
            const freqs = ups.slice(1).map((u, k) => SR / (u - ups[k]));
            const high = cents(Math.max(...freqs), 1000), low = cents(Math.min(...freqs), 1000);
            expect(Math.abs(high - depth), `${rate} Hz, ${depth} cents`).toBeLessThan(0.05 * depth + 0.5);
            // the speed 1 - d'(t) falls as much as it rises: 2 - 2^(c/1200)
            expect(Math.abs(low - cents(2 - 2 ** (depth / 1200), 1)), `${rate} Hz, ${depth} cents`).toBeLessThan(0.05 * depth + 0.5);
        }
    }, 120_000);

    it("Pitch Shifter: a sine shifted by Shift semitones; the dry sound at Mix 0", async () => {
        for (const shift of [7, -5, 12]) {
            const [y] = await run("PitchShifter", { Shift: shift, Window: 50 }, sine(440, 0.5, 2));
            const f = 440 * 2 ** (shift / 12);
            const x = win(y, 0.5, 2);
            expect(Math.abs(cents(strongest(x, f * 0.97, f * 1.03), f)), `shift ${shift}`).toBeLessThan(2);
            expect(db(magnitude(x, f) / magnitude(x, 440)), `shift ${shift}`).toBeGreaterThan(20);
        }
        const x = noise(0.3);
        const [y] = await run("PitchShifter", { Mix: 0 }, x);
        expect(peak(y.map((v, n) => v - x[n]))).toBeLessThan(1e-6);
    }, 120_000);

    it("Granular: with no shift and no jitter, the sound delayed by Position; shifted by an octave, at twice its frequency", async () => {
        const x = noise(1);
        const [y] = await run("Granular", { Grain: 50, Shift: 0, Position: 100, Jitter: 0, Mix: 1 }, x);
        const D = 4800, from = Math.round(0.3 * SR);
        let diff = 0;
        for (let n = from; n < y.length; n++) diff = Math.max(diff, Math.abs(y[n] - x[n - D]));
        expect(diff).toBeLessThan(2e-3);
        const [z] = await run("Granular", { Grain: 50, Shift: 12, Position: 100, Jitter: 0 }, sine(300, 0.5, 2));
        expect(Math.abs(cents(strongest(win(z, 0.5, 2), 570, 630), 600))).toBeLessThan(2);
    }, 120_000);

    it("Dimension Expander: the dry sound at Wet 0; a mono sound made stereo", async () => {
        const x = noise(1);
        const [l0, r0] = await run("DimensionExpander", { Wet: 0 }, x, x);
        expect(peak(l0.map((v, n) => v - x[n]))).toBeLessThan(1e-5);
        expect(peak(r0.map((v, n) => v - x[n]))).toBeLessThan(1e-5);
        const [l, r] = await run("DimensionExpander", { Wet: 1, Size: 0.5 }, x, x);
        expect(rms(win(l, 0.5, 1).map((v, n) => v - win(r, 0.5, 1)[n]))).toBeGreaterThan(0.05 * rms(win(x, 0.5, 1)));
    }, 120_000);
});
