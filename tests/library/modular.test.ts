// The modular library (public/faust-modules/modular, Documentation/MODULAR-LIBRARY.md), rendered offline
// with the compiler and options of the application: the conventions of signal (audio and bipolar CV in
// [-1, 1], unipolar CV in [0, 1], pitch 0.1 per octave with 0 = C4, gates 0/1) and what each module does.
// The ports carry the signals a module transforms; everything that controls it is a setting, driven by
// widget modulation: the modulations are rendered through the effective code of the application
// (src/model/Modulation.ts), with the mode it offers for each widget.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { allowedModes, depthWidget, listWidgets, modulatedCode, modulationSpec, ModulationSpec, WidgetDescription } from "../../src/model/Modulation";
import { getCompiler } from "../helpers/faust";

const dir = path.resolve(__dirname, "../../public/faust-modules/modular");
const SR = 48000;
const C4 = 261.6256;

type Signal = (t: number) => number;
// A signal dropped on a widget (by label prefix), with the depth of its modulation (default: the
// application's default for the mode).
type Modulations = Record<string, Signal | { signal: Signal; depth: number }>;

async function compiled(code: string) {
    const generator = new fw.FaustMonoDspGenerator();
    await generator.compile(await getCompiler(), "m", code, FAUST_COMPILE_OPTIONS);
    const json = JSON.parse(generator.factory!.json);
    return { generator, json, widgets: listWidgets(json.ui) };
}

function widgetOf(widgets: WidgetDescription[], file: string, label: string): WidgetDescription {
    const widget = widgets.find((w) => w.label.startsWith(label));
    if (!widget) throw new Error(`${file}: no widget ${label}`);
    return widget;
}

// Renders a module: each input is a function of the sample index; parameters by label prefix.
async function render(file: string, seconds: number, inputs: Signal[] = [], params: Record<string, number> = {}, modulations: Modulations = {}): Promise<Float32Array[]> {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    const base = await compiled(code);
    const numInputs = base.json.inputs;
    const specs: ModulationSpec[] = [];
    const signals: Signal[] = [];
    const depths: number[] = [];
    for (const [label, m] of Object.entries(modulations)) {
        const widget = widgetOf(base.widgets, file, label);
        specs.push(modulationSpec(widget, base.widgets, allowedModes(widget)[0]));
        signals.push(typeof m == "function" ? m : m.signal);
        depths.push(typeof m == "function" ? NaN : m.depth);
    }
    const { generator, json, widgets } = specs.length ? await compiled(modulatedCode(code, numInputs, specs)) : base;
    const processor = (await generator.createOfflineProcessor(SR, 512))!;
    for (const [label, value] of Object.entries(params)) processor.setParamValue(widgetOf(widgets, file, label).address, value);
    specs.forEach((spec, i) => {
        if (!isNaN(depths[i])) processor.setParamValue(depthWidget(widgets, spec)!.address, depths[i]);
    });
    const length = Math.round(seconds * SR);
    const all = [...Array.from({ length: numInputs }, (_, i) => inputs[i] ?? (() => 0)), ...signals];
    expect(all).toHaveLength(json.inputs);
    return processor.render(all.map((f) => Float32Array.from({ length }, (_, t) => f(t))), length);
}

// Frequency from the rising zero crossings (interpolated), after a settling time.
function frequency(x: Float32Array, from = 0.2): number {
    const crossings: number[] = [];
    for (let t = Math.round(from * SR) + 1; t < x.length; t++) {
        if (x[t - 1] < 0 && x[t] >= 0) crossings.push(t - 1 + x[t - 1] / (x[t - 1] - x[t]));
    }
    return (SR * (crossings.length - 1)) / (crossings[crossings.length - 1] - crossings[0]);
}

// Amplitude of the component at hz (Hann window, from a settling time).
function amplitude(x: Float32Array, hz: number, from = 0.2): number {
    const start = Math.round(from * SR), n = x.length - start;
    let re = 0, im = 0, w = 0;
    for (let i = 0; i < n; i++) {
        const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
        re += x[start + i] * hann * Math.cos((2 * Math.PI * hz * i) / SR);
        im += x[start + i] * hann * Math.sin((2 * Math.PI * hz * i) / SR);
        w += hann;
    }
    return (2 * Math.hypot(re, im)) / w;
}

