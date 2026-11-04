declare name "MIDI Clock";
declare author "GRAME";
declare function "Clock Generator";
declare function2 "MIDI";
declare summary "MIDI Clock: the clock of an external MIDI device (sequencer, drum machine, DAW) as gates, with its start and its transport";
declare outlets "clock; reset; run";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Follows the MIDI clock of a device (24 clock messages per quarter note; Web MIDI: Chrome, Edge, Firefox): a sequencer plays in time with it
- clock: a gate per sixteenth note, eighth note, quarter note or bar (Division), the first one on the downbeat after Start; Width: how long it stays high, as a fraction of its period at the tempo measured
- reset: a short gate at Start, to set a sequencer back to its first step; run: 1 between Start (or Continue) and Stop
- Tempo: the tempo measured (0: no clock); without a clock, nothing is played (the Clock module has its own tempo)

*/

process = vgroup("MidiClock", attach(clock, settings), reset, run)
with {
    // set by the application from the MIDI messages (src/midi/MidiModules.ts), hidden
    step = hslider("step[midiclock:step][hidden:1]", 0, 0, 1000, 1);
    restart = hslider("reset[midiclock:reset][hidden:1]", 0, 0, 1000, 1);
    run = hslider("run[midiclock:run][hidden:1]", 0, 0, 1, 1);
    tempo = hslider("tempo[midiclock:tempo][hidden:1]", 0, 0, 999, 0.1);
    // a counter changed: a new gate
    edge(c) = c != c';
    // high for n samples (rounded) from a trigger
    hold(trig, n) = (trig * rint(n)) : max ~ (-(1) : max(0)) : >(0);
    period = ma.SR * 60 / select2(tempo > 0, 120, tempo) * division / 24;
    clock = run * hold(edge(step), width * period) : attach(_, tempo : hbargraph("[2]Tempo[unit:BPM]", 0, 300));
    reset = hold(edge(restart), 0.002 * ma.SR);
    // read by the application (the division), and set by the user
    division = nentry("[0]Division[style:menu{'sixteenth':6;'eighth':12;'quarter':24;'bar':96}][midiclock:division]", 6, 6, 96, 6);
    width = hslider("[1]Width", 0.5, 0.05, 0.95, 0.01);
    settings = division;
};
