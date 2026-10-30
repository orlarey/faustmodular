/*				PATCH.TS
    Pure model of a patch: modules with numbered ports, and port-to-port connections.

    No DOM and no Web Audio here: the audio graph, the view and the Faust export
    observe this model (see Documentation/multi-io/PLAN.md, section 3).

    Semantics shared by the live audio graph and the Faust export:
    - a connection carries one mono signal, with gain 1;
    - an input port receives the sum of its connections (silence if none);
    - an output port may feed several connections (one single module instance);
    - cycles are allowed; the connections returned by analyze().feedback are the
      ones that get delayed (DelayNode live, `~` in the export).

    Widget modulations (model/Modulation.ts): a Faust module with n audio inputs and k modulations
    has n + k input ports; port n + i is the input of its i-th modulation.
*/

import type { ModulationSpec } from "./Modulation";

export const MAX_CHANNELS = 32;

export type ModuleId = string;
export type ConnectionId = string;

// "input" is the physical audio input (outputs only), "output" the physical audio output (inputs only).
export type ModuleKind = "faust" | "input" | "output";

export interface PortRef {
    module: ModuleId;
    port: number;
}

export interface Connection {
    readonly id: ConnectionId;
    readonly from: PortRef;     // an output port
    readonly to: PortRef;       // an input port
}

export interface AccMapping {
    address: string;
    axis: number;
    curve: number;
    amin: number;
    amid: number;
    amax: number;
    enabled: boolean;
}

// Precompiled faustwasm factory, as saved by the "precompiled" save option.
export interface PrecompiledFactory {
    code: string;       // base64 wasm
    json: any;
    poly: boolean;
    shaKey: string;
}

// A widget of a module modulated by the signal reaching its modulation port.
export interface Modulation {
    readonly id: string;
    readonly widget: string;        // address of the widget in the module's DSP
    readonly spec: ModulationSpec;
}

export interface ModuleState {
    id: ModuleId;
    kind: ModuleKind;
    name: string;
    code: string;
    x: number;
    y: number;
    numInputs: number;              // audio inputs (the modulation inputs come after them)
    numOutputs: number;
    params: Record<string, number>;
    acc: AccMapping[];
    modulations: Modulation[];
    factory?: PrecompiledFactory;
}

// Number of input ports: audio inputs, then modulation inputs.
export function totalInputs(module: ModuleState): number {
    return module.numInputs + module.modulations.length;
}

export interface ModuleInit {
    id?: ModuleId;
    kind?: ModuleKind;
    name: string;
    code?: string;
    x?: number;
    y?: number;
    numInputs: number;
    numOutputs: number;
    params?: Record<string, number>;
    acc?: AccMapping[];
    modulations?: Array<{ widget: string; spec: ModulationSpec }>;
    factory?: PrecompiledFactory;
}

export type ModuleChanges = Partial<Pick<ModuleState, "name" | "code" | "x" | "y" | "params" | "acc" | "factory">>;

export type PatchEvent =
    | { type: "moduleAdded"; module: ModuleState }
    | { type: "moduleUpdated"; module: ModuleState }
    | { type: "moduleRemoved"; module: ModuleState }
    | { type: "arityChanged"; module: ModuleState }
    | { type: "modulationsChanged"; module: ModuleState }
    | { type: "connectionAdded"; connection: Connection }
    | { type: "connectionRemoved"; connection: Connection };

export type PatchListener = (event: PatchEvent) => void;

export class PatchError extends Error { }

export interface PatchAnalysis {
    feedback: Set<ConnectionId>;    // connections closing a cycle (DFS back edges)
    order: ModuleId[];              // topological order of the graph without the feedback connections
}

// Bus connection rule ("cyclic rule") between n outputs and m inputs:
// output (k mod n) -> input (k mod m), for k = 0 .. max(n, m) - 1.
// It equals Faust's split `<:` when m is a multiple of n, and merge `:>` when n is a multiple of m.
export function busPairs(n: number, m: number): Array<[number, number]> {
    const pairs: Array<[number, number]> = [];
    if (n > 0 && m > 0) {
        for (let k = 0; k < Math.max(n, m); k++) {
            pairs.push([k % n, k % m]);
        }
    }
    return pairs;
}