const cents = (f: number, g: number) => Math.abs(1200 * Math.log2(f / g));
const range = (x: Float32Array, from = 0) => {
    let min = Infinity, max = -Infinity;
    for (let t = Math.round(from * SR); t < x.length; t++) { min = Math.min(min, x[t]); max = Math.max(max, x[t]); }
    return [min, max];
};
const rms = (x: Float32Array, from = 0) => {
    let s = 0, n = 0;
    for (let t = Math.round(from * SR); t < x.length; t++) { s += x[t] * x[t]; n++; }
    return Math.sqrt(s / n);
};
// the rising edges of a 0/1 signal
const edges = (x: Float32Array) => { let n = 0; for (let t = 1; t < x.length; t++) if (x[t - 1] < 0.5 && x[t] >= 0.5) n++; return n; };
const square = (hz: number) => (t: number) => ((t * hz) / SR) % 1 < 0.5 ? 1 : 0;
const sine = (hz: number) => (t: number) => Math.sin((2 * Math.PI * hz * t) / SR);
const constant = (v: number) => () => v;

describe("modular library: ports and settings", () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".dsp"));

    it("has the twelve modules of the first voice, and the SineVCO", () => {
        expect(files.sort()).toEqual(["ADSR", "Clock", "LFO", "Mixer", "Noise", "Offset", "Quantizer", "SampleHold", "Sequencer", "SineVCO", "VCA", "VCF", "VCO"].map((n) => n + ".dsp"));
    });

    it("no setting is smoothed: a modulation goes through it at audio rate", () => {
        for (const f of files) expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/si\.smoo|si\.smooth/);
    });

    it("ports only for the signals a module transforms; gates, triggers and pitches are settings", async () => {
        const arity: Record<string, [number, number]> = {};
        for (const f of files) {
            const { json } = await compiled(fs.readFileSync(path.join(dir, f), "utf8"));
            arity[f.replace(".dsp", "")] = [json.inputs, json.outputs];
        }
        expect(arity).toEqual({
            ADSR: [0, 1], Clock: [0, 1], LFO: [0, 1], Mixer: [4, 1], Noise: [0, 2], Offset: [1, 1],
            Quantizer: [1, 1], SampleHold: [1, 1], Sequencer: [0, 2], SineVCO: [0, 1], VCA: [1, 1], VCF: [1, 1], VCO: [0, 4],
        });
    }, 120_000);

    it("the pitch settings are added to (mode +, amount 1), buttons are driven, sliders modulated", async () => {
        const modes = async (file: string) => {
            const { widgets } = await compiled(fs.readFileSync(path.join(dir, file), "utf8"));
            return Object.fromEntries(widgets.map((w) => [w.label, allowedModes(w)[0]]));
        };
        expect(await modes("VCO.dsp")).toEqual({ Pitch: "add", Octave: "modulate", Tune: "modulate", FM: "modulate", Width: "modulate" });
        expect((await modes("VCF.dsp")).Pitch).toBe("add");
        expect(await modes("SineVCO.dsp")).toEqual({ Freq: "linear", Gain: "modulate" });
        expect((await modes("ADSR.dsp")).Gate).toBe("drive");
        expect((await modes("Sequencer.dsp")).Clock).toBe("drive");
    }, 120_000);

    it("the settings in the order of their [n] prefix", async () => {
        const { widgets } = await compiled(fs.readFileSync(path.join(dir, "Sequencer.dsp"), "utf8"));
        expect(widgets.map((w) => w.label)).toEqual(["Clock", "Reset", ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `Step ${i}`), "Length"]);
    }, 120_000);
});

