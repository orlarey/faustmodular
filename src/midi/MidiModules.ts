/*				MIDIMODULES.TS
    The MIDI keyboards of the computer (Web MIDI: Chrome, Edge, Firefox; not Safari), played by the MIDI to CV
    modules of the scene (public/faust-modules/modular/MidiCV.dsp). The access is asked for when such a module
    first appears, not when the application opens; the devices plugged in later are listened to as well.

    A MIDI module is recognized by the metadata [midicv:...] of its widgets: its hidden widgets (note, gate,
    trigger, velocity, bend, mod, aftertouch) are set from the messages, its visible ones (channel, priority,
    legato) are read as its settings. Each module has its own voice (MonoVoice.ts). The hidden widgets are set in
    the DSP only: they are not saved with the scene, nor steps of the history (a note held is not a change).
*/

import { metaValue } from "../model/UILayout";
import type { ModuleClass } from "../Modules/ModuleClass";
import type { FaustInterfaceControler } from "../Modules/FaustInterface";
import { MonoChange, MonoVoice } from "./MonoVoice";

export const MIDI_META = "midicv";
const OUTPUTS: Array<keyof MonoChange> = ["note", "gate", "velocity", "bend", "mod", "aftertouch"];
const TRIGGERS = 1000;      // the range of the trigger counter of the module

export interface MidiHost {
    modules(): ModuleClass[];               // the Faust modules of the scene
    notify(message: string): void;
    messages(): { midiUnavailable: string; midiRefused: string };
}

export type MidiState = "idle" | "pending" | "on" | "unavailable" | "refused";

// The widgets of a MIDI module, by their role (note, gate, channel...); empty for another module.
export function midiControls(module: ModuleClass): Map<string, FaustInterfaceControler> {
    const controls = new Map<string, FaustInterfaceControler>();
    for (const c of module.moduleControles ?? []) {
        const role = metaValue(c.itemParam as any, MIDI_META);
        if (role !== undefined) controls.set(role.trim(), c);
    }
    return controls;
}

export class MidiModules {
    state: MidiState = "idle";
    private fVoices = new WeakMap<ModuleClass, MonoVoice>();
    private fTriggers = new WeakMap<ModuleClass, number>();

    constructor(private fHost: MidiHost) { }

    // A module was added: if it plays MIDI, the devices are asked for (once).
    moduleAdded(module: ModuleClass): void {
        if (midiControls(module).size > 0) this.start();
    }

    async start(): Promise<void> {
        if (this.state != "idle") return;
        const request = (navigator as any).requestMIDIAccess as (() => Promise<any>) | undefined;
        if (typeof request != "function") {
            this.state = "unavailable";
            this.fHost.notify(this.fHost.messages().midiUnavailable);
            return;
        }
        this.state = "pending";
        try {
            const access = await request.call(navigator);
            this.state = "on";
            const listen = () => access.inputs.forEach((input: any) => { input.onmidimessage = (e: { data: Uint8Array }) => this.receive(e.data); });
            listen();
            access.onstatechange = () => listen();      // a device plugged in later
        } catch (e) {
            console.warn("MIDI:", e);
            this.state = "refused";
            this.fHost.notify(this.fHost.messages().midiRefused);
        }
    }

    // A MIDI message, to every MIDI module of the scene.
    receive(data: ArrayLike<number>): void {
        for (const module of this.fHost.modules()) {
            const controls = midiControls(module);
            if (controls.size == 0) continue;
            let voice = this.fVoices.get(module);
            if (!voice) this.fVoices.set(module, voice = new MonoVoice());
            const setting = (role: string) => Number(controls.get(role)?.value ?? 0);
            const change = voice.handle(data, { channel: setting("channel"), priority: setting("priority"), legato: setting("legato") == 1 });
            if (!change) continue;
            const dsp = module.moduleFaust?.getDSP?.();
            if (!dsp) continue;
            const set = (role: string, value: number) => {
                const c = controls.get(role);
                if (c) dsp.setParamValue(c.itemParam.address, value);
            };
            if (change.retrigger) {
                const trigger = ((this.fTriggers.get(module) ?? 0) + 1) % TRIGGERS;
                this.fTriggers.set(module, trigger);
                set("trigger", trigger);
            }
            for (const role of OUTPUTS) {
                const value = change[role];
                if (typeof value == "number") set(role, value);
            }
        }
    }
}