function checkArity(value: number, what: string): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_CHANNELS) {
        throw new PatchError(`${what} must be an integer between 0 and ${MAX_CHANNELS} (got ${value})`);
    }
}

export class Patch {
    private fModules = new Map<ModuleId, ModuleState>();
    private fConnections = new Map<ConnectionId, Connection>();
    private fListeners = new Set<PatchListener>();
    private fNextModuleId = 1;
    private fNextConnectionId = 1;
    private fNextModulationId = 1;

    /******************** OBSERVERS ********************/

    subscribe(listener: PatchListener): () => void {
        this.fListeners.add(listener);
        return () => { this.fListeners.delete(listener); };
    }

    private emit(event: PatchEvent): void {
        this.fListeners.forEach((listener) => listener(event));
    }

    /******************** QUERIES ********************/

    // Modules and connections are returned in insertion order.
    getModules(): ModuleState[] { return Array.from(this.fModules.values()); }
    getConnections(): Connection[] { return Array.from(this.fConnections.values()); }
    getModule(id: ModuleId): ModuleState | undefined { return this.fModules.get(id); }
    getConnection(id: ConnectionId): Connection | undefined { return this.fConnections.get(id); }

    getInputModule(): ModuleState | undefined { return this.getModules().find((m) => m.kind == "input"); }
    getOutputModule(): ModuleState | undefined { return this.getModules().find((m) => m.kind == "output"); }

    connectionsFrom(id: ModuleId): Connection[] { return this.getConnections().filter((c) => c.from.module == id); }
    connectionsTo(id: ModuleId): Connection[] { return this.getConnections().filter((c) => c.to.module == id); }

    findConnection(from: PortRef, to: PortRef): Connection | undefined {
        return this.getConnections().find((c) =>
            c.from.module == from.module && c.from.port == from.port && c.to.module == to.module && c.to.port == to.port);
    }

    /******************** MODULES ********************/

    addModule(init: ModuleInit): ModuleState {
        const kind = init.kind ?? "faust";
        const id = init.id ?? this.newModuleId();
        if (this.fModules.has(id)) {
            throw new PatchError(`module ${id} already exists`);
        }
        this.checkKindArity(kind, init.numInputs + (init.modulations?.length ?? 0), init.numOutputs);
        if (kind != "faust" && (init.modulations?.length ?? 0) > 0) {
            throw new PatchError("only Faust modules have modulations");
        }
        if (kind != "faust" && this.getModules().some((m) => m.kind == kind)) {
            throw new PatchError(`the patch already has an ${kind} module`);
        }
        const module: ModuleState = {
            id,
            kind,
            name: init.name,
            code: init.code ?? "",
            x: init.x ?? 0,
            y: init.y ?? 0,
            numInputs: init.numInputs,
            numOutputs: init.numOutputs,
            params: { ...(init.params ?? {}) },
            acc: [...(init.acc ?? [])],
            modulations: (init.modulations ?? []).map((m) => ({ id: "mod" + this.fNextModulationId++, widget: m.widget, spec: m.spec })),
        };
        if (init.factory) {
            module.factory = init.factory;
        }
        this.fModules.set(id, module);
        const numeric = Number(id);
        if (Number.isInteger(numeric) && numeric >= this.fNextModuleId) {
            this.fNextModuleId = numeric + 1;
        }
        this.emit({ type: "moduleAdded", module });
        return module;
    }

    updateModule(id: ModuleId, changes: ModuleChanges): ModuleState {
        const module = this.requireModule(id);
        Object.assign(module, changes);
        this.emit({ type: "moduleUpdated", module });
        return module;
    }

    // Removes the module and all its connections (emitted first, one by one).
    removeModule(id: ModuleId): Connection[] {
        const module = this.requireModule(id);
        const removed = this.getConnections().filter((c) => c.from.module == id || c.to.module == id);
        removed.forEach((c) => this.disconnect(c.id));
        this.fModules.delete(id);
        this.emit({ type: "moduleRemoved", module });
        return removed;
    }

