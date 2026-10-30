// Differential test: the live Web Audio graph (AudioGraph, one faustwasm node per module) and the
// exported Faust code (one DSP) must produce the same signals on acyclic patches.
// (On cyclic patches they differ by design: 128-sample delay live, 1 sample in the export.)
import { describe, expect, it } from "vitest";
import { AudioGraph } from "../../src/audio/AudioGraph";
import { exportFaust } from "../../src/export/FaustExporter";
import { Patch } from "../../src/model/Patch";
import { faustNode, renderCode } from "./faust";

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
});
