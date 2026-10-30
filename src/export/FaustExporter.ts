/*				FAUSTEXPORTER.TS
    Faust code equivalent to a patch (see Documentation/multi-io/PLAN.md, section 4, phase 4).

    Same semantics as the live audio graph (model/Patch.ts): one mono signal per connection,
    inputs sum their connections, an output feeds any number of connections from a single
    instance of its module, and the connections closing a cycle (Patch.analyze().feedback)
    are delayed, here by one sample (`~`) instead of one render quantum live.

    The patch is compiled into a growing bus of signals:

        bus = [ feedback signals (F) | physical inputs | outputs of the modules computed so far ]

    Each module, in topological order, is computed from the bus and appends its outputs:

        stage_k = si.bus(w) <: si.bus(w), (route(w, in_k, pairs) : M_k)

    `route` picks (and sums) the signals of the bus feeding each input; unconnected inputs get 0.
    A last `route` produces [ F | physical outputs ], and `~` feeds F back into the bus:

        process = (stage_1 : ... : stage_n : route(...)) ~ si.bus(F) : (si.block(F), si.bus(outputs))

    Only the modules that reach the physical output are exported (the others are silent live).
    Every module keeps its own controls: modules with the same name get distinct group labels.
*/

import { busPairs, ConnectionId, ModuleId, ModuleState, Patch } from "../model/Patch";

export interface ExportOptions {
    name: string;
    // Stereo application: the used physical inputs are fed from 2 inputs and the physical
    // outputs are mixed down to 2 outputs, with the bus connection rule (busPairs).
    forceStereo?: boolean;
}

export interface ExportResult {
    code: string;
    inputs: number;
    outputs: number;
}

// Faust string literal.
function quote(text: string): string {
    return JSON.stringify(text);
}

function routePairs(pairs: Array<[number, number]>): string {
    return pairs.map(([a, b]) => `,(${a},${b})`).join("");
}

// route(n, m, pairs) adapted to the n = 0 case, where all the outputs are silent.
function route(n: number, m: number, pairs: Array<[number, number]>): string {
    if (n == 0) {
        return m == 0 ? "si.bus(0)" : `(0 <: si.bus(${m}))`;
    }
    return `route(${n},${m}${routePairs(pairs)})`;
}

