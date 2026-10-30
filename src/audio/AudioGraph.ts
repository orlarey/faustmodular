/*				AUDIOGRAPH.TS
    Web Audio rendering of a Patch (see Documentation/multi-io/PLAN.md, section 2.4).

    Each module gets a processing node (Faust DSP, microphone source or destination)
    framed by two native nodes:

        ChannelMergerNode(numInputs) --> node --> ChannelSplitterNode(numOutputs)

    so that a connection from output i of A to input j of B is the single mono link
    splitterA[i] -> mergerB[j]. Several links reaching the same merger input are summed
    by Web Audio. Feedback connections (Patch.analyze) go through a DelayNode, without
    which Web Audio would cut the cycle; its delay is one render quantum (128 samples).

    The graph is kept in sync by reconciliation: after any change, every connection of
    the patch whose two ends have a node is wired, with or without delay as required,
    and every other wire is removed.
*/

import { Connection, ConnectionId, ModuleId, Patch, PatchEvent, totalInputs } from "../model/Patch";

interface ModulePorts {
    node: AudioNode;
    numInputs: number;
    numOutputs: number;
    merger?: ChannelMergerNode;       // feeds the inputs of `node`
    splitter?: ChannelSplitterNode;   // fed by the outputs of `node`
}

interface Wire {
    splitter: ChannelSplitterNode;
    output: number;
    merger: ChannelMergerNode;
    input: number;
    delay?: DelayNode;
}

export class AudioGraph {
    private fPorts = new Map<ModuleId, ModulePorts>();
    private fWires = new Map<ConnectionId, Wire>();
    private fUnsubscribe: () => void;

    constructor(private fContext: BaseAudioContext, private fPatch: Patch) {
        this.fUnsubscribe = fPatch.subscribe((event) => this.onPatchEvent(event));
    }

    // Sets (or replaces, or with null removes) the processing node of a module.
    // Its ports are sized from the module arity in the patch.
    setNode(id: ModuleId, node: AudioNode | null): void {
        this.releasePorts(id);
        if (node) {
            const module = this.fPatch.getModule(id);
            if (!module) {
                throw new Error(`AudioGraph: module ${id} is not in the patch`);
            }
            this.fPorts.set(id, this.buildPorts(node, totalInputs(module), module.numOutputs));
        }
        this.reconcile();
    }

    getNode(id: ModuleId): AudioNode | undefined {
        return this.fPorts.get(id)?.node;
    }

    // Number of connections currently wired, and how many of them through a delay.
    getWireCount(): { wires: number; delayed: number } {
        let delayed = 0;
        this.fWires.forEach((w) => { if (w.delay) delayed++; });
        return { wires: this.fWires.size, delayed };
    }

    dispose(): void {
        this.fUnsubscribe();
        Array.from(this.fPorts.keys()).forEach((id) => this.releasePorts(id));
        this.reconcile();
    }

    /******************** PRIVATE ********************/

    private onPatchEvent(event: PatchEvent): void {
        switch (event.type) {
            case "moduleRemoved":
                this.releasePorts(event.module.id);
                break;
            case "arityChanged":
            case "modulationsChanged": {
                // until the module gets its new DSP (Scene), the merger may have more or fewer
                // channels than the node: Web Audio then drops or zero-fills them ("discrete")
                const ports = this.fPorts.get(event.module.id);
                if (ports && (ports.numInputs != totalInputs(event.module) || ports.numOutputs != event.module.numOutputs)) {
                    this.releasePorts(event.module.id);
                    this.fPorts.set(event.module.id, this.buildPorts(ports.node, totalInputs(event.module), event.module.numOutputs));
                }
                break;
            }
            case "moduleAdded":
            case "moduleUpdated":
                return;     // no effect on wiring
        }
        this.reconcile();
    }

    private buildPorts(node: AudioNode, numInputs: number, numOutputs: number): ModulePorts {
        const ports: ModulePorts = { node, numInputs, numOutputs };
        // the node may not have the ports yet: a module without audio input gets its first input with
        // a modulation, before its new DSP replaces the node (setNode)
        if (numInputs > 0) {
            ports.merger = this.fContext.createChannelMerger(numInputs);
            if (node.numberOfInputs > 0) ports.merger.connect(node);
        }
        if (numOutputs > 0) {
            ports.splitter = this.fContext.createChannelSplitter(numOutputs);
            if (node.numberOfOutputs > 0) node.connect(ports.splitter);
        }
        return ports;
    }

    // Detaches the merger/splitter of a module; its wires become stale and are removed by reconcile().
    private releasePorts(id: ModuleId): void {
        const ports = this.fPorts.get(id);
        if (!ports) return;
        this.fPorts.delete(id);
        if (ports.merger) {
            ports.merger.disconnect();
        }
        if (ports.splitter && ports.node.numberOfOutputs > 0) {
            safely(() => ports.node.disconnect(ports.splitter!));
        }
    }

    private reconcile(): void {
        const feedback = this.fPatch.analyze().feedback;
        const connections = new Map<ConnectionId, Connection>();
        this.fPatch.getConnections().forEach((c) => connections.set(c.id, c));

        // Remove the wires that are no longer wanted, or no longer as they should be.
        this.fWires.forEach((wire, id) => {
            const c = connections.get(id);
            const from = c && this.fPorts.get(c.from.module);
            const to = c && this.fPorts.get(c.to.module);
            if (!c || from?.splitter !== wire.splitter || to?.merger !== wire.merger || feedback.has(id) != (wire.delay !== undefined)) {
                this.unwire(wire);
                this.fWires.delete(id);
            }
        });

        // Wire the connections whose two ends exist.
        connections.forEach((c, id) => {
            if (this.fWires.has(id)) return;
            const splitter = this.fPorts.get(c.from.module)?.splitter;
            const merger = this.fPorts.get(c.to.module)?.merger;
            if (splitter && merger) {
                const wire: Wire = { splitter, output: c.from.port, merger, input: c.to.port };
                if (feedback.has(id)) {
                    wire.delay = this.fContext.createDelay(1);
                    wire.delay.delayTime.value = 0;     // clamped to one render quantum inside a cycle
                    splitter.connect(wire.delay, c.from.port, 0);
                    wire.delay.connect(merger, 0, c.to.port);
                } else {
                    splitter.connect(merger, c.from.port, c.to.port);
                }
                this.fWires.set(id, wire);
            }
        });
    }

    private unwire(wire: Wire): void {
        if (wire.delay) {
            safely(() => wire.splitter.disconnect(wire.delay!, wire.output, 0));
            wire.delay.disconnect();
        } else {
            safely(() => wire.splitter.disconnect(wire.merger, wire.output, wire.input));
        }
    }
}

// disconnect() throws InvalidAccessError when the link does not exist (e.g. already removed).
function safely(action: () => void): void {
    try {
        action();
    } catch (e) {
        // nothing to undo
    }
}