describe("modular library: pitch, 0.1 per octave from C4", () => {
    it("VCO plays C4 at 0, an octave per 0.1 of its Pitch over ten octaves, within 1 cent", async () => {
        for (const p of [0, 0.1, -0.2, 0.3, -0.4]) {
            const [sine] = await render("VCO.dsp", 1.2, [], { Pitch: p });
            expect(cents(frequency(sine), C4 * 2 ** (10 * p))).toBeLessThan(1);
        }
    }, 120_000);

    it("VCO: a pitch dropped on Pitch is added to the slider, within 1 cent wherever the slider is", async () => {
        for (const [slider, p] of [[0, 0.1], [0.2, 0.1], [-0.3, 0.25], [0.15, -0.4]]) {
            const [sine] = await render("VCO.dsp", 1.2, [], { Pitch: slider }, { Pitch: constant(p) });
            expect(cents(frequency(sine), C4 * 2 ** (10 * (slider + p)))).toBeLessThan(1);
        }
        // the amount scales the pitch: 0.5 follows half the octaves
        const [half] = await render("VCO.dsp", 1.2, [], {}, { Pitch: { signal: constant(0.2), depth: 0.5 } });
        expect(cents(frequency(half), 2 * C4)).toBeLessThan(1);
    }, 120_000);

    it("VCO: Octave and Tune transpose, FM adds octaves, the four outputs in [-1, 1]", async () => {
        const [a] = await render("VCO.dsp", 1.2, [], { Octave: 1 });
        expect(cents(frequency(a), 2 * C4)).toBeLessThan(1);
        const [b] = await render("VCO.dsp", 1.2, [], { Tune: 7 });
        expect(cents(frequency(b), C4 * 2 ** (7 / 12))).toBeLessThan(1);
        const [c] = await render("VCO.dsp", 1.2, [], { FM: 1 });
        expect(cents(frequency(c), 2 * C4)).toBeLessThan(1);
        const outs = await render("VCO.dsp", 1, [], { Pitch: 0.05 });
        expect(outs).toHaveLength(4);
        outs.forEach((x) => {
            const [min, max] = range(x, 0.1);
            expect(min).toBeGreaterThan(-1.1);
            expect(max).toBeLessThan(1.1);
            expect(max - min).toBeGreaterThan(1.6);
        });
    }, 120_000);

    it("VCO: an audio signal dropped on FM modulates the frequency at audio rate (sidebands)", async () => {
        // 100 Hz on FM at depth 0.05: ±0.2 octave, a modulation index of about 0.39 (J1/J0 ≈ 0.2)
        const [x] = await render("VCO.dsp", 1.2, [], {}, { FM: { signal: sine(100), depth: 0.05 } });
        const carrier = amplitude(x, C4), lower = amplitude(x, C4 - 100), upper = amplitude(x, C4 + 100);
        expect(lower / carrier).toBeGreaterThan(0.12);
        expect(upper / carrier).toBeGreaterThan(0.12);
    }, 120_000);

    it("Quantizer: the nearest note of the scale, ties going down, on the tonic", async () => {
        const quantize = async (semis: number, params: Record<string, number>) => {
            const [y] = await render("Quantizer.dsp", 0.01, [() => semis / 120], params);
            return Math.round(y[y.length - 1] * 120 * 1000) / 1000;
        };
        // C major
        expect(await quantize(1, { Scale: 1, Tonic: 0 })).toBe(0);
        expect(await quantize(3, { Scale: 1, Tonic: 0 })).toBe(2);
        expect(await quantize(6, { Scale: 1, Tonic: 0 })).toBe(5);
        expect(await quantize(11.4, { Scale: 1, Tonic: 0 })).toBe(11);
        expect(await quantize(-1, { Scale: 1, Tonic: 0 })).toBe(-1);         // B below
        expect(await quantize(25, { Scale: 1, Tonic: 0 })).toBe(24);
        // D minor pentatonic: D F G A C
        expect(await quantize(4, { Scale: 4, Tonic: 2 })).toBe(5);
        expect(await quantize(11, { Scale: 4, Tonic: 2 })).toBe(12);
        // chromatic: the nearest semitone
        expect(await quantize(4.6, { Scale: 0, Tonic: 0 })).toBe(5);
    }, 120_000);

    it("Offset transposes a pitch by semitones, scales and offsets a CV", async () => {
        const [y] = await render("Offset.dsp", 0.2, [() => 0.1], { Transpose: 12 });
        expect(y[y.length - 1]).toBeCloseTo(0.2, 4);
        const [z] = await render("Offset.dsp", 0.5, [() => 0.5], { Gain: -1, Offset: 0.25 });
        expect(z[z.length - 1]).toBeCloseTo(-0.25, 3);
    }, 120_000);
});

