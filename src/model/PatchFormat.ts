/*				PATCHFORMAT.TS
    Patch files, version 2: serialization and validated parsing.

    {
      "format": "faustplayground-patch", "version": 2, "sceneName": "...",
      "modules": [ { "id", "kind", "name", "code", "x", "y", "inputs", "outputs",
                     "params": { path: value }, "acc": [...], "factory"? } ],
      "connections": [ { "from": { "module", "port" }, "to": { "module", "port" } } ]
    }

    Ports are numbered from 0. Connection ids are not saved.
    Version 1 files are read by PatchFormatV1.ts.
*/

import { AccMapping, ModuleKind, Patch, PatchError, PortRef, PrecompiledFactory } from "./Patch";

export const PATCH_FORMAT = "faustplayground-patch";
export const PATCH_VERSION = 2;

export interface ModuleFileV2 {
    id: string;
    kind: ModuleKind;
    name: string;
    code: string;
    x: number;
    y: number;
    inputs: number;
    outputs: number;
    params: Record<string, number>;
    acc: AccMapping[];
    factory?: PrecompiledFactory;
}

export interface ConnectionFileV2 {
    from: PortRef;
    to: PortRef;
}

export interface PatchFileV2 {
    format: typeof PATCH_FORMAT;
    version: 2;
    sceneName: string;
    modules: ModuleFileV2[];
    connections: ConnectionFileV2[];
}

export class PatchFormatError extends Error { }

// Base64 encoding of the wasm code of a factory. By chunks: converting a large module in one
// String.fromCharCode call (as faustwasm's ab2str does) exceeds the call stack.
export function encodeFactoryCode(code: Uint8Array | ArrayBuffer): string {
    const bytes = code instanceof Uint8Array ? code : new Uint8Array(code);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

// `precompiled`: also save the precompiled factories, when the modules have one.
export function serializePatch(patch: Patch, sceneName: string, precompiled: boolean = false): PatchFileV2 {
    return {
        format: PATCH_FORMAT,
        version: PATCH_VERSION,
        sceneName,
        modules: patch.getModules().map((m) => {
            const module: ModuleFileV2 = {
                id: m.id,
                kind: m.kind,
                name: m.name,
                code: m.code,
                x: m.x,
                y: m.y,
                inputs: m.numInputs,
                outputs: m.numOutputs,
                params: { ...m.params },
                acc: m.acc.map((a) => ({ ...a })),
            };
            if (precompiled && m.factory) {
                module.factory = m.factory;
            }
            return module;
        }),
        connections: patch.getConnections().map((c) => ({
            from: { module: c.from.module, port: c.from.port },
            to: { module: c.to.module, port: c.to.port },
        })),
    };
}

export function isPatchFileV2(data: unknown): boolean {
    return isObject(data) && data.format == PATCH_FORMAT;
}

// Builds the patch described by a version 2 file; throws PatchFormatError with the
// location of the first problem found.
export function parsePatchV2(data: unknown): { patch: Patch; sceneName: string } {
    if (!isObject(data) || data.format != PATCH_FORMAT) {
        throw new PatchFormatError("not a FaustPlayground patch file");
    }
    if (data.version != PATCH_VERSION) {
        throw new PatchFormatError(`unsupported patch version ${String(data.version)}`);
    }
    const sceneName = expectString(data.sceneName, "sceneName");
    const modules = expectArray(data.modules, "modules");
    const connections = expectArray(data.connections, "connections");

    const patch = new Patch();
    modules.forEach((value, i) => {
        const where = `modules[${i}]`;
        const m = expectObject(value, where);
        const kind = expectString(m.kind, `${where}.kind`);
        if (kind != "faust" && kind != "input" && kind != "output") {
            throw new PatchFormatError(`${where}.kind: unknown module kind "${kind}"`);
        }
        wrap(where, () => patch.addModule({
            id: expectString(m.id, `${where}.id`),
            kind,
            name: expectString(m.name, `${where}.name`),
            code: expectString(m.code, `${where}.code`),
            x: expectNumber(m.x, `${where}.x`),
            y: expectNumber(m.y, `${where}.y`),
            numInputs: expectNumber(m.inputs, `${where}.inputs`),
            numOutputs: expectNumber(m.outputs, `${where}.outputs`),
            params: parseParams(m.params, `${where}.params`),
            acc: expectArray(m.acc, `${where}.acc`).map((a, j) => parseAcc(a, `${where}.acc[${j}]`)),
            factory: m.factory === undefined ? undefined : parseFactory(m.factory, `${where}.factory`),
        }));
    });
    connections.forEach((value, i) => {
        const where = `connections[${i}]`;
        const c = expectObject(value, where);
        const from = parsePortRef(c.from, `${where}.from`);
        const to = parsePortRef(c.to, `${where}.to`);
        wrap(where, () => patch.connect(from, to));
    });
    return { patch, sceneName };
}

/******************** VALIDATION HELPERS ********************/

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value == "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, where: string): Json {
    if (!isObject(value)) throw new PatchFormatError(`${where}: object expected`);
    return value;
}

function expectArray(value: unknown, where: string): unknown[] {
    if (!Array.isArray(value)) throw new PatchFormatError(`${where}: array expected`);
    return value;
}

function expectString(value: unknown, where: string): string {
    if (typeof value != "string") throw new PatchFormatError(`${where}: string expected`);
    return value;
}

function expectNumber(value: unknown, where: string): number {
    if (typeof value != "number" || !Number.isFinite(value)) throw new PatchFormatError(`${where}: number expected`);
    return value;
}

function expectBoolean(value: unknown, where: string): boolean {
    if (typeof value != "boolean") throw new PatchFormatError(`${where}: boolean expected`);
    return value;
}

function wrap<T>(where: string, action: () => T): T {
    try {
        return action();
    } catch (e) {
        if (e instanceof PatchError) throw new PatchFormatError(`${where}: ${e.message}`);
        throw e;
    }
}

function parsePortRef(value: unknown, where: string): PortRef {
    const p = expectObject(value, where);
    return { module: expectString(p.module, `${where}.module`), port: expectNumber(p.port, `${where}.port`) };
}

function parseParams(value: unknown, where: string): Record<string, number> {
    const params: Record<string, number> = {};
    for (const [path, v] of Object.entries(expectObject(value, where))) {
        params[path] = expectNumber(v, `${where}["${path}"]`);
    }
    return params;
}

function parseAcc(value: unknown, where: string): AccMapping {
    const a = expectObject(value, where);
    return {
        address: expectString(a.address, `${where}.address`),
        axis: expectNumber(a.axis, `${where}.axis`),
        curve: expectNumber(a.curve, `${where}.curve`),
        amin: expectNumber(a.amin, `${where}.amin`),
        amid: expectNumber(a.amid, `${where}.amid`),
        amax: expectNumber(a.amax, `${where}.amax`),
        enabled: expectBoolean(a.enabled, `${where}.enabled`),
    };
}

export function parseFactory(value: unknown, where: string): PrecompiledFactory {
    const f = expectObject(value, where);
    return {
        code: expectString(f.code, `${where}.code`),
        json: expectObject(f.json, `${where}.json`),
        poly: expectBoolean(f.poly, `${where}.poly`),
        shaKey: expectString(f.shaKey, `${where}.shaKey`),
    };
}
