/*				DOCUMENTFORMAT.TS
    Documents, format version 5 (Documentation/DOCUMENT-SPEC.md, "Le document";
    Documentation/SCENE-RESOURCES-SPEC.md, "Le stockage"): the scene with its resources, the codes
    replaced by their hashes. The codes live in the store (DocumentStore); the working code of each
    resource lives also in a file of the document, resources/<file>, which faustcode edits.

    {
      "format": "faustmodular-document", "version": 5, "name": "...",
      "faust": { "libfaust": "2.90.19", "libraries": "<hash of the environment>" | null },
      "generator": 1,
      "resources": [ { "name", "file": "VCO.dsp", "code": "<sha1>", "wrapped": true, "provenance": {...} } ],
      "instances": [ { "id", "resource": "<name>", "x", "y", "inputs", "outputs",
                       "params": {...}, "acc": [...], "modulations": [...] } ],
      "io": { "input": { "x", "y" }, "output": { "x", "y" } },
      "connections": [ "1:0>output:0", ... ]
    }

    - A resource is a name (the Faust group of its instances), the hash of the user's code (without the
      group, model/ModuleCode.ts) and its provenance (model/Resources.ts). "wrapped": false when the code
      is not in that form (some 1.x files): it is then stored and compiled as it is.
    - Format 4 (each instance with its name and its code) is read and migrated (model/Resources.ts,
      migrateInstances): the instances of the same name and code share a resource.
    - A document migrated from an older format, not opened yet, keeps that file in "legacy"; it is
      converted the first time it is opened.

    The conversions go through the patch file (model/PatchFormat.ts, version 4 with its resources), which
    the scene knows how to save and open.
*/

import { wrapModuleCode, unwrapModuleCode } from "../model/ModuleCode";
import { ModuleFileV2, ModulationFile, PATCH_FORMAT, PATCH_VERSION_RESOURCES, PatchFileV2, ResourceFile, parseProvenance, parseView } from "../model/PatchFormat";
import { AccMapping, MAX_CHANNELS, ModuleViewSettings } from "../model/Patch";
import { NO_PROVENANCE, Provenance, migrateInstances, resourceFileName, uniqueName } from "../model/Resources";
import { sha1 } from "./Sha1";

export const DOCUMENT_FORMAT = "faustmodular-document";
export const DOCUMENT_VERSION = 5;
// Version of the code faustmodular adds to the user's code (group, modulation circuits).
export const GENERATOR_VERSION = 1;

export interface FaustEnvironment {
    libfaust: string;
    libraries: string | null;       // hash of the environment of libraries (null: unknown)
}

export interface ResourceV5 {
    name: string;
    file: string;                   // resources/<file>: its working code, edited by faustcode
    code: string;                   // sha1 of the stored code
    wrapped: boolean;
    provenance: Provenance;
}

export interface InstanceV5 {
    id: string;
    resource: string;               // the name of its resource
    x: number;
    y: number;
    inputs: number;
    outputs: number;
    params: Record<string, number>;
    acc: AccMapping[];
    modulations: ModulationFile[];
    view?: ModuleViewSettings;      // the Orbit interface (3.28.0), absent for the classic one
}

export interface DocumentV5 {
    format: typeof DOCUMENT_FORMAT;
    version: typeof DOCUMENT_VERSION;
    name: string;
    faust: FaustEnvironment;
    generator: number;
    resources: ResourceV5[];
    instances: InstanceV5[];
    io: { input: { x: number; y: number }; output: { x: number; y: number } };
    connections: string[];
    legacy?: string;                // file of an older format, not converted yet
}

// The document of the current format.
export type StoredDocument = DocumentV5;

export class DocumentFormatError extends Error { }

const connectionKey = (c: { from: { module: string; port: number }; to: { module: string; port: number } }) =>
    `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`;

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true });

// The code stored for a module: the user's code if the module's code is wrapped by faustmodular in a
// group of its name, the whole code otherwise. Its hash identifies the version.
export function storedCode(name: string, source: string): { code: string; wrapped: boolean } {
    const unwrapped = unwrapModuleCode(source);
    const wrapped = unwrapped != null && wrapModuleCode(name, unwrapped.code) == source;
    return wrapped ? { code: unwrapped!.code, wrapped } : { code: source, wrapped };
}

