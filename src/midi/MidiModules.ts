/*				MIDIMODULES.TS
    The MIDI devices of the computer (Web MIDI: Chrome, Edge, Firefox; not Safari): their keyboards play the MIDI to
    CV modules of the scene (public/faust-modules/modular/MidiCV.dsp), their clock drives the MIDI Clock modules
    (MidiClock.dsp, ClockFollower.ts). The access is asked for when such a module first appears, not when the
    application opens; the devices plugged in later are listened to as well.

    A MIDI module is recognized by the metadata [midicv:...] of its widgets: its hidden widgets (note, gate,
    trigger, velocity, bend, mod, aftertouch) are set from the messages, its visible ones (channel, priority,
    legato) are read as its settings. Each module has its own voice (MonoVoice.ts). The hidden widgets are set in
    the DSP only: they are not saved with the scene, nor steps of the history (a note held is not a change).

    A MIDI Clock module ([midiclock:...]) gets a step at each clock message whose position is a multiple of its
    division (6 per sixteenth note), its reset at Start, its run (Start/Continue to Stop) and the tempo measured.
*/

import { metaValue } from "../model/UILayout";
import type { ModuleClass } from "../Modules/ModuleClass";
import type { FaustInterfaceControler } from "../Modules/FaustInterface";
import { MonoChange, MonoVoice } from "./MonoVoice";
import { ClockEvent, ClockFollower } from "./ClockFollower";

export const MIDI_META = "midicv";
export const CLOCK_META = "midiclock";
const OUTPUTS: Array<keyof MonoChange> = ["note", "gate", "velocity", "bend", "mod", "aftertouch"];
const TRIGGERS = 1000;      // the range of the trigger counter of the module

export interface MidiHost {
    modules(): ModuleClass[];               // the Faust modules of the scene
    notify(message: string): void;
    messages(): { midiUnavailable: string; midiRefused: string };
}

export type MidiState = "idle" | "pending" | "on" | "unavailable" | "refused";

// The widgets of a MIDI module, by their role (note, gate, channel...); empty for another module. `meta`: those of
// a MIDI to CV (midicv) or of a MIDI Clock (midiclock).
export function midiControls(module: ModuleClass, meta: string = MIDI_META): Map<string, FaustInterfaceControler> {
    const controls = new Map<string, FaustInterfaceControler>();
    for (const c of module.moduleControles ?? []) {
        const role = metaValue(c.itemParam as any, meta);
        if (role !== undefined) controls.set(role.trim(), c);
    }
    return controls;
}

const COUNTERS = 1000;      // the range of the step and reset counters of a MIDI Clock module

export class MidiModules {
    state: MidiState = "idle";
    private fVoices = new WeakMap<ModuleClass, MonoVoice>();
    private fTriggers = new WeakMap<ModuleClass, number>();
    readonly clock = new ClockFollower();
    private fCounters = new WeakMap<ModuleClass, { step: number; reset: number }>();

    constructor(private fHost: MidiHost) { }

    // A module was added: if it plays MIDI, the devices are asked for (once).
    moduleAdded(module: ModuleClass): void {
        const clock = midiControls(module, CLOCK_META);
        if (midiControls(module).size > 0 || clock.size > 0) this.start();
        // a MIDI Clock added while the clock runs: its tempo and run at once
        if (clock.size > 0) this.clockTo(module, clock, { tempo: this.clock.tempo, running: this.clock.running });
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
            const listen = () => access.inputs.forEach((input: any) => {
                input.onmidimessage = (e: { data: Uint8Array; timeStamp?: number }) => this.receive(e.data, e.timeStamp || performance.now());
            });
            listen();
            access.onstatechange = () => listen();      // a device plugged in later
            // a clock that stops coming: no tempo, stopped
            setInterval(() => this.clockEvent(this.clock.check(performance.now())), 250);
        } catch (e) {
            console.warn("MIDI:", e);
            this.state = "refused";
            this.fHost.notify(this.fHost.messages().midiRefused);
        }
    }

    // A MIDI message (at a time, ms as performance.now()), to every MIDI module of the scene.
    receive(data: ArrayLike<number>, time: number = performance.now()): void {
        if (data[0] >= 0xf0) {
            this.clockEvent(this.clock.handle(data, time));        // the system messages: the clock
            return;
        }
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

    // A change of the clock, to every MIDI Clock module of the scene.
    private clockEvent(event: ClockEvent | null): void {
        if (!event) return;
        for (const module of this.fHost.modules()) {
            const controls = midiControls(module, CLOCK_META);
            if (controls.size > 0) this.clockTo(module, controls, event);
        }
    }

    private clockTo(module: ModuleClass, controls: Map<string, FaustInterfaceControler>, event: ClockEvent): void {
        const dsp = module.moduleFaust?.getDSP?.();
        if (!dsp) return;
        const set = (role: string, value: number) => {
            const c = controls.get(role);
            if (c) dsp.setParamValue(c.itemParam.address, value);
        };
        let counters = this.fCounters.get(module);
        if (!counters) this.fCounters.set(module, counters = { step: 0, reset: 0 });
        if (event.tempo !== undefined) set("tempo", event.tempo);
        if (event.running !== undefined) set("run", event.running ? 1 : 0);
        if (event.start) set("reset", counters.reset = (counters.reset + 1) % COUNTERS);
        if (event.tick !== undefined) {
            const division = Math.max(1, Number(controls.get("division")?.value ?? 6));
            if (event.tick % division == 0) set("step", counters.step = (counters.step + 1) % COUNTERS);
        }
    }
}