    // Changes the number of audio ports (e.g. after recompilation); drops the connections whose
    // ports no longer exist and returns them. The modulation ports, after the audio inputs, move
    // with them (their connections are made again on their new ports).
    setArity(id: ModuleId, numInputs: number, numOutputs: number): Connection[] {
        const module = this.requireModule(id);
        this.checkKindArity(module.kind, numInputs + module.modulations.length, numOutputs);
        const old = module.numInputs;
        const toModulation = (c: Connection) => c.to.module == id && c.to.port >= old;
        const removed = this.getConnections().filter((c) =>
            (c.from.module == id && c.from.port >= numOutputs) || (c.to.module == id && !toModulation(c) && c.to.port >= numInputs));
        removed.forEach((c) => this.disconnect(c.id));
        const moved = numInputs == old ? [] : this.getConnections().filter(toModulation);
        moved.forEach((c) => this.disconnect(c.id));
        module.numInputs = numInputs;
        module.numOutputs = numOutputs;
        this.emit({ type: "arityChanged", module });
        moved.forEach((c) => this.connect(c.from, { module: id, port: c.to.port - old + numInputs }));
        return removed;
    }

    /******************** MODULATIONS ********************/

    // Adds a modulation of a widget (one per widget); its port is the last input port of the module.
    addModulation(id: ModuleId, widget: string, spec: ModulationSpec): Modulation {
        const module = this.requireModule(id);
        if (module.kind != "faust") {
            throw new PatchError("only Faust modules have modulations");
        }
        if (module.modulations.some((m) => m.widget == widget)) {
            throw new PatchError(`the widget ${widget} of module ${id} is already modulated`);
        }
        this.checkKindArity(module.kind, totalInputs(module) + 1, module.numOutputs);
        const modulation: Modulation = { id: "mod" + this.fNextModulationId++, widget, spec };
        module.modulations.push(modulation);
        this.emit({ type: "modulationsChanged", module });
        return modulation;
    }

    // Removes a modulation and the connections to its port; the following modulation ports move
    // down by one. Returns the connections that went to the removed modulation.
    removeModulation(id: ModuleId, modulationId: string): Connection[] {
        const module = this.requireModule(id);
        const index = module.modulations.findIndex((m) => m.id == modulationId);
        if (index < 0) {
            throw new PatchError(`module ${id} has no modulation ${modulationId}`);
        }
        const port = module.numInputs + index;
        const removed = this.connectionsTo(id).filter((c) => c.to.port == port);
        const moved = this.connectionsTo(id).filter((c) => c.to.port > port);
        removed.concat(moved).forEach((c) => this.disconnect(c.id));
        module.modulations.splice(index, 1);
        this.emit({ type: "modulationsChanged", module });
        moved.forEach((c) => this.connect(c.from, { module: id, port: c.to.port - 1 }));
        return removed;
    }

    // Changes the Faust target and range of a modulation (its widget moved in an edited code).
    setModulationSpec(id: ModuleId, modulationId: string, spec: ModulationSpec): Modulation {
        const module = this.requireModule(id);
        const index = module.modulations.findIndex((m) => m.id == modulationId);
        if (index < 0) {
            throw new PatchError(`module ${id} has no modulation ${modulationId}`);
        }
        const modulation: Modulation = { id: modulationId, widget: module.modulations[index].widget, spec };
        module.modulations[index] = modulation;
        this.emit({ type: "modulationsChanged", module });
        return modulation;
    }

    // Modulation whose input is the given port of a module, if any.
    modulationAt(id: ModuleId, port: number): Modulation | undefined {
        const module = this.requireModule(id);
        return port >= module.numInputs ? module.modulations[port - module.numInputs] : undefined;
    }

    modulationPort(id: ModuleId, modulationId: string): number {
        const module = this.requireModule(id);
        const index = module.modulations.findIndex((m) => m.id == modulationId);
        if (index < 0) {
            throw new PatchError(`module ${id} has no modulation ${modulationId}`);
        }
        return module.numInputs + index;
    }

    /******************** CONNECTIONS ********************/

