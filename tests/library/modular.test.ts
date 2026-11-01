// The modular library (public/faust-modules/modular, Documentation/MODULAR-LIBRARY.md), rendered offline
// with the compiler and options of the application: the conventions of signal (audio and bipolar CV in
// [-1, 1], unipolar CV in [0, 1], pitch 0.1 per octave with 0 = C4, gates 0/1) and what each module does.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { getCompiler } from "../helpers/faust";

const dir = path.resolve(__dirname, "../../public/faust-modules/modular");
const SR = 48000;
const C4 = 261.6256;

// Renders a module: each input is a function of the sample index; parameters by label prefix.
async function render(file: string, seconds: number, inputs: Array<(t: number) => number> = [], params: Record<string, number> = {}): Promise<Float32Array[]> {
    const generator = new fw.FaustMonoDspGenerator();
    await generator.compile(await getCompiler(), "m", fs.readFileSync(path.join(dir, file), "utf8"), FAUST_COMPILE_OPTIONS);
    const json = JSON.parse(generator.factory!.json);
    const widgets: any[] = [];
    const walk = (items: any[]) => items.forEach((w) => w.items ? walk(w.items) : widgets.push(w));
    walk(json.ui);
    const processor = (await generator.createOfflineProcessor(SR, 512))!;
    for (const [label, value] of Object.entries(params)) {
        const widget = widgets.find((w) => w.label.startsWith(label));
        if (!widget) throw new Error(`${file}: no widget ${label}`);
        processor.setParamValue(widget.address, value);
    }
    const length = Math.round(seconds * SR);
    const ins = Array.from({ length: json.inputs }, (_, i) => Float32Array.from({ length }, (_, t) => inputs[i] ? inputs[i](t) : 0));
    return processor.render(ins, length);
}

