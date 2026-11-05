/*				AUDIOGRAPH.TS
    Web Audio rendering of a Patch (see Documentation/multi-io/PLAN.md, section 2.4).

    Each module gets a processing node (Faust DSP, microphone source or destination)
    framed by two native nodes:

        ChannelMergerNode(numInputs) --> node --> fader (GainNode) --> ChannelSplitterNode(numOutputs)

    so that a connection from output i of A to input j of B is the single mono link
    splitterA[i] -> mergerB[j]. Several links reaching the same merger input are summed
    by Web Audio. Feedback connections (Patch.analyze) go through a DelayNode, without
    which Web Audio would cut the cycle; its delay is one render quantum (128 samples).

    A module may have reserved inputs (src/sync/SyncInputs.ts): channels of its merger after those of its ports, fed
    by a source given by the scene (the Timeline node of faust-sync), not by connections.

    A merger always receives a silent source (a ConstantSourceNode at 0, shared): a module whose inputs
    are not connected still computes. Without it, Web Audio hands the Faust node an empty input, and
    faustwasm skips the computation of a DSP that has inputs: an oscillator with an unconnected V/oct
    input, a clock with an unconnected reset input stayed silent.

    Replacing the DSP of a module (new code, a modulation added or removed) crossfades, as Faust Live
    does: the new node is fed by the same merger and feeds the same splitter through its own fader;
    after CROSSFADE_DELAY (the parameters recalled on the new DSP reach its processor), the old fader
    goes linearly from its value to 0 and the new one from 0 to 1 in CROSSFADE seconds; then the old
    node is disconnected and handed back to be destroyed. The wires, from splitter to merger, do not
    change: the other modules do not notice. A linear crossfade keeps the level of two correlated
    signals (the same module before and after an edit).

    The graph is kept in sync by reconciliation: after any change, every connection of
    the patch whose two ends have a node is wired, with or without delay as required,
    and every other wire is removed.
*/

import { Connection, ConnectionId, ModuleId, Patch, PatchEvent, totalInputs } from "../model/Patch";

// Crossfade between the old and the new DSP of a module (s), and the delay before it starts (s).
export const CROSSFADE = 0.05;
export const CROSSFADE_DELAY = 0.02;

// A node being faded out, until it is retired (disconnected, then handed back to be destroyed).
interface Fading {
    node: AudioNode;
    fader: GainNode;
    merger?: ChannelMergerNode;
    timer: ReturnType<typeof setTimeout>;
    retire: () => void;
}

// The reserved inputs of a module: the outputs of `source` that feed them, in order.
export interface ReservedInputs {
    source: AudioNode;
    outputs: number[];
}

interface ModulePorts {
    node: AudioNode;
    numInputs: number;
    reserved: number;                 // reserved inputs, after the ports
    reservedSource?: AudioNode;       // their source, connected to the merger
    numOutputs: number;
    merger?: ChannelMergerNode;       // feeds the inputs of `node`
    fader?: GainNode;                 // between `node` and the splitter, 1 out of a crossfade
    splitter?: ChannelSplitterNode;   // fed by the outputs of `node`
    fading: Fading[];                 // previous nodes, being faded out
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
    private fSilence: AudioNode | null = null;
    private fReserved: (id: ModuleId) => ReservedInputs | null = () => null;

    // The reserved inputs of the modules (the scene); to be set before the modules get their nodes.
    setReservedInputs(provider: (id: ModuleId) => ReservedInputs | null): void {
        this.fReserved = provider;
    }

    // The silent source feeding every merger (created once).
    private silence(): AudioNode | null {
        if (!this.fSilence && typeof (this.fContext as any).createConstantSource == "function") {
            const source = this.fContext.createConstantSource();
            source.offset.value = 0;
            source.start();
            this.fSilence = source;
        }
        return this.fSilence;
    }

    constructor(private fContext: BaseAudioContext, private fPatch: Patch) {
        this.fUnsubscribe = fPatch.subscribe((event) => this.onPatchEvent(event));
    }