describe("modular library: level, timbre, control", () => {
    it("VCA: closed at gain 0; an envelope dropped on Gain opens it, linearly or exponentially", async () => {
        const one = () => 1;
        expect(rms((await render("VCA.dsp", 0.2, [one]))[0])).toBe(0);
        expect((await render("VCA.dsp", 0.2, [one], { Gain: 0.5 }))[0].at(-1)).toBeCloseTo(0.5, 5);
        // 0.5 s: the depth slider of a modulation is smoothed from 0 (si.smoo, about 23 ms), and in single
        // precision it stays within 1e-4 of its value
        const open = (cv: number, params = {}) => render("VCA.dsp", 0.5, [one], params, { Gain: { signal: constant(cv), depth: 1 } });
        expect((await open(1))[0].at(-1)).toBeCloseTo(1, 4);
        expect((await open(0.5))[0].at(-1)).toBeCloseTo(0.5, 4);
        expect((await open(0.5, { Response: 1 }))[0].at(-1)).toBeCloseTo(10 ** (-30 / 20), 4);
        expect((await open(3))[0].at(-1)).toBeCloseTo(1, 5);      // kept in [0, 1]
        // the default depth (0.5) opens half
        expect((await render("VCA.dsp", 0.5, [one], {}, { Gain: constant(1) }))[0].at(-1)).toBeCloseTo(0.5, 4);
    }, 120_000);

    it("VCF: a low-pass at 500 Hz keeps 100 Hz and removes 5 kHz; its Pitch moves the cutoff", async () => {
        const low = rms((await render("VCF.dsp", 0.5, [sine(100)], { Cutoff: 500, Resonance: 0 }))[0], 0.1);
        const high = rms((await render("VCF.dsp", 0.5, [sine(5000)], { Cutoff: 500, Resonance: 0 }))[0], 0.1);
        expect(low).toBeGreaterThan(0.6);
        expect(high).toBeLessThan(0.02);
        // four octaves up (0.4), by the slider or by a pitch dropped on it: 5 kHz goes through
        const opened = rms((await render("VCF.dsp", 0.5, [sine(5000)], { Cutoff: 500, Resonance: 0, Pitch: 0.4 }))[0], 0.1);
        expect(opened).toBeGreaterThan(0.5);
        const tracked = rms((await render("VCF.dsp", 0.5, [sine(5000)], { Cutoff: 500, Resonance: 0 }, { Pitch: constant(0.4) }))[0], 0.3);
        const openedLate = rms((await render("VCF.dsp", 0.5, [sine(5000)], { Cutoff: 500, Resonance: 0, Pitch: 0.4 }))[0], 0.3);
        expect(tracked).toBeCloseTo(openedLate, 4);
        const hp = rms((await render("VCF.dsp", 0.5, [sine(100)], { Cutoff: 500, Resonance: 0, Mode: 2 }))[0], 0.1);
        expect(hp).toBeLessThan(0.05);
    }, 120_000);

    it("ADSR driven by a gate dropped on Gate: in [0, 1], up to 1, down to the sustain, back to 0 after the release", async () => {
        const gate = (t: number) => (t < 0.5 * SR ? 1 : 0);
        const [env] = await render("ADSR.dsp", 1.2, [], { Attack: 0.01, Decay: 0.05, Sustain: 0.6, Release: 0.1 }, { Gate: gate });
        const [min, max] = range(env);
        expect(min).toBeGreaterThanOrEqual(0);
        expect(max).toBeGreaterThan(0.98);
        expect(max).toBeLessThanOrEqual(1);
        expect(env[Math.round(0.45 * SR)]).toBeCloseTo(0.6, 2);
        expect(env.at(-1)).toBeLessThan(0.001);
    }, 120_000);

    it("LFO: each shape in [-1, 1] reaching both bounds, unipolar in [0, 1], restarted by a reset", async () => {
        for (const shape of [0, 1, 2, 3]) {
            const [x] = await render("LFO.dsp", 1.2, [], { Shape: shape, Rate: 5 });
            const [min, max] = range(x, 0.2);
            expect(min).toBeLessThan(-0.98);
            expect(max).toBeGreaterThan(0.98);
            expect(min).toBeGreaterThanOrEqual(-1);
            expect(max).toBeLessThanOrEqual(1);
        }
        const [u] = await render("LFO.dsp", 1.2, [], { Polarity: 1, Rate: 5 });
        const [umin, umax] = range(u, 0.2);
        expect(umin).toBeGreaterThanOrEqual(-1e-6);
        expect(umax).toBeLessThanOrEqual(1);
        // saw at 1 Hz, reset at 0.7 s: back to the start (-1) of its cycle
        const reset = (t: number) => (t >= 0.7 * SR && t < 0.75 * SR ? 1 : 0);
        const [saw] = await render("LFO.dsp", 0.8, [], { Shape: 2, Rate: 1 }, { Reset: reset });
        expect(saw[Math.round(0.7 * SR) + 1]).toBeLessThan(-0.99);
        expect(saw[Math.round(0.7 * SR) - 1]).toBeGreaterThan(0.3);                // late in its cycle
    }, 120_000);

    it("Mixer sums its inputs times their levels; Noise: two outputs in [-1, 1]", async () => {
        const [m] = await render("Mixer.dsp", 0.2, [() => 0.1, () => 0.2, () => 0.3, () => 0.4], { "Level 4": 0.5 });
        expect(m.at(-1)).toBeCloseTo(0.8, 3);
        const noise = await render("Noise.dsp", 1, [], { Level: 1 });
        expect(noise).toHaveLength(2);
        noise.forEach((x) => {
            const [min, max] = range(x);
            expect(min).toBeGreaterThanOrEqual(-1);
            expect(max).toBeLessThanOrEqual(1);
            expect(rms(x)).toBeGreaterThan(0.1);
        });
    }, 120_000);
});

