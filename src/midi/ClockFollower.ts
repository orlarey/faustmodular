/*				CLOCKFOLLOWER.TS
    The MIDI clock of an external device (a sequencer, a drum machine, a DAW), followed for the MIDI Clock modules
    (MidiModules.ts, public/faust-modules/modular/MidiClock.dsp): 24 clock messages (0xF8) per quarter note, Start
    (0xFA), Continue (0xFB), Stop (0xFC), Song Position Pointer (0xF2, in sixteenth notes).

    - The position counts the clock messages since the beginning of the song (Start: 0; a pointer moves it). A
      message received while running is at the current position, then the position advances: the first one after
      Start is the downbeat.
    - The tempo is measured from the times of the last clock messages (a quarter note), whether running or not
      (most devices send their clock all the time). No message for 2 beats at the last tempo (at least 0.5 s): no
      clock (tempo 0), and stopped.
*/

export const TICKS_PER_QUARTER = 24;
const WINDOW = TICKS_PER_QUARTER;       // the clock messages over which the tempo is measured

export interface ClockEvent {
    tick?: number;          // a clock message at this position (while running)
    start?: boolean;        // Start: a new reset
    running?: boolean;      // the transport changed
    tempo?: number;         // the tempo measured changed (BPM, 0: no clock)
}

export class ClockFollower {
    position = 0;
    running = false;
    tempo = 0;
    private fTimes: number[] = [];

    // A MIDI message at a time (ms, as performance.now()): what it changes, or null.
    handle(data: ArrayLike<number>, time: number): ClockEvent | null {
        switch (data[0]) {
            case 0xf8: {
                const event: ClockEvent = {};
                this.fTimes.push(time);
                if (this.fTimes.length > WINDOW + 1) this.fTimes.shift();
                const tempo = this.measure();
                if (tempo != this.tempo) {
                    this.tempo = tempo;
                    event.tempo = tempo;
                }
                if (this.running) {
                    event.tick = this.position;
                    this.position++;
                }
                return event.tick !== undefined || event.tempo !== undefined ? event : null;
            }
            case 0xfa:
                this.position = 0;
                this.running = true;
                return { start: true, running: true };
            case 0xfb:
                if (this.running) return null;
                this.running = true;
                return { running: true };
            case 0xfc:
                if (!this.running) return null;
                this.running = false;
                return { running: false };
            case 0xf2:
                // in sixteenth notes: 6 clock messages each
                this.position = (((data[2] ?? 0) << 7) | (data[1] ?? 0)) * (TICKS_PER_QUARTER / 4);
                return null;
        }
        return null;
    }

    // No clock message for a while: no tempo, stopped (a cable pulled, a device switched off).
    check(time: number): ClockEvent | null {
        const last = this.fTimes[this.fTimes.length - 1];
        if (last === undefined || this.tempo == 0 && !this.running) return null;
        const beat = this.tempo > 0 ? 60000 / this.tempo : 500;
        if (time - last < Math.max(500, 2 * beat)) return null;
        this.fTimes = [];
        const event: ClockEvent = { tempo: 0 };
        this.tempo = 0;
        if (this.running) {
            this.running = false;
            event.running = false;
        }
        return event;
    }

    // The tempo of the last clock messages (BPM, rounded to 0.1), 0 while there are fewer than 7 (a quarter of a
    // beat).
    private measure(): number {
        const n = this.fTimes.length;
        if (n < 7) return this.tempo;
        const interval = (this.fTimes[n - 1] - this.fTimes[0]) / (n - 1);
        if (interval <= 0) return this.tempo;
        return Math.round(600000 / (TICKS_PER_QUARTER * interval)) / 10;
    }
}
