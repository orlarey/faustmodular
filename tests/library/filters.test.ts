// The filters, equalizers and pedals of the Faust libraries (scripts/faust-filter-modules.mjs): their interface
// (Cutoff in Hz on a log scale, Pitch, Q, menus) and their frequency responses, measured offline on the impulse
// response of the module (or on a small impulse for the filters that saturate their input), against the
// theory: -3 dB at the cutoff of a Butterworth filter, the slope of each order, Q at the cutoff of a second
// order low pass, -6 dB and a flat sum for the Linkwitz-Riley crossovers, the conversion of the cutoff to the
// normalized frequency of vaeffects.lib, the cutoff following the pitch...
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { getCompiler, TEST_OPTIONS } from "../helpers/faust";
import { allowedModes, listWidgets } from "../../src/model/Modulation";
// @ts-ignore: Node.js scripts
import { FILTER_MODULES } from "../../scripts/faust-filter-modules.mjs";
// @ts-ignore
import { modulePath } from "../../scripts/build-faust-library-modules.mjs";

const root = path.resolve(__dirname, "../..");
const SR = 48000;
const N = 1 << 15;

const byName = (name: string) => FILTER_MODULES.find((m: any) => m.name == name);
const code = (m: any) => fs.readFileSync(path.join(root, "public", modulePath(m)), "utf8");

async function compile(name: string) {
    const g = new fw.FaustMonoDspGenerator();
    await g.compile(await getCompiler(), "m", code(byName(name)), TEST_OPTIONS);
    const json = JSON.parse(g.factory!.json);
    return { g, json, widgets: listWidgets(json.ui) };
}

// The outputs of a module for an input, its widgets set by label.
async function render(name: string, params: Record<string, number>, input: Float32Array): Promise<Float32Array[]> {
    const { g, widgets } = await compile(name);
    const processor = (await g.createOfflineProcessor(SR, 1024))!;
    for (const [label, value] of Object.entries(params)) {
        const w = widgets.find((x) => x.label == label);
        if (!w) throw new Error(`${name}: no widget ${label}`);
        processor.setParamValue(w.address, value);
    }
    return processor.render([input], input.length);
}

// The impulse responses of the outputs (an impulse of `amplitude`, divided by it).
async function impulse(name: string, params: Record<string, number>, amplitude = 1): Promise<Float32Array[]> {
    const x = new Float32Array(N);
    x[0] = amplitude;
    return (await render(name, params, x)).map((h) => h.map((v) => v / amplitude));
}

// The gain in dB of an impulse response at a frequency (its discrete-time Fourier transform).
function gainDb(h: Float32Array | number[], f: number): number {
    const w = (2 * Math.PI * f) / SR;
    let re = 0, im = 0;
    for (let n = 0; n < h.length; n++) { re += h[n] * Math.cos(w * n); im -= h[n] * Math.sin(w * n); }
    return 10 * Math.log10(re * re + im * im + 1e-300);
}

// The frequency of the highest gain, on a 1/96 octave grid then refined by a parabola (in log frequency).
function peakFrequency(h: Float32Array, from: number, to: number): number {
    const fs_: number[] = [];
    for (let f = from; f <= to; f *= 2 ** (1 / 96)) fs_.push(f);
    const g = fs_.map((f) => gainDb(h, f));
    const i = Math.max(1, Math.min(g.length - 2, g.indexOf(Math.max(...g))));
    const d = (0.5 * (g[i - 1] - g[i + 1])) / (g[i - 1] - 2 * g[i] + g[i + 1]);
    return fs_[i] * 2 ** (d / 96);
}

const sum = (...hs: Float32Array[]) => hs[0].map((_, n) => hs.reduce((s, h) => s + h[n], 0));
const cents = (f: number, g: number) => Math.abs(1200 * Math.log2(f / g));
// the analog frequency that the bilinear transform prewarped at fc maps to f
const warped = (f: number, fc: number) => Math.tan((Math.PI * f) / SR) / Math.tan((Math.PI * fc) / SR);