describe("modular library: time and events", () => {
    it("Clock: 2 gates per second at 120 BPM, 8 in sixteenth notes, 0/1, restarted by a reset", async () => {
        const [quarter] = await render("Clock.dsp", 4, [], { Tempo: 120 });
        expect(edges(quarter)).toBeGreaterThanOrEqual(7);
        expect(edges(quarter)).toBeLessThanOrEqual(8);
        expect(new Set(quarter)).toEqual(new Set([0, 1]));
        const [sixteenth] = await render("Clock.dsp", 1, [], { Tempo: 120, Division: 4 });
        expect(edges(sixteenth)).toBeGreaterThanOrEqual(7);
        const reset = (t: number) => (t >= 0.3 * SR && t < 0.31 * SR ? 1 : 0);
        const [restarted] = await render("Clock.dsp", 0.4, [], { Tempo: 60, Width: 0.5 }, { Reset: reset });
        expect(restarted[Math.round(0.3 * SR) + 2]).toBe(1);
    }, 120_000);

    it("Sequencer: one step per clock dropped on Clock, its pitch in semitones / 120, no gate on a rest, back to the start on reset", async () => {
        // clock at 4 Hz: steps of 0.25 s; pattern 0 12 7 -1 3 10 7 5
        const [pitch, gate] = await render("Sequencer.dsp", 2.1, [], {}, { Clock: square(4) });
        const at = (s: number) => Math.round((s * 0.25 + 0.1) * SR);
        const semitones = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => Math.round(pitch[at(s)] * 120));
        expect(semitones).toEqual([0, 12, 7, 7, 3, 10, 7, 5]);              // a rest holds the pitch
        expect([0, 1, 2, 3].map((s) => gate[at(s)])).toEqual([1, 1, 1, 0]);
        const [p2] = await render("Sequencer.dsp", 1.2, [], { Length: 2 }, { Clock: square(4) });
        expect([0, 1, 2, 3].map((s) => Math.round(p2[at(s)] * 120))).toEqual([0, 12, 0, 12]);
        // reset after the 3rd step: the next clock plays the first step again
        const reset = (t: number) => (t >= 0.8 * SR && t < 0.82 * SR ? 1 : 0);
        const [p3] = await render("Sequencer.dsp", 1.2, [], {}, { Clock: square(4), Reset: reset });
        expect(Math.round(p3[at(4)] * 120)).toBe(0);
    }, 120_000);

    it("SampleHold holds its input, or noise, at each rising edge of a trigger dropped on Trigger", async () => {
        const ramp = (t: number) => t / SR;
        const [held] = await render("SampleHold.dsp", 1, [ramp], {}, { Trigger: square(4) });
        expect(held[Math.round(0.1 * SR)]).toBeCloseTo(0, 3);
        expect(held[Math.round(0.4 * SR)]).toBeCloseTo(0.25, 3);
        expect(held[Math.round(0.6 * SR)]).toBeCloseTo(0.5, 3);
        const [random] = await render("SampleHold.dsp", 1, [], { Source: 1 }, { Trigger: square(8) });
        const values = new Set(Array.from(random).map((v) => v.toFixed(6)));
        expect(values.size).toBeGreaterThan(4);
        expect(values.size).toBeLessThan(12);
    }, 120_000);
});

