declare name "Sync Clock";
declare author "GRAME";
declare function "Clock Generator";
declare summary "Sync Clock: gates on the timeline shared by the Faust applications of the browser (faust-sync), in time with them";
declare outlets "clock; reset; run";
declare sync "beat; run; start; tempo; meter";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Follows the timeline shared by the Faust applications open in the browser (faust-sync): two faustmodular, a faustcode, play in time, their gates at the same instant
- The transport of the toolbar (play, stop, tempo) drives the timeline, in this application and in the others
- clock: a gate per sixteenth note, eighth note, quarter note or bar (Division), aligned on the bar; Width: how long it stays high, as a fraction of its period
- reset: a short gate when the playing starts from the beginning; run: 1 while the timeline plays
- Tempo: the tempo of the timeline

*/

// the last inputs, reserved (declare sync): fed by the application with the timeline, at every sample
process(beat, running, start, tempo, meter) = vgroup("SyncClock", attach(clock, division), reset, running)
with {
    division = nentry("[0]Division[style:menu{'sixteenth':0.25;'eighth':0.5;'quarter':1;'bar':0}]", 0.25, 0, 1, 0.25);
    width = hslider("[1]Width", 0.5, 0.05, 0.95, 0.01);
    // the length of a step in beats (a bar: the meter)
    length = select2(division > 0, meter, division);
    step = floor(beat / length);
    // a new step: the position crosses a division, the bar wraps, or the playing starts
    edge = running * (start | (beat < beat') | (step != step'));
    // high for n samples (rounded) from a trigger
    hold(trig, n) = (trig * rint(n)) : max ~ (-(1) : max(0)) : >(0);
    period = length * 60 / max(1, tempo) * ma.SR;
    clock = hold(edge, width * period) : attach(_, tempo : hbargraph("[2]Tempo[unit:BPM]", 0, 300));
    reset = hold(start, 0.002 * ma.SR);
};