// The files of resources, in the order of the resources: their names made fit for a file, unique.
export function assignFiles<R extends { name: string }>(resources: R[]): Array<R & { file: string }> {
    const files: string[] = [];
    return resources.map((r) => {
        const file = resourceFileName(r.name, files);
        files.push(file);
        return { ...r, file };
    });
}

// The document of a scene saved as a patch file, and the codes it references (hash -> code).
// The instances of the same name and code share a resource (a name held by two codes is suffixed:
// model/Resources.ts); the resources of the file give their provenance, and those without instance
// are kept. `provenanceOf`: the provenance of a code the file does not give (library, user module).
export async function documentFromPatch(
    file: PatchFileV2, name: string, faust: FaustEnvironment,
    provenanceOf: (hash: string) => Provenance = () => NO_PROVENANCE,
): Promise<{ document: DocumentV5; codes: Map<string, string> }> {
    const codes = new Map<string, string>();
    const io = { input: { x: 0, y: 0 }, output: { x: 0, y: 0 } };
    const modules: Array<Omit<InstanceV5, "resource"> & { name: string; code: string; wrapped: boolean }> = [];
    for (const m of file.modules) {
        if (m.kind == "input" || m.kind == "output") {
            io[m.kind] = { x: m.x, y: m.y };
            continue;
        }
        const { code, wrapped } = storedCode(m.name, m.code);
        const hash = await sha1(code);
        codes.set(hash, code);
        modules.push({
            id: m.id, name: m.name, code: hash, wrapped, x: m.x, y: m.y, inputs: m.inputs, outputs: m.outputs,
            params: { ...m.params }, acc: m.acc.map((a) => ({ ...a })),
            modulations: (m.modulations ?? []).map((x) => ({ ...x })),
            ...(m.view ? { view: m.view } : {}),
        });
    }
    // the resources the file declares: by name, with the hash of their code
    const declared = new Map<string, { hash: string; resource: ResourceFile }>();
    for (const r of file.resources ?? []) {
        const hash = await sha1(r.code);
        codes.set(hash, r.code);
        declared.set(r.name, { hash, resource: r });
    }
    const { resources, instances } = migrateInstances(modules, (hash, wrapped, moduleName) => {
        const d = declared.get(moduleName);
        return d && d.hash == hash && d.resource.wrapped == wrapped ? d.resource.provenance : provenanceOf(hash);
    });
    // the declared resources no instance uses: kept (the catalogue of the scene)
    for (const [declaredName, { hash, resource }] of declared) {
        if (resources.some((r) => r.name == declaredName && r.code == hash)) continue;
        if (instances.some((i) => i.resource == declaredName)) continue;
        resources.push({ name: uniqueName(declaredName, resources.map((r) => r.name)), code: hash, wrapped: resource.wrapped, provenance: resource.provenance });
    }
    // in the order of the ids, like the states of the history (a module created again by an undo
    // is not at the same place in the patch); the resources in the order of their names
    instances.sort(byId);
    resources.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return {
        document: {
            format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name, faust, generator: GENERATOR_VERSION,
            resources: assignFiles(resources), instances, io, connections: file.connections.map(connectionKey).sort(),
        },
        codes,
    };
}