export function exportFaust(patch: Patch, options: ExportOptions): ExportResult {
    const input = patch.getInputModule();
    const output = patch.getOutputModule();
    const { feedback, order } = patch.analyze();
    const connections = patch.getConnections();

    const reaching = reachingOutput(patch);
    const used = connections.filter((c) => reaching.has(c.from.module) && reaching.has(c.to.module));
    const modules = order.map((id) => patch.getModule(id)!).filter((m) => m.kind == "faust" && reaching.has(m.id));

    // Physical channels: the inputs actually used (numbering kept), all the outputs.
    const numInputs = input ? Math.max(0, ...used.filter((c) => c.from.module == input.id).map((c) => c.from.port + 1)) : 0;
    const numOutputs = output ? output.numInputs : 0;

    // Positions (1-based) of the signals in the bus.
    const position = new Map<string, number>();
    const key = (module: ModuleId, port: number) => `${module}:${port}`;
    let width = 0;
    const feedbackSources: string[] = [];
    for (const c of used) {
        if (feedback.has(c.id) && !position.has("fb " + key(c.from.module, c.from.port))) {
            position.set("fb " + key(c.from.module, c.from.port), ++width);
            feedbackSources.push(key(c.from.module, c.from.port));
        }
    }
    const numFeedback = width;
    for (let i = 0; i < numInputs; i++) {
        position.set(key(input!.id, i), ++width);
    }
    const sourcePosition = (c: { id: ConnectionId; from: { module: ModuleId; port: number } }) =>
        position.get((feedback.has(c.id) ? "fb " : "") + key(c.from.module, c.from.port))!;

    // Module definitions, with distinct group labels for modules of the same name.
    const names = new Map<string, number>();
    modules.forEach((m) => names.set(m.name, (names.get(m.name) ?? 0) + 1));
    const seen = new Map<string, number>();
    const definitions: string[] = [];
    const identifier = new Map<ModuleId, string>();
    modules.forEach((m, k) => {
        const id = `fp_module${k + 1}`;
        identifier.set(m.id, id);
        let body = `environment{\n${m.code}\n}.process`;
        if ((names.get(m.name) ?? 0) > 1) {
            const n = (seen.get(m.name) ?? 0) + 1;
            seen.set(m.name, n);
            body = `vgroup(${quote(`${m.name} ${n}`)}, ${body})`;
        }
        definitions.push(`// module ${m.id}: ${m.name} (${m.numInputs} in, ${m.numOutputs} out)\n${id} = ${body};`);
    });

    // Stages.
    const stages: string[] = [];
    for (const m of modules) {
        const pairs: Array<[number, number]> = used.filter((c) => c.to.module == m.id).map((c) => [sourcePosition(c), c.to.port + 1]);
        const module = identifier.get(m.id)!;
        if (width == 0) {
            stages.push(m.numInputs == 0 ? module : `${route(0, m.numInputs, [])} : ${module}`);
        } else if (m.numInputs == 0) {
            stages.push(`(si.bus(${width}), ${module})`);
        } else {
            stages.push(`(si.bus(${width}) <: si.bus(${width}), (${route(width, m.numInputs, pairs)} : ${module}))`);
        }
        for (let i = 0; i < m.numOutputs; i++) {
            position.set(key(m.id, i), ++width);
        }
    }

    // Final routing: [feedback sources | physical outputs].
    const finalPairs: Array<[number, number]> = feedbackSources.map((source, i) => [position.get(source)!, i + 1]);
    if (output) {
        used.filter((c) => c.to.module == output.id).forEach((c) => finalPairs.push([sourcePosition(c), numFeedback + c.to.port + 1]));
    }
    stages.push(route(width, numFeedback + numOutputs, finalPairs));

    let body = stages.join("\n    : ");
    if (numFeedback > 0) {
        body = `(${body})\n    ~ si.bus(${numFeedback}) : (si.block(${numFeedback}), si.bus(${numOutputs}))`;
    }

    // Optional stereo adaptation of the physical channels.
    let inputs = numInputs;
    let outputs = numOutputs;
    if (options.forceStereo) {
        if (numInputs > 0) {
            body = `${route(2, numInputs, busPairs(2, numInputs).map(([a, b]) => [a + 1, b + 1]))}\n    : ${body}`;
            inputs = 2;
        }
        body = `(${body})\n    : ${route(numOutputs, 2, busPairs(numOutputs, 2).map(([a, b]) => [a + 1, b + 1]))}`;
        outputs = 2;
    }

    const header = `// Faust code generated by FaustPlayground from the patch ${quote(options.name)}:\n`
        + `// ${modules.length} module(s), ${used.length} connection(s), ${numFeedback} feedback signal(s) delayed by one sample.\n`;
    const code = header
        + `import("stdfaust.lib");\n\n`
        + definitions.join("\n\n") + (definitions.length ? "\n\n" : "")
        + `process = vgroup(${quote(options.name)},\n    ${body}\n);\n`;
    return { code, inputs, outputs };
}

// Modules from which the physical output can be reached (through any connection, feedback included).
function reachingOutput(patch: Patch): Set<ModuleId> {
    const output = patch.getOutputModule();
    const reaching = new Set<ModuleId>(output ? [output.id] : []);
    for (let changed = true; changed;) {
        changed = false;
        for (const c of patch.getConnections()) {
            if (reaching.has(c.to.module) && !reaching.has(c.from.module)) {
                reaching.add(c.from.module);
                changed = true;
            }
        }
    }
    return reaching;
}

// Faust modules left out by the export because they do not reach the output (silent live too).
export function unexportedModules(patch: Patch): ModuleState[] {
    const reaching = reachingOutput(patch);
    return patch.getModules().filter((m) => m.kind == "faust" && !reaching.has(m.id));
}
