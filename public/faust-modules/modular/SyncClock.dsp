declare name "Sync Clock";
declare author "GRAME";
declare function "Clock Generator";
declare summary "Sync Clock: gates on the timeline shared by the Faust applications of the browser (faust-sync), in time with them";
declare outlets "clock; reset; run";
declare sync "index; run; start; tempo; meter";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Follows the timeline shared by the Faust applications open in the browser (faust-sync): two faustmodular, a faustcode, play in time, their gates at the same instant
- The transport of the toolbar (play, stop, tempo) drives the timeline, in this application and in the others
- clock: a gate per sixteenth note, eighth note, quarter note or bar (Division), aligned on the bar; Width: how long it stays high, as a fraction of its period (in ticks: 960 per quarter note)
- reset: a short gate when the playing starts from the beginning; run: 1 while the timeline plays
- Tempo: the tempo of the timeline

*/

// the last inputs, reserved (declare sync): fed by the application with the timeline, at every sample. index: the
// tick in the bar, an integer (960 per quarter note), exact: the samples of the ticks are computed in integers by
// the application, the same in every one.
process(index, running, start, tempo, meter) = vgroup("SyncClock", attach(clock, division), reset, running)
with {
    division = nentry("[0]Division[style:menu{'sixteenth':0.25;'eighth':0.5;'quarter':1;'bar':0}]", 0.25, 0, 1, 0.25);
    width = hslider("[1]Width", 0.5, 0.05, 0.95, 0.01);
    PPQ = 960;
    // a step in ticks (a bar: the meter), and the ticks it stays high
    step = int(select2(division > 0, meter, division) * PPQ + 0.5);
    high = max(1, int(width * step + 0.5));
    // the tick in the step; high for its first ticks...
    pos = int(index + 0.5) % max(1, step);
    inside = running * (pos < high);
    // ...from the tick that enters a new step (the tick in the step falls by more than half a step: 239 → 0), or the
    // start of the playing: not when the playing is taken up again in the middle of a step; a small step back of
    // the position gives no gate
    begin = start | ((pos < high) * (pos < pos' - step / 2));
    clock = (max(begin) : *(inside)) ~ _ : attach(_, tempo : hbargraph("[2]Tempo[unit:BPM]", 0, 300));
    // high for n samples (rounded) from a trigger
    hold(trig, n) = (trig * rint(n)) : max ~ (-(1) : max(0)) : >(0);
    reset = hold(start, 0.002 * ma.SR);
};
