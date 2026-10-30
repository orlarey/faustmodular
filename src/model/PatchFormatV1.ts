/*				PATCHFORMATV1.TS
    Reading of version 1 patch files (FaustPlayground 1.x) and migration to the model.

    A v1 file is an object { patchId: module } where each module lists the patchIds
    of its sources (inputs.source) and destinations (outputs.destination); "input" and
    "output" denote the physical audio input and output, which are not saved as modules.
    Connections are module to module, without channel numbers, and the number of
    channels of each module is not saved: it is only known once the module is compiled.

    Migration therefore takes two steps:
    1. readV1 parses the file into a draft (modules + module-level links);
    2. migrateV1 builds the patch once the arity of every module is known, each v1 link
       becoming a bus connection (cyclic rule, see busPairs in Patch.ts).
    Compared with the 1.x live behaviour (Web Audio "speakers" mixing), the cyclic rule is
    identical for 1->1, 1->2 and 2->2, and sums instead of averaging for 2->1 (+6 dB).

    The reader is lenient: v1 files exist in several variants (numbers saved as strings,
    missing sceneName/acc, obsolete asm.js factories); problems become warnings.
*/

import { AccMapping, ModuleId, Patch, PrecompiledFactory } from "./Patch";
import { parseFactory } from "./PatchFormat";

export const V1_INPUT_ID = "input";
export const V1_OUTPUT_ID = "output";

export interface V1DraftModule {
    id: ModuleId;
    name: string;
    code: string;
    x: number;
    y: number;
    params: Record<string, number>;
    acc: AccMapping[];
    factory?: PrecompiledFactory;
}

export interface V1Draft {
    sceneName: string;
    modules: V1DraftModule[];                           // Faust modules, in file order
    links: Array<{ from: ModuleId; to: ModuleId }>;     // deduplicated, may use V1_INPUT_ID / V1_OUTPUT_ID
    warnings: string[];
}

export interface Arity {
    numInputs: number;
    numOutputs: number;
}

// A v1 file is a JSON object whose values are modules carrying a patchId ({} is an empty v1 patch).
export function isPatchFileV1(data: unknown): boolean {
    return isObject(data) && Object.values(data).every((m) => isObject(m) && "patchId" in m);
}

export function readV1(data: unknown): V1Draft {
    if (!isPatchFileV1(data)) {
        throw new Error("not a version 1 patch file");
    }
    const draft: V1Draft = { sceneName: "", modules: [], links: [], warnings: [] };
    const seen = new Set<string>();
    const addLink = (from: ModuleId, to: ModuleId) => {
        const key = JSON.stringify([from, to]);
        if (!seen.has(key)) {
            seen.add(key);
            draft.links.push({ from, to });
        }
    };

    for (const value of Object.values(data as Record<string, any>)) {
        const id = String(value.patchId);
        if (id == V1_INPUT_ID || id == V1_OUTPUT_ID) {
            continue;
        }
        if (!draft.sceneName && typeof value.sceneName == "string") {
            draft.sceneName = value.sceneName;
        }
        const module: V1DraftModule = {
            id,
            name: String(value.name ?? ""),
            code: String(value.code ?? ""),
            x: toNumber(value.x, 0),
            y: toNumber(value.y, 0),
            params: {},
            acc: [],
        };
        for (const slider of value.params?.sliders ?? []) {
            const v = toNumber(slider?.value, NaN);
            if (typeof slider?.path == "string" && Number.isFinite(v)) {
                module.params[slider.path] = v;
            } else {
                draft.warnings.push(`module ${id}: invalid parameter ${JSON.stringify(slider)} ignored`);
            }
        }
        for (const c of value.acc?.controles ?? []) {
            module.acc.push({
                address: String(c.adress),
                axis: toNumber(c.axis, 0),
                curve: toNumber(c.curve, 0),
                amin: toNumber(c.amin, 0),
                amid: toNumber(c.amid, 0),
                amax: toNumber(c.amax, 0),
                enabled: c.isEnabled !== false,
            });
        }
        if (value.factory !== undefined) {
            try {
                module.factory = parseFactory(value.factory, "factory");
            } catch (e) {
                draft.warnings.push(`module ${id}: obsolete or invalid precompiled factory ignored, the module will be recompiled`);
            }
        }
        draft.modules.push(module);
        for (const source of value.inputs?.source ?? []) addLink(String(source), id);
        for (const destination of value.outputs?.destination ?? []) addLink(id, String(destination));
    }
    return draft;
}

// Arity of a draft module known without compiling it (precompiled factory), if any.
export function precompiledArity(module: V1DraftModule): Arity | undefined {
    const json = module.factory?.json;
    if (json && Number.isInteger(json.inputs) && Number.isInteger(json.outputs)) {
        return { numInputs: json.inputs, numOutputs: json.outputs };
    }
    return undefined;
}

// Builds the patch from a draft. `arityOf` gives the arity of each Faust module (undefined if
// it could not be compiled: the module and its links are then dropped). `io` gives the number of
// channels of the physical input and output modules, which are always created.
export function migrateV1(draft: V1Draft, arityOf: (module: V1DraftModule) => Arity | undefined,
    io: { inputs: number; outputs: number } = { inputs: 2, outputs: 2 }): { patch: Patch; sceneName: string; warnings: string[] } {

    const warnings = [...draft.warnings];
    const patch = new Patch();
    patch.addModule({ id: V1_INPUT_ID, kind: "input", name: "input", numInputs: 0, numOutputs: io.inputs });
    patch.addModule({ id: V1_OUTPUT_ID, kind: "output", name: "output", numInputs: io.outputs, numOutputs: 0 });

    for (const m of draft.modules) {
        const arity = arityOf(m);
        if (!arity) {
            warnings.push(`module ${m.id} (${m.name}): unknown number of inputs/outputs, module dropped`);
            continue;
        }
        try {
            patch.addModule({
                id: m.id, kind: "faust", name: m.name, code: m.code, x: m.x, y: m.y,
                numInputs: arity.numInputs, numOutputs: arity.numOutputs,
                params: m.params, acc: m.acc, factory: m.factory,
            });
        } catch (e) {
            warnings.push(`module ${m.id} (${m.name}): ${(e as Error).message}, module dropped`);
        }
    }

    warnings.push(...connectV1Links(patch, draft.links, (id) => id));
    return { patch, sceneName: draft.sceneName, warnings };
}

// Turns v1 links into bus connections of `patch`; `mapId` translates the module ids of the
// file into ids of the patch (undefined if the module is absent). Returns the warnings.
export function connectV1Links(patch: Patch, links: V1Draft["links"], mapId: (id: ModuleId) => ModuleId | undefined): string[] {
    const warnings: string[] = [];
    for (const link of links) {
        const from = mapId(link.from);
        const to = mapId(link.to);
        if (from === undefined || to === undefined || !patch.getModule(from) || !patch.getModule(to)) {
            warnings.push(`link ${link.from} -> ${link.to}: unknown module, link dropped`);
        } else if (patch.connectBus(from, to).length == 0 && patch.connectionsFrom(from).every((c) => c.to.module != to)) {
            warnings.push(`link ${link.from} -> ${link.to}: no compatible ports, link dropped`);
        }
    }
    return warnings;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value == "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
    const n = typeof value == "number" ? value : typeof value == "string" && value.trim() != "" ? Number(value) : NaN;
    return Number.isFinite(n) ? n : fallback;
}
