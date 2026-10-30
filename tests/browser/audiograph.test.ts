// AudioGraph against real Web Audio (Chromium, OfflineAudioContext) and real faustwasm nodes.
import { describe, expect, it } from "vitest";
import { AudioGraph } from "../../src/audio/AudioGraph";
import { Patch } from "../../src/model/Patch";
import { faustNode } from "./faust";

const LENGTH = 512;

interface Setup {
    context: OfflineAudioContext;
    patch: Patch;
    graph: AudioGraph;
    add(id: string, code: string): Promise<void>;
}

// Patch whose output module is the destination of an offline context of `channels` channels.
function setup(channels: number): Setup {
    const context = new OfflineAudioContext(channels, LENGTH, 48000);
    context.destination.channelInterpretation = "discrete";
    const patch = new Patch();
    const graph = new AudioGraph(context, patch);
    patch.addModule({ id: "output", kind: "output", name: "output", numInputs: channels, numOutputs: 0 });
    graph.setNode("output", context.destination);
    return {
        context, patch, graph,
        async add(id: string, code: string) {
            const { node, numInputs, numOutputs } = await faustNode(context, code);
            patch.addModule({ id, name: id, code, numInputs, numOutputs });
            graph.setNode(id, node);
        },
    };
}

async function render(s: Setup): Promise<Float32Array[]> {
    const buffer = await s.context.startRendering();
    return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
}

const at = (channels: Float32Array[], frame: number) => channels.map((c) => +c[frame].toFixed(4));
const port = (module: string, p: number) => ({ module, port: p });

describe("AudioGraph", () => {
    it("routes channels port to port, sums fan-in and shares fan-out", async () => {
        const s = setup(4);
        await s.add("A", "process = 1, 2, 3;");         // 0 x 3
        await s.add("B", "process = _, _ <: -, +;");     // 2 x 2: (x - y, x + y)
        s.patch.connect(port("A", 2), port("output", 0));
        s.patch.connect(port("A", 1), port("B", 0));
        s.patch.connect(port("A", 0), port("B", 1));
        s.patch.connect(port("B", 0), port("output", 1));    // 2 - 1 = 1
        s.patch.connect(port("A", 0), port("output", 1));    // fan-in: 1 + 1 = 2
        s.patch.connect(port("B", 1), port("output", 2));    // 2 + 1 = 3
        s.patch.connect(port("A", 1), port("output", 3));    // fan-out of A:1 (also feeds B:0)
        expect(s.graph.getWireCount()).toEqual({ wires: 7, delayed: 0 });
        expect(at(await render(s), 200)).toEqual([3, 2, 3, 2]);
    });

    it("leaves unconnected inputs silent and applies disconnections", async () => {
        const s = setup(2);
        await s.add("A", "process = 1, 2;");
        const c = s.patch.connect(port("A", 0), port("output", 0));
        s.patch.connect(port("A", 1), port("output", 0));
        s.patch.disconnect(c.id);
        expect(at(await render(s), 200)).toEqual([2, 0]);
    });

    it("delays feedback connections by one render quantum", async () => {
        const s = setup(1);
        await s.add("gen", "process = 1;");
        await s.add("acc", "process = *(0.5);");
        s.patch.connect(port("gen", 0), port("acc", 0));
        s.patch.connect(port("acc", 0), port("acc", 0));     // y = 0.5 (1 + y delayed)
        s.patch.connect(port("acc", 0), port("output", 0));
        expect(s.graph.getWireCount()).toEqual({ wires: 3, delayed: 1 });
        const out = await render(s);
        expect(at(out, 0)).toEqual([0.5]);
        expect(at(out, 127)).toEqual([0.5]);
        expect(at(out, 128)).toEqual([0.75]);
        expect(at(out, 256)).toEqual([0.875]);
    });

    it("moves the delay when a connection starts closing a cycle", async () => {
        const s = setup(1);
        await s.add("A", "process = *(0.5);");
        await s.add("B", "process = _ + 1;");
        s.patch.connect(port("B", 0), port("A", 0));
        expect(s.graph.getWireCount()).toEqual({ wires: 1, delayed: 0 });
        s.patch.connect(port("A", 0), port("B", 0));         // closes the cycle A -> B -> A
        s.patch.connect(port("A", 0), port("output", 0));
        expect(s.graph.getWireCount()).toEqual({ wires: 3, delayed: 1 });
        // a = 0.5 (a delayed + 1): 0.5, 0.75, 0.875 per block, as for a self-loop
        const out = await render(s);
        expect([at(out, 10), at(out, 130), at(out, 260)]).toEqual([[0.5], [0.75], [0.875]]);
    });

    it("rebuilds the ports when a module node and arity are replaced", async () => {
        const s = setup(2);
        await s.add("A", "process = 1, 2;");
        s.patch.connectBus("A", "output");
        const { node, numInputs, numOutputs } = await faustNode(s.context, "process = 5;");
        expect(s.patch.setArity("A", numInputs, numOutputs)).toHaveLength(1);    // A:1 > output:1 dropped
        s.graph.setNode("A", node);
        expect(at(await render(s), 200)).toEqual([5, 0]);
    });

    it("unwires removed modules", async () => {
        const s = setup(1);
        await s.add("A", "process = 1;");
        await s.add("B", "process = 2;");
        s.patch.connectBus("A", "output");
        s.patch.connectBus("B", "output");
        s.patch.removeModule("B");
        expect(s.graph.getWireCount()).toEqual({ wires: 1, delayed: 0 });
        expect(at(await render(s), 200)).toEqual([1]);
    });
});
