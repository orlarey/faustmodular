// Shared helper: instantiate libfaust (faustwasm) under Node.js.
// Run the probes from the repository root, after `npm install`.
import path from "path";
import { pathToFileURL } from "url";

const root = process.cwd();
const fwPath = path.join(root, "node_modules/@grame/faustwasm/dist/esm/index.js");
export const fw = await import(pathToFileURL(fwPath).href);
const libDir = path.join(root, "node_modules/@grame/faustwasm/libfaust-wasm/");
export const compiler = new fw.FaustCompiler(new fw.LibFaust(await fw.instantiateFaustModuleFromFile(libDir + "libfaust-wasm.js")));

// Compile `code`, feed constant input signals, return outputs over n samples.
export async function render(name, code, inputs, n = 4) {
    const g = new fw.FaustMonoDspGenerator();
    await g.compile(compiler, name, code, "-ftz 2");
    const json = JSON.parse(g.factory.json);
    const p = await g.createOfflineProcessor(48000, n);
    const out = p.render(inputs.map(v => new Float32Array(n).fill(v)), n);
    return { inputs: json.inputs, outputs: json.outputs, out: out.map(a => Array.from(a).map(x => +x.toFixed(4))) };
}
