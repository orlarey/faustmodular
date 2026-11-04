/*				MONOVOICE.TS
    One monophonic voice played by MIDI messages, for the MIDI to CV module (MidiModules.ts): the notes held,
    the one that sounds by priority (the last one, the lowest, the highest), its velocity, the pitch bend, the
    modulation wheel (CC 1) and the aftertouch, for one channel or all (omni).

    A note pressed retriggers the gate (a new attack of the envelope), unless legato and a note was already held.
    A note released hands over to another note still held, without a new attack. All notes off (CC 123) and all
    sound off (CC 120) release everything.
*/

export interface MonoSettings {
    channel: number;            // 0: omni, 1 to 16
    priority: number;           // 0: the last note, 1: the lowest, 2: the highest
    legato: boolean;
}

// What changed: only the fields that did. `retrigger`: a new attack (the gate falls for a sample, then rises).
export interface MonoChange {
    note?: number;
    gate?: number;
    velocity?: number;
    bend?: number;              // -1 to 1
    mod?: number;               // 0 to 1
    aftertouch?: number;        // 0 to 1
    retrigger?: boolean;
}

export class MonoVoice {
    private fHeld: Array<{ note: number; velocity: number }> = [];      // in the order they were pressed
    private fNote = 60;
    private fGate = 0;

    get note(): number { return this.fNote; }
    get gate(): number { return this.fGate; }
    get held(): number[] { return this.fHeld.map((h) => h.note); }

    // A MIDI message (status and data bytes): what it changes for the voice, or null.
    handle(data: ArrayLike<number>, settings: MonoSettings): MonoChange | null {
        if (data.length < 1) return null;
        const status = data[0] & 0xf0, channel = (data[0] & 0x0f) + 1;
        if (status < 0x80 || status > 0xe0) return null;            // system messages: not for a voice
        if (settings.channel != 0 && channel != settings.channel) return null;
        const a = data[1] ?? 0, b = data[2] ?? 0;
        switch (status) {
            case 0x90:
                return b > 0 ? this.press(a, b / 127, settings) : this.release(a, settings);
            case 0x80:
                return this.release(a, settings);
            case 0xb0:
                if (a == 1) return { mod: b / 127 };
                if (a == 120 || a == 123) return this.releaseAll();
                return null;
            case 0xd0:
                return { aftertouch: a / 127 };
            case 0xa0:                                                  // the pressure of a key: of the one that sounds
                return this.fGate && a == this.fNote ? { aftertouch: b / 127 } : null;
            case 0xe0:
                return { bend: Math.max(-1, (((b << 7) | a) - 8192) / 8192) };
        }
        return null;
    }

    // The note that sounds among those held, by priority.
    private chosen(priority: number): { note: number; velocity: number } | undefined {
        if (this.fHeld.length == 0) return undefined;
        if (priority == 1) return this.fHeld.reduce((m, h) => h.note < m.note ? h : m);
        if (priority == 2) return this.fHeld.reduce((m, h) => h.note > m.note ? h : m);
        return this.fHeld[this.fHeld.length - 1];
    }

    private press(note: number, velocity: number, settings: MonoSettings): MonoChange | null {
        const wasHeld = this.fHeld.length > 0;
        this.fHeld = this.fHeld.filter((h) => h.note != note);
        this.fHeld.push({ note, velocity });
        const chosen = this.chosen(settings.priority)!;
        if (wasHeld && chosen.note == this.fNote && chosen.note != note) return null;     // another note sounds still
        this.fNote = chosen.note;
        this.fGate = 1;
        return { note: chosen.note, gate: 1, velocity: chosen.velocity, retrigger: !(settings.legato && wasHeld) };
    }

    private release(note: number, settings: MonoSettings): MonoChange | null {
        if (!this.fHeld.some((h) => h.note == note)) return null;
        this.fHeld = this.fHeld.filter((h) => h.note != note);
        const chosen = this.chosen(settings.priority);
        if (!chosen) {
            this.fGate = 0;
            return { gate: 0 };                                         // the pitch stays: the release sounds on it
        }
        if (chosen.note == this.fNote) return null;
        this.fNote = chosen.note;
        return { note: chosen.note, velocity: chosen.velocity };        // back to a note still held, no new attack
    }

    private releaseAll(): MonoChange | null {
        this.fHeld = [];
        if (!this.fGate) return null;
        this.fGate = 0;
        return { gate: 0 };
    }
}