    // Sets (or replaces, or with null removes) the processing node of a module.
    // Its ports are sized from the module arity in the patch.
    // With `replaced`, the new node of a module crossfades with the old one, which is then handed to
    // `replaced` (to be destroyed); without crossfade (no previous node, ports to rebuild), at once.
    setNode(id: ModuleId, node: AudioNode | null, replaced?: () => void): void {
        const ports = this.fPorts.get(id);
        const module = this.fPatch.getModule(id);
        if (node && replaced && ports && module && ports.fader && ports.node !== node
            && ports.numInputs == totalInputs(module) && ports.numOutputs == module.numOutputs
            && ports.reserved == (this.fReserved(id)?.outputs.length ?? 0)) {
            this.crossfade(ports, node, replaced);
            return;
        }
        this.releasePorts(id);
        replaced?.();
        if (node) {
            const module = this.fPatch.getModule(id);
            if (!module) {
                throw new Error(`AudioGraph: module ${id} is not in the patch`);
            }
            this.fPorts.set(id, this.buildPorts(id, node, totalInputs(module), module.numOutputs));
        }
        this.reconcile();
    }

    // The reserved inputs given again (their source is ready, or a code changed them): the mergers rebuilt.
    refreshReserved(): void {
        this.fPorts.forEach((ports, id) => {
            const module = this.fPatch.getModule(id);
            if (module) this.resizePorts(id, ports, totalInputs(module), module.numOutputs);
        });
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
        if (this.fSilence) {
            safely(() => (this.fSilence as ConstantSourceNode).stop());
            this.fSilence = null;
        }
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
                if (ports) this.resizePorts(event.module.id, ports, totalInputs(event.module), event.module.numOutputs);
                break;
            }
            case "moduleAdded":
            case "moduleUpdated":
                return;     // no effect on wiring
        }
        this.reconcile();
    }

    // The merger of a module: its ports, then its reserved inputs fed by their source; none without inputs.
    private merger(numInputs: number, reserved: ReservedInputs | null): ChannelMergerNode | undefined {
        const count = numInputs + (reserved?.outputs.length ?? 0);
        if (count == 0) return undefined;
        const merger = this.fContext.createChannelMerger(count);
        this.silence()?.connect(merger, 0, 0);
        reserved?.outputs.forEach((output, r) => reserved.source.connect(merger, output, numInputs + r));
        return merger;
    }

    private buildPorts(id: ModuleId, node: AudioNode, numInputs: number, numOutputs: number): ModulePorts {
        const reserved = this.fReserved(id);
        const ports: ModulePorts = { node, numInputs, reserved: reserved?.outputs.length ?? 0, reservedSource: reserved?.source, numOutputs, fading: [] };
        // the node may not have the ports yet: a module without audio input gets its first input with
        // a modulation, before its new DSP replaces the node (setNode)
        ports.merger = this.merger(numInputs, reserved);
        if (ports.merger && node.numberOfInputs > 0) ports.merger.connect(node);
        if (numOutputs > 0) {
            ports.splitter = this.fContext.createChannelSplitter(numOutputs);
            ports.fader = this.fader(1);
            ports.fader.connect(ports.splitter);
            if (node.numberOfOutputs > 0) node.connect(ports.fader);
        }
        return ports;
    }

    // Rebuilds only the side whose number of channels changed: a modulation added (one more input)
    // leaves the splitter, and so the wires to the other modules, untouched. Rebuilding both sides
    // rewired the downstream modules, and Web Audio could render a quantum between the removal of a
    // wire and its replacement: a quantum of silence downstream.
    private resizePorts(id: ModuleId, ports: ModulePorts, numInputs: number, numOutputs: number): void {
        const reserved = this.fReserved(id);
        if (ports.numInputs != numInputs || ports.reserved != (reserved?.outputs.length ?? 0)) {
            if (ports.merger) {
                const merger = ports.merger;
                merger.disconnect();
                if (this.fSilence) safely(() => this.fSilence!.disconnect(merger));
                if (ports.reservedSource) safely(() => ports.reservedSource!.disconnect(merger));
                ports.merger = undefined;
            }
            ports.merger = this.merger(numInputs, reserved);
            if (ports.merger && ports.node.numberOfInputs > 0) ports.merger.connect(ports.node);
            ports.fading.forEach((f) => f.merger = undefined);      // they lost their inputs (fading out)
            ports.numInputs = numInputs;
            ports.reserved = reserved?.outputs.length ?? 0;
            ports.reservedSource = reserved?.source;
        }
        if (ports.numOutputs != numOutputs) {
            const faders = [ports.fader, ...ports.fading.map((f) => f.fader)].filter((f): f is GainNode => !!f);
            faders.forEach((f) => f.disconnect());
            ports.splitter = undefined;
            if (numOutputs > 0) {
                ports.splitter = this.fContext.createChannelSplitter(numOutputs);
                if (!ports.fader) {
                    ports.fader = this.fader(1);
                    if (ports.node.numberOfOutputs > 0) ports.node.connect(ports.fader);
                }
                [ports.fader, ...ports.fading.map((f) => f.fader)].forEach((f) => f.connect(ports.splitter!));
            }
            ports.numOutputs = numOutputs;
        }
    }

    // A gain passing all the channels of the node as they are.
    private fader(gain: number): GainNode {
        const fader = this.fContext.createGain();
        fader.channelInterpretation = "discrete";
        fader.gain.value = gain;
        return fader;
    }

    private crossfade(ports: ModulePorts, node: AudioNode, retire: () => void): void {
        const t0 = this.fContext.currentTime + CROSSFADE_DELAY;
        const t1 = t0 + CROSSFADE;
        const ramp = (fader: GainNode, from: number, to: number) => {
            fader.gain.cancelScheduledValues(0);
            fader.gain.setValueAtTime(from, t0);
            fader.gain.linearRampToValueAtTime(to, t1);
        };
        const old = ports.fader!;
        const fader = this.fader(0);
        fader.connect(ports.splitter!);
        if (node.numberOfOutputs > 0) node.connect(fader);
        if (ports.merger && node.numberOfInputs > 0) ports.merger.connect(node);
        ramp(old, old.gain.value, 0);      // a node still fading in fades out from where it is
        ramp(fader, 0, 1);
        const fading: Fading = { node: ports.node, fader: old, merger: ports.merger, retire, timer: 0 as any };
        fading.timer = setTimeout(() => {
            ports.fading = ports.fading.filter((f) => f !== fading);
            this.retire(fading);
        }, (CROSSFADE_DELAY + CROSSFADE) * 1000 + 50);
        ports.fading.push(fading);
        ports.node = node;
        ports.fader = fader;
    }

    private retire(fading: Fading): void {
        clearTimeout(fading.timer);
        if (fading.merger && fading.node.numberOfInputs > 0) safely(() => fading.merger!.disconnect(fading.node));
        if (fading.node.numberOfOutputs > 0) safely(() => fading.node.disconnect(fading.fader));
        fading.fader.disconnect();
        fading.retire();
    }

    // Detaches the merger/splitter of a module; its wires become stale and are removed by reconcile().
    private releasePorts(id: ModuleId): void {
        const ports = this.fPorts.get(id);
        if (!ports) return;
        this.fPorts.delete(id);
        if (ports.merger) {
            ports.merger.disconnect();
            const merger = ports.merger;
            if (this.fSilence) safely(() => this.fSilence!.disconnect(merger));
            if (ports.reservedSource) safely(() => ports.reservedSource!.disconnect(merger));
        }
        if (ports.fader) {
            if (ports.node.numberOfOutputs > 0) safely(() => ports.node.disconnect(ports.fader!));
            ports.fader.disconnect();
        }
        // a crossfade cut short: the old nodes go at once
        ports.fading.forEach((fading) => this.retire(fading));
        ports.fading = [];
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
