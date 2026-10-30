// Browser harness: compile Faust code into faustwasm nodes of a given (offline) context.
import jsURL from "@grame/faustwasm/libfaust-wasm/libfaust-wasm.js?url";
import dataURL from "@grame/faustwasm/libfaust-wasm/libfaust-wasm.data?url";
import wasmURL from "@grame/faustwasm/libfaust-wasm/libfaust-wasm.wasm?url";
import * as fw from "@grame/faustwasm/dist/esm/index.js";

let compilerPromise: Promise<fw.FaustCompiler> | undefined;

function getCompiler(): Promise<fw.FaustCompiler> {
    compilerPromise ??= (async () => new fw.FaustCompiler(new fw.LibFaust(await fw.instantiateFaustModuleFromFile(jsURL, dataURL, wasmURL))))();
    return compilerPromise;
}

let counter = 0;

export async function faustNode(context: BaseAudioContext, code: string): Promise<{ node: AudioNode; numInputs: number; numOutputs: number }> {
    const generator = new fw.FaustMonoDspGenerator();
    // A distinct name per node: each name registers its own AudioWorklet processor.
    const name = `dsp${counter++}`;
    await generator.compile(await getCompiler(), name, code, "");
    const node = await generator.createNode(context, name);
    if (!node) throw new Error("cannot create node");
    return { node, numInputs: node.getNumInputs(), numOutputs: node.getNumOutputs() };
}
