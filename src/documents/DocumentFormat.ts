/*				DOCUMENTFORMAT.TS
    Documents, format version 4 (Documentation/DOCUMENT-SPEC.md, "Le document"): the scene with the
    codes replaced by their hashes. The codes live in the store (DocumentStore).

    {
      "format": "faustmodular-document", "version": 4, "name": "...",
      "faust": { "libfaust": "2.90.19", "libraries": "<hash of the environment>" | null },
      "generator": 1,
      "instances": [ { "id", "name", "code": "<sha1>", "wrapped": true, "x", "y", "inputs", "outputs",
                       "params": {...}, "acc": [...], "modulations": [...] } ],
      "io": { "input": { "x", "y" }, "output": { "x", "y" } },
      "connections": [ "1:0>output:0", ... ]
    }

    - "code" is the hash of the user's code: the code without the group faustmodular wraps it in
      (model/ModuleCode.ts). "wrapped": false when the module's code is not in that form (some 1.x
      files): the code is then stored and compiled as it is.
    - A document migrated from an older format, not opened yet, keeps that file in "legacy"; it is
      converted the first time it is opened.

    The conversions go through the version 2/3 patch file (model/PatchFormat.ts), which the scene
    knows how to save and open.
*/

import { wrapModuleCode, unwrapModuleCode } from "../model/ModuleCode";
import { ModuleFileV2, ModulationFile, PATCH_FORMAT, PATCH_VERSION, PATCH_VERSION_MODULATIONS, PatchFileV2 } from "../model/PatchFormat";
import { AccMapping, MAX_CHANNELS } from "../model/Patch";
import { sha1 } from "./Sha1";

export const DOCUMENT_FORMAT = "faustmodular-document";
export const DOCUMENT_VERSION = 4;
// Version of the code faustmodular adds to the user's code (group, modulation circuits).
export const GENERATOR_VERSION = 1;

export interface FaustEnvironment {
    libfaust: string;
    libraries: string | null;       // hash of the environment of libraries (null: unknown)
}

export interface InstanceV4 {
    id: string;
    name: string;
    code: string;                   // sha1 of the stored code
    wrapped: boolean;
    x: number;
    y: number;
    inputs: number;
    outputs: number;
    params: Record<string, number>;
    acc: AccMapping[];
    modulations: ModulationFile[];
}

export interface DocumentV4 {
    format: typeof DOCUMENT_FORMAT;
    version: typeof DOCUMENT_VERSION;
    name: string;
    faust: FaustEnvironment;
    generator: number;
    instances: InstanceV4[];
    io: { input: { x: number; y: number }; output: { x: number; y: number } };
    connections: string[];
    legacy?: string;                // file of an older format, not converted yet
}

export class DocumentFormatError extends Error { }

const connectionKey = (c: { from: { module: string; port: number }; to: { module: string; port: number } }) =>
    `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`;

// The code stored for a module: the user's code if the module's code is wrapped by faustmodular in a
// group of its name, the whole code otherwise. Its hash identifies the version.
export function storedCode(name: string, source: string): { code: string; wrapped: boolean } {
    const unwrapped = unwrapModuleCode(source);
    const wrapped = unwrapped != null && wrapModuleCode(name, unwrapped.code) == source;
    return wrapped ? { code: unwrapped!.code, wrapped } : { code: source, wrapped };
}

// The document of a scene saved as a patch file, and the codes it references (hash -> code).
export async function documentFromPatch(file: PatchFileV2, name: string, faust: FaustEnvironment): Promise<{ document: DocumentV4; codes: Map<string, string> }> {
    const codes = new Map<string, string>();
    const instances: InstanceV4[] = [];
    const io = { input: { x: 0, y: 0 }, output: { x: 0, y: 0 } };
    for (const m of file.modules) {
        if (m.kind == "input" || m.kind == "output") {
            io[m.kind] = { x: m.x, y: m.y };
            continue;
        }
        const { code, wrapped } = storedCode(m.name, m.code);
        const hash = await sha1(code);
        codes.set(hash, code);
        instances.push({
            id: m.id, name: m.name, code: hash, wrapped, x: m.x, y: m.y, inputs: m.inputs, outputs: m.outputs,
            params: { ...m.params }, acc: m.acc.map((a) => ({ ...a })),
            modulations: (m.modulations ?? []).map((x) => ({ ...x })),
        });
    }
    // in the order of the ids, like the states of the history (a module created again by an undo
    // is not at the same place in the patch)
    instances.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return {
        document: {
            format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name, faust, generator: GENERATOR_VERSION,
            instances, io, connections: file.connections.map(connectionKey).sort(),
        },
        codes,
    };
}