// The patch file of a document, with its codes and its resources; throws DocumentFormatError if a code
// or a resource is missing.
export function patchFromDocument(document: DocumentV5, codeOf: (hash: string) => string | undefined): PatchFileV2 {
    // the channels of the physical input and output depend on the hardware, not on the document
    const modules: ModuleFileV2[] = [
        { id: "input", kind: "input", name: "input", code: "", x: document.io.input.x, y: document.io.input.y, inputs: 0, outputs: MAX_CHANNELS, params: {}, acc: [] },
        { id: "output", kind: "output", name: "output", code: "", x: document.io.output.x, y: document.io.output.y, inputs: MAX_CHANNELS, outputs: 0, params: {}, acc: [] },
    ];
    const resources = new Map<string, ResourceFile>();
    for (const r of document.resources) {
        const code = codeOf(r.code);
        if (code === undefined) throw new DocumentFormatError(`resource ${r.name}: code ${r.code} not found`);
        resources.set(r.name, { name: r.name, code, wrapped: r.wrapped, provenance: r.provenance });
    }
    for (const i of document.instances) {
        const r = resources.get(i.resource);
        if (!r) throw new DocumentFormatError(`instance ${i.id}: resource ${i.resource} not found`);
        const module: ModuleFileV2 = {
            id: i.id, kind: "faust", name: r.name, code: r.wrapped ? wrapModuleCode(r.name, r.code) : r.code,
            x: i.x, y: i.y, inputs: i.inputs, outputs: i.outputs, params: { ...i.params }, acc: i.acc.map((a) => ({ ...a })),
        };
        if (i.modulations.length > 0) module.modulations = i.modulations.map((x) => ({ ...x }));
        if (i.view) module.view = i.view;
        modules.push(module);
    }
    const connections = document.connections.map((key) => {
        const [from, to] = key.split(">").map((end) => {
            const i = end.lastIndexOf(":");
            return { module: end.slice(0, i), port: Number(end.slice(i + 1)) };
        });
        return { from, to };
    });
    return { format: PATCH_FORMAT, version: PATCH_VERSION_RESOURCES, sceneName: document.name, modules, connections, resources: Array.from(resources.values()) };
}

// The content compared to tell whether a document is modified: everything but the name.
export function documentContent(document: DocumentV5): string {
    const { name, ...content } = document;
    return JSON.stringify(content);
}

export function isDocument(data: unknown): data is { format: string } {
    return typeof data == "object" && data !== null && (data as any).format == DOCUMENT_FORMAT;
}

