// Faust export: compiled with libfaust and compared with the expected semantics.
import { describe, expect, it } from "vitest";
import { exportFaust, unexportedModules } from "../../src/export/FaustExporter";
import { Patch } from "../../src/model/Patch";
import { compileJson, renderConstant, widgetAddresses } from "../helpers/faust";

function makePatch(io = { inputs: 2, outputs: 2 }): Patch {
    const patch = new Patch();
    patch.addModule({ id: "input", kind: "input", name: "input", numInputs: 0, numOutputs: io.inputs });
    patch.addModule({ id: "output", kind: "output", name: "output", numInputs: io.outputs, numOutputs: 0 });
    return patch;
}

function add(patch: Patch, id: string, code: string, numInputs: number, numOutputs: number, name = id): void {
    patch.addModule({ id, name, code: `process = ${code};`, numInputs, numOutputs });
}

const port = (module: string, p: number) => ({ module, port: p });

async function run(patch: Patch, inputs: number[] = [], length = 4, forceStereo = false) {
    const result = exportFaust(patch, { name: "Test", forceStereo });
    const out = await renderConstant("export", result.code, inputs, length);
    return { ...result, out: out.map((channel) => channel.map((x) => +x.toFixed(5))) };
}

describe("Faust export", () => {
    it("exports an empty patch as silence on every output", async () => {
        const r = await run(makePatch({ inputs: 2, outputs: 3 }));
        expect([r.inputs, r.outputs]).toEqual([0, 3]);
        expect(r.out).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    });

    it("routes port to port, sums fan-in and leaves unconnected inputs silent", async () => {
        const patch = makePatch({ inputs: 2, outputs: 3 });
        add(patch, "A", "1, 2, 3", 0, 3);
        add(patch, "B", "_, _ <: -, +", 2, 2);           // (x - y, x + y)
        patch.connect(port("A", 1), port("B", 0));
        patch.connect(port("A", 0), port("B", 1));
        patch.connect(port("B", 0), port("output", 0));   // 2 - 1 = 1
        patch.connect(port("A", 2), port("output", 0));   // fan-in: 1 + 3 = 4
        patch.connect(port("B", 1), port("output", 2));   // 3
        const r = await run(patch, [], 2);
        expect(r.out).toEqual([[4, 4], [0, 0], [3, 3]]);
    });

    it("uses the physical inputs that are connected, keeping their numbers", async () => {
        const patch = makePatch({ inputs: 2, outputs: 2 });
        add(patch, "fx", "*(10)", 1, 1);
        patch.connect(port("input", 1), port("fx", 0));
        patch.connect(port("fx", 0), port("output", 1));
        patch.connect(port("input", 1), port("output", 0));
        const r = await run(patch, [3, 5], 2);
        expect([r.inputs, r.outputs]).toEqual([2, 2]);
        expect(r.out).toEqual([[5, 5], [50, 50]]);
    });

    it("delays feedback connections by one sample", async () => {
        const patch = makePatch({ inputs: 1, outputs: 1 });
        add(patch, "acc", "*(0.5)", 1, 1);
        patch.connect(port("input", 0), port("acc", 0));
        patch.connect(port("acc", 0), port("acc", 0));    // y = 0.5 (x + y')
        patch.connect(port("acc", 0), port("output", 0));
        const r = await run(patch, [1], 4);
        expect(r.out).toEqual([[0.5, 0.75, 0.875, 0.9375]]);
    });

    it("computes a module feeding several destinations once (one set of controls)", async () => {
        const patch = makePatch({ inputs: 0, outputs: 2 });
        add(patch, "g", 'hslider("gain", 0.5, 0, 1, 0.01)', 0, 1, "Gain");
        patch.connect(port("g", 0), port("output", 0));
        patch.connect(port("g", 0), port("output", 1));
        const json = await compileJson("e", exportFaust(patch, { name: "Test" }).code);
        expect(widgetAddresses(json)).toEqual(["/Test/gain"]);
    });

    it("gives distinct controls to distinct instances of the same module", async () => {
        const patch = makePatch({ inputs: 0, outputs: 2 });
        add(patch, "g1", 'hslider("gain", 0.5, 0, 1, 0.01)', 0, 1, "Gain");
        add(patch, "g2", 'hslider("gain", 0.5, 0, 1, 0.01)', 0, 1, "Gain");
        patch.connect(port("g1", 0), port("output", 0));
        patch.connect(port("g2", 0), port("output", 1));
        const json = await compileJson("e", exportFaust(patch, { name: "Test" }).code);
        expect(widgetAddresses(json)).toEqual(["/Test/Gain_1/gain", "/Test/Gain_2/gain"]);
    });

    it("leaves out the modules that do not reach the output", async () => {
        const patch = makePatch();
        add(patch, "used", "0.25", 0, 1);
        add(patch, "lost", 'hslider("lost", 0.5, 0, 1, 0.01)', 0, 1);
        add(patch, "end", "*(2)", 1, 1);
        patch.connect(port("used", 0), port("output", 0));
        patch.connect(port("lost", 0), port("end", 0));
        expect(unexportedModules(patch).map((m) => m.id)).toEqual(["lost", "end"]);
        const result = exportFaust(patch, { name: "Test" });
        expect(result.code).not.toContain("hslider(\"lost\"");
        expect((await run(patch, [], 1)).out).toEqual([[0.25], [0]]);
    });

    it("adapts the physical channels to stereo with the bus rule when asked", async () => {
        const patch = makePatch({ inputs: 1, outputs: 4 });
        add(patch, "A", "_ <: _, *(2), *(3), *(4)", 1, 4);
        patch.connect(port("input", 0), port("A", 0));
        [0, 1, 2, 3].forEach((i) => patch.connect(port("A", i), port("output", i)));
        // stereo inputs 1 and 2 are summed into the mono input; outputs 1+3 and 2+4 are mixed
        const r = await run(patch, [1, 2], 1, true);
        expect([r.inputs, r.outputs]).toEqual([2, 2]);
        expect(r.out).toEqual([[3 + 9], [6 + 12]]);
    });

    it("matches a sample-by-sample simulation of the patch on random patches with cycles", async () => {
        // Memoryless modules: the only state comes from the feedback connections.
        const pool: Array<{ code: string; inputs: number; outputs: number; f: (x: number[]) => number[] }> = [
            { code: "0.3", inputs: 0, outputs: 1, f: () => [0.3] },
            { code: "-0.2, 0.1", inputs: 0, outputs: 2, f: () => [-0.2, 0.1] },
            { code: "*(0.5)", inputs: 1, outputs: 1, f: ([x]) => [0.5 * x] },
            { code: "_, _ <: +, - : *(0.5), *(0.25)", inputs: 2, outputs: 2, f: ([x, y]) => [0.5 * (x + y), 0.25 * (x - y)] },
            { code: "_ <: *(0.4), *(-0.3), _", inputs: 1, outputs: 3, f: ([x]) => [0.4 * x, -0.3 * x, x] },
            { code: "+, _ : + : *(0.3)", inputs: 3, outputs: 1, f: ([x, y, z]) => [0.3 * (x + y + z)] },
        ];
        let seed = 2026;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
        const LENGTH = 6;

        for (let trial = 0; trial < 40; trial++) {
            const patch = makePatch({ inputs: 2, outputs: 2 });
            const kinds = new Map<string, typeof pool[number]>();
            const count = 1 + Math.floor(random() * 6);
            for (let i = 0; i < count; i++) {
                const kind = pick(pool);
                kinds.set(`m${i}`, kind);
                add(patch, `m${i}`, kind.code, kind.inputs, kind.outputs);
            }
            const modules = patch.getModules();
            for (let e = 0; e < 3 * count; e++) {
                const from = pick(modules.filter((m) => m.numOutputs > 0));
                const to = pick(modules.filter((m) => m.numInputs > 0));
                const a = port(from.id, Math.floor(random() * from.numOutputs));
                const b = port(to.id, Math.floor(random() * to.numInputs));
                if (!patch.findConnection(a, b)) patch.connect(a, b);
            }
            const inputs = [0.7, -0.4];

            // Reference: per sample, modules in topological order; feedback connections read
            // the value of their source at the previous sample.
            const { feedback, order } = patch.analyze();
            const expected: number[][] = [[], []];
            let previous = new Map<string, number>();
            for (let t = 0; t < LENGTH; t++) {
                const current = new Map<string, number>();
                inputs.forEach((v, i) => current.set(`input:${i}`, v));
                const inputOf = (id: string, p: number) => patch.connectionsTo(id).filter((c) => c.to.port == p).reduce((sum, c) =>
                    sum + ((feedback.has(c.id) ? previous : current).get(`${c.from.module}:${c.from.port}`) ?? 0), 0);
                for (const id of order) {
                    const kind = kinds.get(id);
                    if (!kind) continue;
                    const outs = kind.f(Array.from({ length: kind.inputs }, (_, p) => inputOf(id, p)));
                    outs.forEach((v, p) => current.set(`${id}:${p}`, v));
                }
                expected[0].push(inputOf("output", 0));
                expected[1].push(inputOf("output", 1));
                previous = current;
            }

            const result = exportFaust(patch, { name: "Random" });
            const used = Array.from({ length: result.inputs }, (_, i) => inputs[i]);
            const out = await renderConstant("random", result.code, used, LENGTH);
            out.forEach((channel, c) => channel.forEach((x, t) =>
                expect(x, `trial ${trial}, output ${c}, sample ${t}\n${result.code}`).toBeCloseTo(expected[c][t], 4)));
        }
    }, 120_000);
});
