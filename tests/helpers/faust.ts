// Node.js harness around libfaust (faustwasm): compile Faust code and render it offline.
import { createRequire } from "module";
// The package has no "exports" map: Node resolves "main" (CJS); load the ESM build explicitly.
import * as fw from "@grame/faustwasm/dist/esm/index.js";

const require = createRequire(import.meta.url);

let compilerPromise: Promise<fw.FaustCompiler> | undefined;

export function getCompiler(): Promise<fw.FaustCompiler> {
    compilerPromise ??= (async () => {
        const jsFile = require.resolve("@grame/faustwasm/libfaust-wasm/libfaust-wasm.js");
        const module = await fw.instantiateFaustModuleFromFile(jsFile);
        return new fw.FaustCompiler(new fw.LibFaust(module));
    })();
    return compilerPromise;
}

export interface FaustJson {
    inputs: number;
    outputs: number;
    ui: any[];
}

export async function compileJson(name: string, code: string): Promise<FaustJson> {
    const compiler = await getCompiler();
    const factory = await compiler.createMonoDSPFactory(name, code, "-ftz 2");
    if (!factory) throw new Error(`${name}: compilation failed`);
    return JSON.parse(factory.json);
}

// Render `code` for `length` samples, each input being a constant signal.
export async function renderConstant(name: string, code: string, inputs: number[], length: number): Promise<number[][]> {
    const compiler = await getCompiler();
    const generator = new fw.FaustMonoDspGenerator();
    await generator.compile(compiler, name, code, "-ftz 2");
    const processor = await generator.createOfflineProcessor(48000, length);
    if (!processor) throw new Error(`${name}: cannot create offline processor`);
    const out = processor.render(inputs.map(v => new Float32Array(length).fill(v)), length);
    return out.map(channel => Array.from(channel));
}

// Addresses of all the UI widgets of a compiled DSP.
export function widgetAddresses(json: FaustJson): string[] {
    const addresses: string[] = [];
    const walk = (items: any[]) => items.forEach(w => w.items ? walk(w.items) : addresses.push(w.address));
    walk(json.ui);
    return addresses;
}