// Validates a document read from the store (or imported), of format 4 (migrated) or 5: throws
// DocumentFormatError.
export function parseDocument(data: unknown): DocumentV5 {
    const where = (path: string, message: string) => new DocumentFormatError(`${path}: ${message}`);
    if (!isDocument(data)) throw new DocumentFormatError("not a faustmodular document");
    const d = data as any;
    if (d.version != 4 && d.version != DOCUMENT_VERSION) throw new DocumentFormatError(`unsupported document version ${String(d.version)}`);
    if (typeof d.name != "string") throw where("name", "string expected");
    const empty = (): DocumentV5 => ({ format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name: d.name, faust: { libfaust: "", libraries: null }, generator: GENERATOR_VERSION, resources: [], instances: [], io: { input: { x: 0, y: 0 }, output: { x: 0, y: 0 } }, connections: [] });
    if (typeof d.legacy == "string") return { ...empty(), legacy: d.legacy };
    if (!Array.isArray(d.instances)) throw where("instances", "array expected");
    if (!Array.isArray(d.connections) || d.connections.some((c: unknown) => typeof c != "string" || !/^[^>]+:\d+>[^>]+:\d+$/.test(c))) {
        throw where("connections", "array of \"from:port>to:port\" expected");
    }
    const v4 = d.version == 4;
    if (!v4 && !Array.isArray(d.resources)) throw where("resources", "array expected");
    for (const [k, i] of (d.instances as any[]).entries()) {
        for (const field of v4 ? ["id", "name", "code"] : ["id", "resource"]) {
            if (typeof i?.[field] != "string") throw where(`instances[${k}].${field}`, "string expected");
        }
        for (const field of ["x", "y", "inputs", "outputs"]) {
            if (typeof i[field] != "number" || !Number.isFinite(i[field])) throw where(`instances[${k}].${field}`, "number expected");
        }
        if (v4 && typeof i.wrapped != "boolean") throw where(`instances[${k}].wrapped`, "boolean expected");
        if (typeof i.params != "object" || i.params === null) throw where(`instances[${k}].params`, "object expected");
        if (!Array.isArray(i.acc)) throw where(`instances[${k}].acc`, "array expected");
        if (!Array.isArray(i.modulations)) throw where(`instances[${k}].modulations`, "array expected");
        if (i.view !== undefined) {
            try {
                parseView(i.view, `instances[${k}].view`);
            } catch (e) {
                throw new DocumentFormatError(String((e as Error).message));
            }
        }
    }
    const point = (p: any, path: string) => {
        if (typeof p?.x != "number" || typeof p?.y != "number") throw where(path, "{ x, y } expected");
        return { x: p.x, y: p.y };
    };
    let resources: ResourceV5[];
    let instances: InstanceV5[];
    if (v4) {
        // format 4: the instances of the same name and code share a resource; their provenance is
        // given again by the documents (library, user modules) at the next snapshot
        const migrated = migrateInstances(d.instances as Array<InstanceV5 & { name: string; code: string; wrapped: boolean }>);
        resources = assignFiles(migrated.resources);
        instances = migrated.instances as InstanceV5[];
    } else {
        resources = (d.resources as any[]).map((r, k) => {
            for (const field of ["name", "file", "code"]) {
                if (typeof r?.[field] != "string") throw where(`resources[${k}].${field}`, "string expected");
            }
            if (typeof r.wrapped != "boolean") throw where(`resources[${k}].wrapped`, "boolean expected");
            let provenance: Provenance;
            try {
                provenance = parseProvenance(r.provenance, `resources[${k}].provenance`);
            } catch (e) {
                throw new DocumentFormatError(String((e as Error).message));
            }
            return { name: r.name, file: r.file, code: r.code, wrapped: r.wrapped, provenance };
        });
        const names = new Set(resources.map((r) => r.name));
        if (names.size != resources.length) throw where("resources", "names must be unique");
        for (const [k, i] of (d.instances as any[]).entries()) {
            if (!names.has(i.resource)) throw where(`instances[${k}].resource`, `unknown resource "${i.resource}"`);
        }
        instances = d.instances;
    }
    return {
        format: DOCUMENT_FORMAT, version: DOCUMENT_VERSION, name: d.name,
        faust: { libfaust: String(d.faust?.libfaust ?? ""), libraries: typeof d.faust?.libraries == "string" ? d.faust.libraries : null },
        generator: typeof d.generator == "number" ? d.generator : GENERATOR_VERSION,
        resources, instances, io: { input: point(d.io?.input, "io.input"), output: point(d.io?.output, "io.output") },
        connections: d.connections,
    };
}

// The texts of the files of resources of a document: file -> code (codes: hash -> code).
export function resourceTexts(document: DocumentV5, codes: Map<string, string>): Map<string, string> {
    const texts = new Map<string, string>();
    for (const r of document.resources) {
        const code = codes.get(r.code);
        if (code !== undefined) texts.set(r.file, code);
    }
    return texts;
}

// A document as its files of resources make it (they are its working state, which faustcode may have
// changed): a file whose code differs gives its resource that code; a file of no resource (faustcode added
// it) becomes a resource of its name, without instance and without provenance. The codes read are added to
// `codes`; `changed` tells whether the document differs.
export async function mergeResourceFiles(document: DocumentV5, files: Map<string, string>, codes: Map<string, string>): Promise<{ document: DocumentV5; changed: boolean }> {
    let changed = false;
    const resources: ResourceV5[] = [];
    for (const r of document.resources) {
        const text = files.get(r.file);
        if (text === undefined) {
            resources.push(r);
            continue;
        }
        const hash = await sha1(text);
        codes.set(hash, text);
        if (hash != r.code) changed = true;
        resources.push(hash == r.code ? r : { ...r, code: hash });
    }
    const known = new Set(document.resources.map((r) => r.file));
    for (const [file, text] of files) {
        if (known.has(file)) continue;
        const hash = await sha1(text);
        codes.set(hash, text);
        const name = uniqueName(file.replace(/\.dsp$/, ""), resources.map((r) => r.name));
        resources.push({ name, file, code: hash, wrapped: true, provenance: NO_PROVENANCE });
        changed = true;
    }
    return { document: changed ? { ...document, resources } : document, changed };
}