describe("filters, equalizers and pedals of the Faust libraries: interface", () => {
    it("Cutoff and Frequency in Hz on a log scale (modulated in octaves), Pitch added, Q on a log scale", async () => {
        for (const m of FILTER_MODULES) {
            const { widgets } = await compile(m.name);
            for (const w of widgets) {
                const meta = w.meta;
                if (["Cutoff", "Frequency", "Low", "Mid", "High", "Width"].includes(w.label)) {
                    expect(meta.unit, `${m.name} ${w.label}`).toBe("Hz");
                    expect(meta.scale, `${m.name} ${w.label}`).toBe("log");
                    expect(allowedModes(w)[0], `${m.name} ${w.label}`).toBe("modulate");
                }
                if (w.label == "Pitch") expect(allowedModes(w), m.name).toEqual(["add"]);
                if (w.label == "Q") expect(meta.scale, m.name).toBe("log");
                // the menus: no '-' in their labels (the JSON of Faust quotes them)
                if (meta.style?.startsWith("menu")) expect(meta.style, m.name).not.toMatch(/'[^']*-[^']*'/);
            }
            // a Pitch on each filter with a cutoff
            if (widgets.some((w) => w.label == "Cutoff")) expect(widgets.some((w) => w.label == "Pitch"), m.name).toBe(true);
            expect(m.body, m.name).not.toMatch(/si\.smoo/);
        }
    }, 300_000);

    it("their ports: one input, the outputs of the crossovers named", async () => {
        for (const m of FILTER_MODULES) {
            const { json } = await compile(m.name);
            expect(json.inputs, m.name).toBe(1);
            expect(json.outputs, m.name).toBe(m.outlets.split(";").length);
        }
    }, 300_000);
});

