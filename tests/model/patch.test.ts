import { describe, expect, it } from "vitest";
import { busPairs, Connection, MAX_CHANNELS, Patch, PatchError, PatchEvent } from "../../src/model/Patch";

// Patch with physical I/O and Faust modules given as [id, inputs, outputs].
function makePatch(modules: Array<[string, number, number]>, io = { inputs: 2, outputs: 2 }): Patch {
    const patch = new Patch();
    patch.addModule({ id: "input", kind: "input", name: "input", numInputs: 0, numOutputs: io.inputs });
    patch.addModule({ id: "output", kind: "output", name: "output", numInputs: io.outputs, numOutputs: 0 });
    for (const [id, numInputs, numOutputs] of modules) {
        patch.addModule({ id, name: id, numInputs, numOutputs });
    }
    return patch;
}

const pairs = (connections: Connection[]) => connections.map((c) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`);

describe("busPairs (cyclic rule)", () => {
    it.each([
        [1, 1, [[0, 0]]],
        [1, 2, [[0, 0], [0, 1]]],                   // split, as <:
        [2, 1, [[0, 0], [1, 0]]],                   // merge, as :>
        [2, 2, [[0, 0], [1, 1]]],
        [3, 2, [[0, 0], [1, 1], [2, 0]]],
        [2, 3, [[0, 0], [1, 1], [0, 2]]],
        [0, 2, []],
        [2, 0, []],
    ])("%i outputs -> %i inputs", (n, m, expected) => {
        expect(busPairs(n, m)).toEqual(expected);
    });

    it("equals Faust split (<:) and merge (:>) when one arity divides the other", () => {
        for (let n = 1; n <= 8; n++) {
            for (let k = 1; k <= 4; k++) {
                // split n -> n*k: input j is fed by output j mod n
                const split = busPairs(n, n * k);
                expect(split).toHaveLength(n * k);
                split.forEach(([i, j]) => expect(i).toBe(j % n));
                // merge n*k -> n: output i feeds input i mod n
                const merge = busPairs(n * k, n);
                expect(merge).toHaveLength(n * k);
                merge.forEach(([i, j]) => expect(j).toBe(i % n));
            }
        }
    });
});

describe("modules", () => {
    it("enforces the 32-channel limit", () => {
        const patch = new Patch();
        expect(() => patch.addModule({ name: "a", numInputs: MAX_CHANNELS, numOutputs: MAX_CHANNELS })).not.toThrow();
        expect(() => patch.addModule({ name: "b", numInputs: MAX_CHANNELS + 1, numOutputs: 1 })).toThrow(PatchError);
        expect(() => patch.addModule({ name: "c", numInputs: 1, numOutputs: 1.5 })).toThrow(PatchError);
    });

    it("gives physical I/O modules ports on one side only, and at most one of each", () => {
        const patch = makePatch([]);
        expect(() => patch.addModule({ kind: "input", name: "in2", numInputs: 0, numOutputs: 2 })).toThrow(PatchError);
        const other = new Patch();
        expect(() => other.addModule({ kind: "input", name: "in", numInputs: 1, numOutputs: 2 })).toThrow(PatchError);
        expect(() => other.addModule({ kind: "output", name: "out", numInputs: 2, numOutputs: 1 })).toThrow(PatchError);
    });

    it("generates unique numeric ids after existing ones", () => {
        const patch = new Patch();
        patch.addModule({ id: "7", name: "a", numInputs: 0, numOutputs: 1 });
        expect(patch.addModule({ name: "b", numInputs: 0, numOutputs: 1 }).id).toBe("8");
        expect(() => patch.addModule({ id: "7", name: "c", numInputs: 0, numOutputs: 1 })).toThrow(PatchError);
    });

    it("removes a module with all its connections, connections first", () => {
        const patch = makePatch([["A", 1, 1], ["B", 1, 1]]);
        patch.connect({ module: "A", port: 0 }, { module: "B", port: 0 });
        patch.connect({ module: "B", port: 0 }, { module: "output", port: 0 });
        patch.connect({ module: "input", port: 0 }, { module: "A", port: 0 });
        const events: string[] = [];
        patch.subscribe((e) => events.push(e.type));
        expect(patch.removeModule("A")).toHaveLength(2);
        expect(events).toEqual(["connectionRemoved", "connectionRemoved", "moduleRemoved"]);
        expect(pairs(patch.getConnections())).toEqual(["B:0>output:0"]);
    });

    it("drops the connections of removed ports when the arity changes", () => {
        const patch = makePatch([["A", 2, 2], ["B", 2, 2]]);
        patch.connectBus("A", "B");
        patch.connectBus("B", "output");
        const removed = patch.setArity("B", 1, 2);
        expect(pairs(removed)).toEqual(["A:1>B:1"]);
        expect(patch.getModule("B")).toMatchObject({ numInputs: 1, numOutputs: 2 });
        expect(pairs(patch.getConnections())).toEqual(["A:0>B:0", "B:0>output:0", "B:1>output:1"]);
    });
});

describe("connections", () => {
    it("checks modules, port ranges and duplicates", () => {
        const patch = makePatch([["A", 1, 2], ["B", 2, 1]]);
        expect(() => patch.connect({ module: "A", port: 2 }, { module: "B", port: 0 })).toThrow(/no output 2/);
        expect(() => patch.connect({ module: "A", port: 0 }, { module: "B", port: 2 })).toThrow(/no input 2/);
        expect(() => patch.connect({ module: "X", port: 0 }, { module: "B", port: 0 })).toThrow(/does not exist/);
        expect(() => patch.connect({ module: "output", port: 0 }, { module: "B", port: 0 })).toThrow(/no output/);
        patch.connect({ module: "A", port: 0 }, { module: "B", port: 0 });
        expect(() => patch.connect({ module: "A", port: 0 }, { module: "B", port: 0 })).toThrow(/already connected/);
    });

    it("allows fan-in, fan-out and self-loops", () => {
        const patch = makePatch([["A", 1, 1], ["B", 1, 1]]);
        patch.connect({ module: "A", port: 0 }, { module: "output", port: 0 });
        patch.connect({ module: "B", port: 0 }, { module: "output", port: 0 });
        patch.connect({ module: "A", port: 0 }, { module: "output", port: 1 });
        patch.connect({ module: "A", port: 0 }, { module: "A", port: 0 });
        expect(patch.connectionsTo("output")).toHaveLength(3);
        expect(patch.connectionsFrom("A")).toHaveLength(3);
    });

    it("connectBus applies the cyclic rule and skips existing connections", () => {
        const patch = makePatch([["mono", 0, 1], ["stereo", 0, 2], ["fx", 1, 1]]);
        expect(pairs(patch.connectBus("mono", "output"))).toEqual(["mono:0>output:0", "mono:0>output:1"]);
        expect(pairs(patch.connectBus("stereo", "fx"))).toEqual(["stereo:0>fx:0", "stereo:1>fx:0"]);
        expect(patch.connectBus("mono", "output")).toEqual([]);
    });

    it("emits connection events", () => {
        const patch = makePatch([["A", 0, 1]]);
        const events: PatchEvent[] = [];
        const unsubscribe = patch.subscribe((e) => events.push(e));
        const c = patch.connect({ module: "A", port: 0 }, { module: "output", port: 1 });
        patch.disconnect(c.id);
        unsubscribe();
        patch.connect({ module: "A", port: 0 }, { module: "output", port: 0 });
        expect(events.map((e) => e.type)).toEqual(["connectionAdded", "connectionRemoved"]);
    });
});

describe("analyze: feedback connections and topological order", () => {
    it("finds no feedback in an acyclic patch", () => {
        const patch = makePatch([["A", 1, 1], ["B", 1, 1]]);
        patch.connectBus("input", "A");
        patch.connectBus("A", "B");
        patch.connectBus("B", "output");
        const { feedback, order } = patch.analyze();
        expect(feedback.size).toBe(0);
        expect(order.indexOf("input")).toBeLessThan(order.indexOf("A"));
        expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
        expect(order.indexOf("B")).toBeLessThan(order.indexOf("output"));
    });

    it("delays the connection that goes back towards the source", () => {
        const patch = makePatch([["gen", 0, 1], ["A", 1, 1], ["B", 1, 1]]);
        patch.connect({ module: "B", port: 0 }, { module: "A", port: 0 });     // inserted first on purpose
        patch.connect({ module: "gen", port: 0 }, { module: "A", port: 0 });
        patch.connect({ module: "A", port: 0 }, { module: "B", port: 0 });
        patch.connect({ module: "B", port: 0 }, { module: "output", port: 0 });
        const { feedback } = patch.analyze();
        expect(Array.from(feedback).map((id) => pairs([patch.getConnection(id)!])[0])).toEqual(["B:0>A:0"]);
    });

    it("treats self-loops as feedback", () => {
        const patch = makePatch([["A", 1, 1]]);
        const loop = patch.connect({ module: "A", port: 0 }, { module: "A", port: 0 });
        expect(patch.analyze().feedback).toEqual(new Set([loop.id]));
    });

    it("does not depend on the order in which connections were made", () => {
        const edges: Array<[string, string]> = [["gen", "A"], ["A", "B"], ["B", "C"], ["C", "A"], ["B", "output"], ["C", "B"]];
        const results = [edges, [...edges].reverse()].map((list) => {
            const patch = makePatch([["gen", 0, 1], ["A", 1, 1], ["B", 1, 1], ["C", 1, 1]]);
            list.forEach(([a, b]) => patch.connectBus(a, b));
            const { feedback, order } = patch.analyze();
            return { feedback: pairs(Array.from(feedback).map((id) => patch.getConnection(id)!)).sort(), order };
        });
        expect(results[0]).toEqual(results[1]);
        expect(results[0].feedback).toEqual(["C:0>A:0", "C:0>B:0"]);
    });

    it("on random graphs: removing the feedback connections leaves a DAG ordered by `order`", () => {
        let seed = 12345;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        for (let trial = 0; trial < 200; trial++) {
            const n = 1 + Math.floor(random() * 8);
            const ids = Array.from({ length: n }, (_, i) => `m${i}`);
            const patch = makePatch(ids.map((id) => [id, 2, 2] as [string, number, number]));
            const all = ["input", ...ids, "output"];
            for (let e = 0; e < Math.floor(random() * 3 * n); e++) {
                const a = all[Math.floor(random() * (all.length - 1))];          // any module but output
                const b = all[1 + Math.floor(random() * (all.length - 1))];      // any module but input
                const from = { module: a, port: Math.floor(random() * 2) };
                const to = { module: b, port: Math.floor(random() * 2) };
                if (!patch.findConnection(from, to)) patch.connect(from, to);
            }
            const { feedback, order } = patch.analyze();
            expect(new Set(order)).toEqual(new Set(all));
            const position = new Map(order.map((id, i) => [id, i]));
            for (const c of patch.getConnections()) {
                if (!feedback.has(c.id)) {
                    expect(position.get(c.from.module)!).toBeLessThan(position.get(c.to.module)!);
                } else {
                    // a feedback connection goes backwards (or is a self-loop)
                    expect(position.get(c.from.module)!).toBeGreaterThanOrEqual(position.get(c.to.module)!);
                }
            }
        }
    });
});