// Bessel function of the first kind, J_n(x), by its series (|n| small, x up to a few units).
function bessel(n: number, x: number): number {
    const k = Math.abs(n);
    let sum = 0, term = (x / 2) ** k / Array.from({ length: k }, (_, i) => i + 1).reduce((a, b) => a * b, 1);
    for (let m = 0; m < 40; m++) {
        sum += term;
        term *= -((x / 2) ** 2) / ((m + 1) * (m + 1 + k));
    }
    return n < 0 && k % 2 == 1 ? -sum : sum;
}

describe("modular library: classic FM with two SineVCO", () => {
    // the amplitude at fc + k·fm, against gain·|J_k(I)|
    const expectSpectrum = (x: Float32Array, gain: number, fc: number, fm: number, index: number, ks: number[]) => {
        for (const k of ks) {
            const expected = gain * Math.abs(bessel(k, index));
            expect(Math.abs(amplitude(x, Math.abs(fc + k * fm)) - expected), `component ${k}: ${fc + k * fm} Hz`).toBeLessThan(0.002);
        }
    };

    it("SineVCO: a sine at Freq, times Gain", async () => {
        const [x] = await render("SineVCO.dsp", 1.2, [], { Freq: 330, Gain: 0.8 });
        expect(cents(frequency(x), 330)).toBeLessThan(1);
        expect(amplitude(x, 330)).toBeCloseTo(0.8, 2);
    }, 120_000);

    it("a sine on Freq gives the spectrum of Chowning: fc ± k·fm with the amplitudes J_k(I), I = D·g·fc/fm", async () => {
        // fc 1000 Hz, fm 100 Hz, D 0.2: a deviation of 200 Hz, I = 2; the carrier stays at fc (no drift)
        const [x] = await render("SineVCO.dsp", 1.2, [], { Freq: 1000, Gain: 0.5 }, { Freq: { signal: sine(100), depth: 0.2 } });
        expectSpectrum(x, 0.5, 1000, 100, 2, [-3, -2, -1, 0, 1, 2, 3]);
    }, 120_000);

    it("through zero: a deviation larger than fc turns the phase backwards (components reflected, not clipped)", async () => {
        // fc 100 Hz, fm 400 Hz, D 4: I = 1, the frequency goes down to -300 Hz; lower sidebands at 300, 700 Hz
        const [x] = await render("SineVCO.dsp", 1.2, [], { Freq: 100, Gain: 0.5 }, { Freq: { signal: sine(400), depth: 4 } });
        expectSpectrum(x, 0.5, 100, 400, 1, [-2, -1, 0, 1, 2]);
    }, 120_000);

    it("two SineVCO: the modulator's output on the carrier's Freq, default deviation 1: I = Gain·fc/fm", async () => {
        const [modulator] = await render("SineVCO.dsp", 1.2, [], { Freq: 300, Gain: 0.6 });
        const [x] = await render("SineVCO.dsp", 1.2, [], { Freq: 1000, Gain: 0.5 }, { Freq: (t) => modulator[t] });
        expectSpectrum(x, 0.5, 1000, 300, 2, [-3, -2, -1, 0, 1, 2, 3]);
    }, 120_000);
});