describe("filters: frequency responses", () => {
    const fc = 1000;
    const at = (h: Float32Array, fs: number[]) => fs.map((f) => gainDb(h, f));

    it("SVF: the nine responses of a second order filter, -3 dB at the cutoff for Q = 0.707", async () => {
        const response = async (mode: number, q = Math.SQRT1_2, gain = 6) => (await impulse("SVF Filter", { Mode: mode, Cutoff: fc, Q: q, Gain: gain }))[0];
        const lp = await response(0), bp = await response(1), hp = await response(2), notch = await response(3), ap = await response(5);
        for (const h of [lp, bp, hp]) expect(gainDb(h, fc)).toBeCloseTo(-3.01, 1);
        expect(gainDb(lp, 20)).toBeCloseTo(0, 2);
        expect(gainDb(lp, 10 * fc)).toBeLessThan(-40);
        expect(gainDb(hp, 20000)).toBeCloseTo(0, 1);
        expect(gainDb(hp, fc / 10)).toBeLessThan(-39);
        expect(peakFrequency(bp, 200, 5000)).toBeCloseTo(fc, -1);
        expect(gainDb(notch, fc)).toBeLessThan(-60);
        for (const f of [20, 200, 1000, 5000, 20000]) expect(gainDb(ap, f)).toBeCloseTo(0, 2);
        // the bell: the gain at the cutoff; the shelves: the gain far below (low) or above (high)
        expect(gainDb(await response(6, 2, 9), fc)).toBeCloseTo(9, 1);
        expect(gainDb(await response(7, Math.SQRT1_2, -12), 20)).toBeCloseTo(-12, 1);
        expect(gainDb(await response(8, Math.SQRT1_2, -12), 20000)).toBeCloseTo(-12, 0);
        // the resonance of the low pass at the cutoff: Q (20 log10 Q dB)
        expect(gainDb(await response(0, 10), fc)).toBeCloseTo(20, 1);
    }, 120_000);

    it("Resonant: low pass, high pass, band pass, Q at the cutoff", async () => {
        for (const mode of [0, 1, 2]) {
            const [h] = await impulse("Resonant Filter", { Mode: mode, Cutoff: fc, Q: 10 });
            expect(gainDb(h, fc), `mode ${mode}`).toBeCloseTo(20, 1);
            expect(cents(peakFrequency(h, 300, 3000), fc), `mode ${mode}`).toBeLessThan(10);
        }
        const [lp] = await impulse("Resonant Filter", { Mode: 0, Cutoff: fc, Q: Math.SQRT1_2 });
        const [hp] = await impulse("Resonant Filter", { Mode: 1, Cutoff: fc, Q: Math.SQRT1_2 });
        expect(gainDb(lp, 20)).toBeCloseTo(0, 2);
        expect(gainDb(hp, 20000)).toBeCloseTo(0, 1);
        expect(gainDb(lp, 10 * fc)).toBeLessThan(-40);
        expect(gainDb(hp, fc / 10)).toBeLessThan(-39);
    }, 120_000);

    it("Butterworth: -3 dB at the cutoff, |H|² = 1/(1 + Ω^2N) at every order (Ω prewarped)", async () => {
        const orders = [1, 2, 4, 8];
        for (const mode of [0, 1]) {
            for (let order = 0; order < 4; order++) {
                const N = orders[order];
                const [h] = await impulse("Butterworth Filter", { Mode: mode, Order: order, Cutoff: fc });
                expect(gainDb(h, fc), `mode ${mode} order ${N}`).toBeCloseTo(-3.01, 1);
                for (const f of [250, 500, 2000, 4000]) {
                    const w = mode == 0 ? warped(f, fc) : 1 / warped(f, fc);
                    const theory = -10 * Math.log10(1 + w ** (2 * N));
                    expect(gainDb(h, f), `mode ${mode} order ${N} at ${f} Hz`).toBeCloseTo(theory, 1);
                }
            }
        }
    }, 120_000);

    it("Elliptic: -0.2 dB at the edge of the passband, a steep transition", async () => {
        const expected: Array<[number, number, number, number]> = [
            // mode, order, frequency of the stopband, gain below
            [0, 0, 4000, -37], [0, 1, 2000, -78], [1, 0, 250, -37], [1, 1, 500, -76],
        ];
        for (const [mode, order, stop, below] of expected) {
            const [h] = await impulse("Elliptic Filter", { Mode: mode, Order: order, Cutoff: fc });
            expect(gainDb(h, fc), `mode ${mode} order ${order}`).toBeCloseTo(-0.2, 1);
            // the ripples of the passband within 0.2 dB
            for (const f of mode == 0 ? [100, 300, 700, 950] : [1100, 2000, 5000, 15000]) {
                expect(gainDb(h, f), `mode ${mode} order ${order} at ${f} Hz`).toBeGreaterThan(-0.21);
                expect(gainDb(h, f), `mode ${mode} order ${order} at ${f} Hz`).toBeLessThan(0.01);
            }
            expect(gainDb(h, stop), `mode ${mode} order ${order} at ${stop} Hz`).toBeLessThan(below);
        }
    }, 120_000);

    it("Moog Ladder: the cutoff converted to the normalized frequency of vaeffects.lib (four poles at fc: -12.04 dB)", async () => {
        // Q = 0.707: no feedback, four one pole low pass filters at the cutoff, each at -3.01 dB there
        for (const cutoff of [100, 1000, 5000]) {
            const [h] = await impulse("Moog Ladder", { Cutoff: cutoff, Q: 0.707 });
            expect(gainDb(h, cutoff), `${cutoff} Hz`).toBeCloseTo(-12.04, 1);
            expect(gainDb(h, cutoff / 20), `${cutoff} Hz`).toBeCloseTo(0, 1);
        }
        // the resonance: a peak near the cutoff (measured 942 Hz for 1000 Hz at Q = 20)
        const [h] = await impulse("Moog Ladder", { Cutoff: fc, Q: 20 });
        expect(cents(peakFrequency(h, 300, 3000), fc)).toBeLessThan(150);
    }, 120_000);

    it("Sallen-Key, Oberheim, Korg 35: low pass and high pass at -3 dB (-6 dB for the Korg 35 low pass), a resonant peak at the cutoff", async () => {
        const cases: Array<[string, number, number, number]> = [
            // module, mode, gain at the cutoff for the lowest Q (dB), the low pass or high pass (0, 1); far from
            // the cutoff, the high pass of the Korg 35 falls by 6 dB per octave only (measured -20 dB at fc/10)
            ["Sallen-Key Filter", 0, -3.01, 0], ["Sallen-Key Filter", 2, -3.01, 1],
            ["Oberheim Filter", 0, -3.01, 0], ["Oberheim Filter", 1, -3.01, 1],
            ["Korg 35", 0, -6.02, 0], ["Korg 35", 1, -3.01, 1],
        ];
        for (const [name, mode, level, high] of cases) {
            const q = byName(name).body.match(/Q\[scale:log\]", [\d.]+, ([\d.]+)/)[1];
            const [h] = await impulse(name, { Mode: mode, Cutoff: fc, Q: Math.max(0.707, Number(q)) });
            expect(Math.abs(gainDb(h, fc) - level), `${name} mode ${mode}`).toBeLessThan(0.1);
            expect(gainDb(h, high ? 20000 : 20), `${name} mode ${mode}`).toBeCloseTo(0, 0);
            expect(gainDb(h, high ? fc / 10 : 10 * fc), `${name} mode ${mode}`).toBeLessThan(name == "Korg 35" && high ? -19 : -30);
            const [r] = await impulse(name, { Mode: mode, Cutoff: fc, Q: 8 });
            expect(gainDb(r, fc), `${name} mode ${mode}`).toBeGreaterThan(7);
            expect(cents(peakFrequency(r, 300, 3000), fc), `${name} mode ${mode}`).toBeLessThan(100);
        }
        // the band pass of the Sallen-Key and the Oberheim: centered on the cutoff
        for (const [name, mode] of [["Sallen-Key Filter", 1], ["Oberheim Filter", 2]] as Array<[string, number]>) {
            const [h] = await impulse(name, { Mode: mode, Cutoff: fc, Q: 2 });
            expect(cents(peakFrequency(h, 200, 5000), fc), name).toBeLessThan(5);
        }
        // the band stop of the Oberheim: a notch at the cutoff
        const [bs] = await impulse("Oberheim Filter", { Mode: 3, Cutoff: fc, Q: 0.707 });
        expect(gainDb(bs, fc)).toBeLessThan(-40);
        expect(gainDb(bs, 20)).toBeCloseTo(0, 1);
    }, 300_000);

    it("Diode Ladder (small signal, its input saturates): a low pass whose resonance rises with Q", async () => {
        const [low] = await impulse("Diode Ladder", { Cutoff: fc, Q: 0.7 }, 1e-4);
        const [high] = await impulse("Diode Ladder", { Cutoff: fc, Q: 15 }, 1e-4);
        expect(gainDb(low, 10 * fc) - gainDb(low, 20)).toBeLessThan(-80);
        const peak = peakFrequency(high, 200, 3000);
        expect(gainDb(high, peak) - gainDb(high, 20)).toBeGreaterThan(5);
    }, 120_000);

    it("Notch: the cutoff removed, -3 dB at half the width on each side", async () => {
        const [h] = await impulse("Notch Filter", { Cutoff: fc, Width: 100 });
        expect(gainDb(h, fc)).toBeLessThan(-60);
        expect(gainDb(h, fc - 50)).toBeCloseTo(-3, 0);
        expect(gainDb(h, fc + 50)).toBeCloseTo(-3, 0);
        expect(gainDb(h, 100)).toBeCloseTo(0, 1);
        expect(gainDb(h, 10000)).toBeCloseTo(0, 1);
    }, 60_000);

    it("DC Blocker: no constant, transparent above 100 Hz", async () => {
        const [h] = await impulse("DC Blocker", {});
        expect(gainDb(h, 0.1)).toBeLessThan(-50);
        expect(Math.abs(gainDb(h, 100))).toBeLessThan(0.6);
        expect(Math.abs(gainDb(h, 1000))).toBeLessThan(0.05);
    }, 60_000);

    it("Pitch: the cutoff of each filter moves by an octave for 0.1, as if the cutoff were set there", async () => {
        for (const m of FILTER_MODULES.filter((x: any) => x.body.includes("Pitch"))) {
            const small = m.name == "Diode Ladder" ? 1e-4 : 1;
            const [a] = await impulse(m.name, { Cutoff: 500, Pitch: 0.1 }, small);
            const [b] = await impulse(m.name, { Cutoff: 1000, Pitch: 0 }, small);
            const [c] = await impulse(m.name, { Cutoff: 2000, Pitch: -0.1 }, small);
            let diff = 0, peak = 0;
            for (let n = 0; n < b.length; n++) { diff = Math.max(diff, Math.abs(a[n] - b[n]), Math.abs(c[n] - b[n])); peak = Math.max(peak, Math.abs(b[n])); }
            expect(diff / peak, m.name).toBeLessThan(1e-4);
        }
    }, 300_000);
});

describe("equalizers and crossovers: frequency responses", () => {
    it("shelves: the gain far below (low) or above (high) the frequency, 0 dB on the other side", async () => {
        for (const g of [-12, 12]) {
            const [low] = await impulse("Low Shelf", { Gain: g, Frequency: 200 });
            expect(gainDb(low, 20)).toBeCloseTo(g, 0);
            expect(gainDb(low, 2000)).toBeCloseTo(0, 1);
            const [high] = await impulse("High Shelf", { Gain: g, Frequency: 5000 });
            expect(gainDb(high, 20000)).toBeCloseTo(g, 0);
            expect(gainDb(high, 500)).toBeCloseTo(0, 1);
        }
    }, 60_000);

    it("Peak EQ: the gain at the frequency, 0 dB far from it", async () => {
        for (const [g, f, q] of [[12, 1000, 2], [-9, 300, 5], [6, 8000, 1]]) {
            const [h] = await impulse("Peak EQ", { Gain: g, Frequency: f, Q: q });
            expect(gainDb(h, f), `${g} dB at ${f} Hz`).toBeCloseTo(g, 1);
            expect(Math.abs(gainDb(h, f / 30)), `${g} dB at ${f} Hz`).toBeLessThan(0.1);
            expect(cents(peakFrequency(h.map((v, n) => (g > 0 ? v : (n == 0 ? 2 : 0) - v)) as Float32Array, f / 4, Math.min(4 * f, 20000)), f)).toBeLessThan(g > 0 ? 5 : 1200);
        }
    }, 60_000);

    it("Linkwitz-Riley crossovers: each band at -6.02 dB at its crossovers, their sum flat (an all pass)", async () => {
        const cases: Array<[string, Record<string, number>, number[]]> = [
            ["Crossover 2", { Frequency: 800 }, [800]],
            ["Crossover 3", { Low: 250, High: 4000 }, [250, 4000]],
            ["Crossover 4", { Low: 150, Mid: 1200, High: 6000 }, [150, 1200, 6000]],
        ];
        for (const [name, params, crossovers] of cases) {
            const bands = await impulse(name, params);
            expect(bands.length, name).toBe(crossovers.length + 1);
            crossovers.forEach((f, i) => {
                expect(gainDb(bands[i], f), `${name} band ${i} at ${f} Hz`).toBeCloseTo(-6.02, 1);
                expect(gainDb(bands[i + 1], f), `${name} band ${i + 1} at ${f} Hz`).toBeCloseTo(-6.02, 1);
            });
            const all = sum(...bands);
            for (const f of [20, 100, 500, 1000, 3000, 10000, 20000]) expect(Math.abs(gainDb(all, f)), `${name} sum at ${f} Hz`).toBeLessThan(0.01);
        }
        // the crossovers kept in order: High below Low is taken as Low
        const [low, mid, high] = await impulse("Crossover 3", { Low: 2000, High: 500 });
        expect(gainDb(low, 2000)).toBeCloseTo(-6.02, 1);
        expect(gainDb(sum(low, mid, high), 1000)).toBeCloseTo(0, 2);
    }, 120_000);

    it("Spectral Tilt: the slope in dB per octave inside the band, flat below", async () => {
        for (const slope of [-6, -3, 2, 6]) {
            const [h] = await impulse("Spectral Tilt", { Slope: slope, Low: 50, High: 10000 });
            const measured = (gainDb(h, 3200) - gainDb(h, 200)) / 4;
            expect(Math.abs(measured - slope), `${slope} dB per octave`).toBeLessThan(0.1);
            // (the zeros below Low for a rising slope: within 0.4 dB at 5 Hz)
            expect(Math.abs(gainDb(h, 5)), `${slope} dB per octave`).toBeLessThan(0.4);
        }
    }, 60_000);
});

describe("pedals", () => {
    const sine = (f: number, a: number, seconds = 1) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, n) => a * Math.sin((2 * Math.PI * f * n) / SR));
    const rms = (x: Float32Array, from = 0) => Math.sqrt(x.slice(from).reduce((s, v) => s + v * v, 0) / (x.length - from));

    it("drive a guitar level sine: a finite, non silent output; more gain, more level", async () => {
        const input = sine(220, 0.3);
        const half = Math.round(0.5 * SR);
        for (const [name, low, high] of [
            ["Klon Centaur", { Gain: 0.1 }, { Gain: 0.9 }],
            ["Fulltone OCD", { Drive: 0, Volume: 0.1 }, { Drive: 1, Volume: 0.1 }],
        ] as Array<[string, Record<string, number>, Record<string, number>]>) {
            const [a] = await render(name, low, input);
            const [b] = await render(name, high, input);
            for (const x of [a, b]) expect(x.every(Number.isFinite), name).toBe(true);
            expect(rms(a, half), name).toBeGreaterThan(1e-3);
            expect(rms(b, half), name).toBeGreaterThan(rms(a, half));
        }
    }, 120_000);

    it("MXR Phase 90 and Auto Wah: the signal moved, not lost", async () => {
        const noise = Float32Array.from({ length: SR }, (_, n) => 0.3 * Math.sin(n * 12.9898) * Math.sin(n * 0.07));
        for (const [name, params] of [["MXR Phase 90", { Rate: 2 }], ["Auto Wah", { Level: 1 }]] as Array<[string, Record<string, number>]>) {
            const [y] = await render(name, params, noise);
            expect(y.every(Number.isFinite), name).toBe(true);
            const diff = y.map((v, n) => v - noise[n]);
            expect(rms(y), name).toBeGreaterThan(0.1 * rms(noise));
            expect(rms(diff), name).toBeGreaterThan(0.05 * rms(noise));
        }
        // Auto Wah at Level 0: the dry signal
        const [dry] = await render("Auto Wah", { Level: 0 }, noise);
        expect(Math.max(...dry.map((v, n) => Math.abs(v - noise[n])))).toBeLessThan(1e-6);
    }, 120_000);
});