// The patch file of a document, with its codes; throws DocumentFormatError if a code is missing.
export function patchFromDocument(document: DocumentV4, codeOf: (hash: string) => string | undefined): PatchFileV2 {
    // the channels of the physical input and output depend on the hardware, not on the document
    const modules: ModuleFileV2[] = [
        { id: "input", kind: "input", name: "input", code: "", x: document.io.input.x, y: document.io.input.y, inputs: 0, outputs: MAX_CHANNELS, params: {}, acc: [] },
        { id: "output", kind: "output", name: "output", code: "", x: document.io.output.x, y: document.io.output.y, inputs: MAX_CHANNELS, outputs: 0, params: {}, acc: [] },
    ];
    for (const i of document.instances) {
        const code = codeOf(i.code);
        if (code === undefined) throw new DocumentFormatError(`instance ${i.id} (${i.name}): code ${i.code} not found`);
        const module: ModuleFileV2 = {
            id: i.id, kind: "faust", name: i.name, code: i.wrapped ? wrapModuleCode(i.name, code) : code,
            x: i.x, y: i.y, inputs: i.inputs, outputs: i.outputs, params: { ...i.params }, acc: i.acc.map((a) => ({ ...a })),
        };
        if (i.modulations.length > 0) module.modulations = i.modulations.map((x) => ({ ...x }));
        modules.push(module);
    }
    const connections = document.connections.map((key) => {
        const [from, to] = key.split(">").map((end) => {
            const i = end.lastIndexOf(":");
            return { module: end.slice(0, i), port: Number(end.slice(i + 1)) };
        });
        return { from, to };
    });
    const modulated = document.instances.some((i) => i.modulations.length > 0);
    return { format: PATCH_FORMAT, version: modulated ? PATCH_VERSION_MODULATIONS : PATCH_VERSION, sceneName: document.name, modules, connections };
}

// The content compared to tell whether a document is modified: everything but the name.
export function documentContent(document: DocumentV4): string {
    const { name, ...content } = document;
    return JSON.stringify(content);
}

export function isDocument(data: unknown): data is { format: string } {
    return typeof data == "object" && data !== null && (data as any).format == DOCUMENT_FORMAT;
}

// Validates a document read from the store (or imported): throws DocumentFormatError.
export function parseDocument(data: unknown): DocumentV4 {
    const where = (path: string, message: string) => new DocumentFormatError(`${path}: ${message}`);
    if (!isDocument(data)) throw new DocumentFormatError("not a faustmodular document");
    const d = data as any;
    if (d.version != DOCUMENT_VERSION) throw new DocumentFormatError(`unsupported document version ${String(d.version)}`);
    if (typeof d.name != "string") throw where("name", "string expected");
    if (typeof d.legacy == "string") {
        return { format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name: d.name, faust: { libfaust: "", libraries: null }, generator: GENERATOR_VERSION, instances: [], io: { input: { x: 0, y: 0 }, output: { x: 0, y: 0 } }, connections: [], legacy: d.legacy };
    }
    if (!Array.isArray(d.instances)) throw where("instances", "array expected");
    if (!Array.isArray(d.connections) || d.connections.some((c: unknown) => typeof c != "string" || !/^[^>]+:\d+>[^>]+:\d+$/.test(c))) {
        throw where("connections", "array of \"from:port>to:port\" expected");
    }
    for (const [k, i] of (d.instances as any[]).entries()) {
        for (const field of ["id", "name", "code"]) {
            if (typeof i?.[field] != "string") throw where(`instances[${k}].${field}`, "string expected");
        }
        for (const field of ["x", "y", "inputs", "outputs"]) {
            if (typeof i[field] != "number" || !Number.isFinite(i[field])) throw where(`instances[${k}].${field}`, "number expected");
        }
        if (typeof i.wrapped != "boolean") throw where(`instances[${k}].wrapped`, "boolean expected");
        if (typeof i.params != "object" || i.params === null) throw where(`instances[${k}].params`, "object expected");
        if (!Array.isArray(i.acc)) throw where(`instances[${k}].acc`, "array expected");
        if (!Array.isArray(i.modulations)) throw where(`instances[${k}].modulations`, "array expected");
    }
    const point = (p: any, path: string) => {
        if (typeof p?.x != "number" || typeof p?.y != "number") throw where(path, "{ x, y } expected");
        return { x: p.x, y: p.y };
    };
    return {
        format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name: d.name,
        faust: { libfaust: String(d.faust?.libfaust ?? ""), libraries: typeof d.faust?.libraries == "string" ? d.faust.libraries : null },
        generator: typeof d.generator == "number" ? d.generator : GENERATOR_VERSION,
        instances: d.instances, io: { input: point(d.io?.input, "io.input"), output: point(d.io?.output, "io.output") },
        connections: d.connections,
    };
}