// Frequency from the rising zero crossings (interpolated), after a settling time.
function frequency(x: Float32Array, from = 0.2): number {
    const crossings: number[] = [];
    for (let t = Math.round(from * SR) + 1; t < x.length; t++) {
        if (x[t - 1] < 0 && x[t] >= 0) crossings.push(t - 1 + x[t - 1] / (x[t - 1] - x[t]));
    }
    return (SR * (crossings.length - 1)) / (crossings[crossings.length - 1] - crossings[0]);
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

describe("modular library: pitch, 0.1 per octave from C4", () => {
    it("VCO plays C4 at 0, an octave per 0.1 over ten octaves, within 1 cent", async () => {
        for (const p of [0, 0.1, -0.2, 0.3, -0.4]) {
            const [sine] = await render("VCO.dsp", 1.2, [() => p]);
            expect(cents(frequency(sine), C4 * 2 ** (10 * p))).toBeLessThan(1);
        }
    }, 120_000);

    it("VCO: Octave and Tune transpose, FM adds octaves, the four outputs in [-1, 1]", async () => {
        const [a] = await render("VCO.dsp", 1.2, [() => 0], { Octave: 1 });
        expect(cents(frequency(a), 2 * C4)).toBeLessThan(1);
        const [b] = await render("VCO.dsp", 1.2, [() => 0], { Tune: 7 });
        expect(cents(frequency(b), C4 * 2 ** (7 / 12))).toBeLessThan(1);
        const [c] = await render("VCO.dsp", 1.2, [() => 0, () => 0.5], { FM: 2 });
        expect(cents(frequency(c), 2 * C4)).toBeLessThan(1);
        const outs = await render("VCO.dsp", 1, [() => 0.05]);
        expect(outs).toHaveLength(4);
        outs.forEach((x) => {
            const [min, max] = range(x, 0.1);
            expect(min).toBeGreaterThan(-1.1);
            expect(max).toBeLessThan(1.1);
            expect(max - min).toBeGreaterThan(1.6);
        });
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
    it("VCA: closed at gain 0; the CV opens it, linearly or exponentially", async () => {
        const one = () => 1;
        expect(rms((await render("VCA.dsp", 0.2, [one, () => 0]))[0])).toBe(0);
        expect((await render("VCA.dsp", 0.2, [one, () => 1]))[0].at(-1)).toBeCloseTo(1, 5);
        expect((await render("VCA.dsp", 0.2, [one, () => 0.5]))[0].at(-1)).toBeCloseTo(0.5, 5);
        expect((await render("VCA.dsp", 0.2, [one, () => 0.5], { Response: 1 }))[0].at(-1)).toBeCloseTo(10 ** (-30 / 20), 4);
        expect((await render("VCA.dsp", 0.2, [one, () => 3]))[0].at(-1)).toBeCloseTo(1, 5);      // kept in [0, 1]
    }, 120_000);

    it("VCF: a low-pass at 500 Hz keeps 100 Hz and removes 5 kHz; V/oct moves the cutoff", async () => {
        const sine = (hz: number) => (t: number) => Math.sin((2 * Math.PI * hz * t) / SR);
        const low = rms((await render("VCF.dsp", 0.5, [sine(100), () => 0], { Cutoff: 500, Resonance: 0 }))[0], 0.1);
        const high = rms((await render("VCF.dsp", 0.5, [sine(5000), () => 0], { Cutoff: 500, Resonance: 0 }))[0], 0.1);
        expect(low).toBeGreaterThan(0.6);
        expect(high).toBeLessThan(0.02);
        // four octaves up (0.4): 5 kHz goes through
        const opened = rms((await render("VCF.dsp", 0.5, [sine(5000), () => 0.4], { Cutoff: 500, Resonance: 0 }))[0], 0.1);
        expect(opened).toBeGreaterThan(0.5);
        const hp = rms((await render("VCF.dsp", 0.5, [sine(100), () => 0], { Cutoff: 500, Resonance: 0, Mode: 2 }))[0], 0.1);
        expect(hp).toBeLessThan(0.05);
    }, 120_000);

    it("ADSR: in [0, 1], up to 1, down to the sustain, back to 0 after the release", async () => {
        const gate = (t: number) => (t < 0.5 * SR ? 1 : 0);
        const [env] = await render("ADSR.dsp", 1.2, [gate], { Attack: 0.01, Decay: 0.05, Sustain: 0.6, Release: 0.1 });
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
        const [saw] = await render("LFO.dsp", 0.8, [reset], { Shape: 2, Rate: 1 });
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
        const [restarted] = await render("Clock.dsp", 0.4, [reset], { Tempo: 60, Width: 0.5 });
        expect(restarted[Math.round(0.3 * SR) + 2]).toBe(1);
    }, 120_000);

    it("Sequencer: one step per clock, its pitch in semitones / 120, no gate on a rest, back to the start on reset", async () => {
        // clock at 4 Hz: steps of 0.25 s; pattern 0 12 7 -1 3 10 7 5
        const [pitch, gate] = await render("Sequencer.dsp", 2.1, [square(4)], {});
        const at = (s: number) => Math.round((s * 0.25 + 0.1) * SR);
        const semitones = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => Math.round(pitch[at(s)] * 120));
        expect(semitones).toEqual([0, 12, 7, 7, 3, 10, 7, 5]);              // a rest holds the pitch
        expect([0, 1, 2, 3].map((s) => gate[at(s)])).toEqual([1, 1, 1, 0]);
        const [p2] = await render("Sequencer.dsp", 1.2, [square(4)], { Length: 2 });
        expect([0, 1, 2, 3].map((s) => Math.round(p2[at(s)] * 120))).toEqual([0, 12, 0, 12]);
        // reset after the 3rd step: the next clock plays the first step again
        const reset = (t: number) => (t >= 0.8 * SR && t < 0.82 * SR ? 1 : 0);
        const [p3] = await render("Sequencer.dsp", 1.2, [square(4), reset], {});
        expect(Math.round(p3[at(4)] * 120)).toBe(0);
    }, 120_000);

    it("SampleHold holds its input, or noise, at each rising edge of the trigger", async () => {
        const ramp = (t: number) => t / SR;
        const [held] = await render("SampleHold.dsp", 1, [ramp, square(4)]);
        expect(held[Math.round(0.1 * SR)]).toBeCloseTo(0, 3);
        expect(held[Math.round(0.4 * SR)]).toBeCloseTo(0.25, 3);
        expect(held[Math.round(0.6 * SR)]).toBeCloseTo(0.5, 3);
        const [random] = await render("SampleHold.dsp", 1, [() => 0, square(8)], { Source: 1 });
        const values = new Set(Array.from(random).map((v) => v.toFixed(6)));
        expect(values.size).toBeGreaterThan(4);
        expect(values.size).toBeLessThan(12);
    }, 120_000);
});
