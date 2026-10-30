// Differential test: the live Web Audio graph (AudioGraph, one faustwasm node per module) and the
// exported Faust code (one DSP) must produce the same signals on acyclic patches.
// (On cyclic patches they differ by design: 128-sample delay live, 1 sample in the export.)
import { describe, expect, it } from "vitest";
import { AudioGraph } from "../../src/audio/AudioGraph";
import { exportFaust } from "../../src/export/FaustExporter";
import { allowedModes, listWidgets, isModulable, ModulationMode, modulatedCode, modulationSpec } from "../../src/model/Modulation";
import { Patch } from "../../src/model/Patch";
import { compileJson, faustNode, renderCode } from "./faust";

const LENGTH = 2048;
const RATE = 48000;

// Modules with state (oscillators, filters, delays) and several arities.
const POOL = [
    'import("stdfaust.lib"); process = os.osc(440) * 0.5;',
    'import("stdfaust.lib"); process = os.osc(110), os.sawtooth(220) * 0.3;',
    'import("stdfaust.lib"); process = fi.lowpass(2, 1000);',
    'import("stdfaust.lib"); process = _ <: _, @(37), fi.highpass(1, 500);',
    'process = _, _ <: +, - : *(0.5), *(0.7);',
    'import("stdfaust.lib"); process = + , _ : *(0.3), de.delay(64, 10);',
    'import("stdfaust.lib"); process = _ : + ~ *(0.9) : *(0.1);',
];