    connect(from: PortRef, to: PortRef): Connection {
        const source = this.requireModule(from.module);
        const destination = this.requireModule(to.module);
        if (!Number.isInteger(from.port) || from.port < 0 || from.port >= source.numOutputs) {
            throw new PatchError(`module ${source.id} has no output ${from.port} (it has ${source.numOutputs})`);
        }
        if (!Number.isInteger(to.port) || to.port < 0 || to.port >= totalInputs(destination)) {
            throw new PatchError(`module ${destination.id} has no input ${to.port} (it has ${totalInputs(destination)})`);
        }
        if (this.findConnection(from, to)) {
            throw new PatchError(`${from.module}:${from.port} is already connected to ${to.module}:${to.port}`);
        }
        const connection: Connection = {
            id: "c" + this.fNextConnectionId++,
            from: { module: from.module, port: from.port },
            to: { module: to.module, port: to.port },
        };
        this.fConnections.set(connection.id, connection);
        this.emit({ type: "connectionAdded", connection });
        return connection;
    }

    disconnect(id: ConnectionId): Connection {
        const connection = this.fConnections.get(id);
        if (!connection) {
            throw new PatchError(`connection ${id} does not exist`);
        }
        this.fConnections.delete(id);
        this.emit({ type: "connectionRemoved", connection });
        return connection;
    }

    // Connects all the outputs of `fromId` to all the inputs of `toId` with the bus rule;
    // pairs that are already connected are skipped. Returns the new connections.
    connectBus(fromId: ModuleId, toId: ModuleId): Connection[] {
        const source = this.requireModule(fromId);
        const destination = this.requireModule(toId);
        const created: Connection[] = [];
        for (const [i, j] of busPairs(source.numOutputs, destination.numInputs)) {
            const from = { module: fromId, port: i };
            const to = { module: toId, port: j };
            if (!this.findConnection(from, to)) {
                created.push(this.connect(from, to));
            }
        }
        return created;
    }

    /******************** GRAPH ANALYSIS ********************/

    // Depth-first search, deterministic: roots are the modules without incoming
    // connections (insertion order), then the remaining ones (insertion order);
    // outgoing connections are explored by destination insertion order, then port numbers.
    // A connection to a module on the DFS stack (self-loops included) is a feedback connection.
    // Reverse postorder is a topological order of the graph without the feedback connections.
    analyze(): PatchAnalysis {
        const modules = this.getModules();
        const rank = new Map<ModuleId, number>();
        modules.forEach((m, i) => rank.set(m.id, i));

        const outgoing = new Map<ModuleId, Connection[]>();
        const hasIncoming = new Set<ModuleId>();
        modules.forEach((m) => outgoing.set(m.id, []));
        for (const c of this.fConnections.values()) {
            outgoing.get(c.from.module)!.push(c);
            hasIncoming.add(c.to.module);
        }
        outgoing.forEach((list) => list.sort((a, b) =>
            rank.get(a.to.module)! - rank.get(b.to.module)! || a.from.port - b.from.port || a.to.port - b.to.port));

        const state = new Map<ModuleId, "active" | "done">();
        const feedback = new Set<ConnectionId>();
        const postorder: ModuleId[] = [];

        const visit = (id: ModuleId) => {
            state.set(id, "active");
            for (const c of outgoing.get(id)!) {
                const s = state.get(c.to.module);
                if (s == "active") {
                    feedback.add(c.id);
                } else if (s == undefined) {
                    visit(c.to.module);
                }
            }
            state.set(id, "done");
            postorder.push(id);
        };

        const roots = modules.filter((m) => !hasIncoming.has(m.id)).concat(modules.filter((m) => hasIncoming.has(m.id)));
        roots.forEach((m) => { if (!state.has(m.id)) visit(m.id); });

        return { feedback, order: postorder.reverse() };
    }

    /******************** PRIVATE ********************/

    private requireModule(id: ModuleId): ModuleState {
        const module = this.fModules.get(id);
        if (!module) {
            throw new PatchError(`module ${id} does not exist`);
        }
        return module;
    }

    private newModuleId(): ModuleId {
        while (this.fModules.has(String(this.fNextModuleId))) {
            this.fNextModuleId++;
        }
        return String(this.fNextModuleId++);
    }

    private checkKindArity(kind: ModuleKind, numInputs: number, numOutputs: number): void {
        checkArity(numInputs, "number of inputs");
        checkArity(numOutputs, "number of outputs");
        if (kind == "input" && numInputs != 0) {
            throw new PatchError("the input module has outputs only");
        }
        if (kind == "output" && numOutputs != 0) {
            throw new PatchError("the output module has inputs only");
        }
    }
}