describe("export versus live graph", () => {
    it("renders the same signals on random acyclic patches", async () => {
        let seed = 7;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
        // physical input: two deterministic signals
        const inputs = [0, 1].map((c) => Float32Array.from({ length: LENGTH }, (_, t) => 0.5 * Math.sin(2 * Math.PI * (300 + 200 * c) * t / RATE)));

        for (let trial = 0; trial < 6; trial++) {
            const context = new OfflineAudioContext(2, LENGTH, RATE);
            context.destination.channelInterpretation = "discrete";
            const patch = new Patch();
            const graph = new AudioGraph(context, patch);
            patch.addModule({ id: "input", kind: "input", name: "input", numInputs: 0, numOutputs: 2 });
            patch.addModule({ id: "output", kind: "output", name: "output", numInputs: 2, numOutputs: 0 });
            const buffer = context.createBuffer(2, LENGTH, RATE);
            inputs.forEach((signal, c) => buffer.copyToChannel(signal, c));
            const source = new AudioBufferSourceNode(context, { buffer });
            graph.setNode("input", source);
            graph.setNode("output", context.destination);

            const count = 2 + Math.floor(random() * 4);
            const ids: string[] = [];
            for (let i = 0; i < count; i++) {
                const code = pick(POOL);
                const { node, numInputs, numOutputs } = await faustNode(context, code);
                const id = `m${i}`;
                patch.addModule({ id, name: "M", code, numInputs, numOutputs });
                graph.setNode(id, node);
                ids.push(id);
            }
            // acyclic: connections go from earlier to later modules (input first, output last)
            const chain = ["input", ...ids, "output"];
            for (let e = 0; e < 3 * count; e++) {
                const a = Math.floor(random() * (chain.length - 1));
                const b = a + 1 + Math.floor(random() * (chain.length - 1 - a));
                const from = patch.getModule(chain[a])!;
                const to = patch.getModule(chain[b])!;
                if (from.numOutputs == 0 || to.numInputs == 0) continue;
                const p = { module: from.id, port: Math.floor(random() * from.numOutputs) };
                const q = { module: to.id, port: Math.floor(random() * to.numInputs) };
                if (!patch.findConnection(p, q)) patch.connect(p, q);
            }
            expect(patch.analyze().feedback.size).toBe(0);

            source.start();
            const live = await context.startRendering();
            const exported = exportFaust(patch, { name: "Differential" });
            const rendered = await renderCode(exported.code, inputs.slice(0, exported.inputs), LENGTH);

            let worst = 0;
            for (let c = 0; c < 2; c++) {
                const a = live.getChannelData(c);
                for (let t = 0; t < LENGTH; t++) worst = Math.max(worst, Math.abs(a[t] - rendered[c][t]));
            }
            const energy = [0, 1].map((c) => live.getChannelData(c).reduce((s, x) => s + x * x, 0));
            expect(worst, `trial ${trial}\n${exported.code}`).toBeLessThan(1e-5);
            // not a trivial comparison of silences (unless nothing reaches the output)
            if (patch.connectionsTo("output").length > 0) expect(energy[0] + energy[1]).toBeGreaterThan(0);
        }
    }, 120_000);

    it("renders the same signals with widget modulations (all types, exponential frequency)", async () => {
        let seed = 11;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
        const wrap = (name: string, body: string) => `process = vgroup("${name}", environment{\nimport("stdfaust.lib");\n${body}\n}.process);`;
        const SOURCES = ["process = os.osc(3);", "process = os.lf_triangle(5) * 0.5;", "process = os.osc(0.7), os.osc(1.3);"];
        const TARGETS = [
            'process = os.osc(hslider("freq[unit:Hz]", 300, 50, 2000, 1)) * hslider("gain", 0.3, 0, 1, 0.01);',
            'process = *(hslider("gain", 0.5, 0, 1, 0.01));',
            'process = fi.lowpass(2, hslider("cutoff[unit:Hz]", 1000, 100, 5000, 1));',
            'process = *(hslider("level", 0.8, 0, 1, 0.01)) : *(checkbox("on") + 0.5);',
        ];
        const modes = new Set<ModulationMode>();
        let exponential = 0;
        for (let trial = 0; trial < 5; trial++) {
            const context = new OfflineAudioContext(2, LENGTH, RATE);
            context.destination.channelInterpretation = "discrete";
            const patch = new Patch();
            const graph = new AudioGraph(context, patch);
            patch.addModule({ id: "output", kind: "output", name: "output", numInputs: 2, numOutputs: 0 });
            graph.setNode("output", context.destination);
            // modulation sources first, then the modulated modules (acyclic: sources → targets → output)
            const sources: string[] = [];
            for (let i = 0; i < 2; i++) {
                const code = wrap(`S${i}`, pick(SOURCES));
                const { node, numInputs, numOutputs } = await faustNode(context, code);
                patch.addModule({ id: `s${i}`, name: `S${i}`, code, numInputs, numOutputs });
                graph.setNode(`s${i}`, node);
                sources.push(`s${i}`);
            }
            const targets: string[] = [];
            for (let i = 0; i < 3; i++) {
                const code = wrap(`T${i}`, pick(TARGETS));
                const json = await compileJson(code);
                const widgets = listWidgets(json.ui).filter(isModulable);
                const chosen = widgets.filter(() => random() < 0.7);
                const modulations = chosen.map((w) => {
                    const mode = pick(allowedModes(w));
                    modes.add(mode);
                    const spec = modulationSpec(w, widgets, mode);
                    if (spec.exponential && mode == "modulate") exponential++;
                    return { widget: w.address, spec };
                });
                const effective = modulatedCode(code, json.inputs, modulations.map((m) => m.spec));
                const { node, numInputs, numOutputs } = await faustNode(context, effective);
                expect(numInputs).toBe(json.inputs + modulations.length);
                patch.addModule({ id: `t${i}`, name: `T${i}`, code, numInputs: json.inputs, numOutputs, modulations });
                graph.setNode(`t${i}`, node);
                targets.push(`t${i}`);
            }
            // every modulation port gets one or two sources (earlier modules), audio inputs get earlier modules
            for (const [k, id] of targets.entries()) {
                const module = patch.getModule(id)!;
                const earlier = [...sources, ...targets.slice(0, k)];
                for (let p = 0; p < module.numInputs + module.modulations.length; p++) {
                    for (let n = 0; n < 1 + Math.floor(random() * 2); n++) {
                        const from = patch.getModule(pick(earlier))!;
                        const a = { module: from.id, port: Math.floor(random() * from.numOutputs) };
                        const b = { module: id, port: p };
                        if (!patch.findConnection(a, b)) patch.connect(a, b);
                    }
                }
                patch.connect({ module: id, port: 0 }, { module: "output", port: k % 2 });
            }
            expect(patch.analyze().feedback.size).toBe(0);

            const live = await context.startRendering();
            const exported = exportFaust(patch, { name: "Modulated" });
            const rendered = await renderCode(exported.code, [], LENGTH);
            // Same semantics, but the modules are compiled alone live and inlined in the export: float32
            // rounding differs, and is amplified during the initial transient (depth smoothing, filter
            // coefficients moving fast), then forgotten (measured: up to 2.2e-5 in the first 512
            // samples, below 1e-7 afterwards). A semantic error would give differences of the order of
            // the signal (0.1). Hence: < 1e-4 overall, < 1e-6 in the second half.
            let worst = 0;
            let tail = 0;
            let energy = 0;
            for (let c = 0; c < 2; c++) {
                const a = live.getChannelData(c);
                for (let t = 0; t < LENGTH; t++) {
                    const d = Math.abs(a[t] - rendered[c][t]);
                    worst = Math.max(worst, d);
                    if (t >= LENGTH / 2) tail = Math.max(tail, d);
                    energy += a[t] * a[t];
                }
            }
            expect(energy, `trial ${trial}`).toBeGreaterThan(0);
            expect(worst, `trial ${trial}\n${exported.code}`).toBeLessThan(1e-4);
            expect(tail, `trial ${trial}\n${exported.code}`).toBeLessThan(1e-6);
        }
        // the trials covered the three types and the exponential case
        expect([...modes].sort()).toEqual(["drive", "modulate", "scale"]);
        expect(exponential).toBeGreaterThan(0);
    }, 180_000);
});
