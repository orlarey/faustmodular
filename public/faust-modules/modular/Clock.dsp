declare name "Clock";
declare author "GRAME";
declare function "Clock Generator";
declare summary "Clock: gates at a tempo, quarter, eighth or sixteenth notes, with reset";
declare outlets "clock";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Clock: gates (0 or 1) at Tempo beats per minute
- Division: a gate per quarter, eighth or sixteenth note
- Width: how long each gate stays high, as a fraction of its period
- Reset: restarts the clock (a gate starts at once); a gate dropped on it drives it

*/

process = vgroup("Clock", clock(button("[3]Reset")));

clock(reset) = ph < width
with {
    ph = (*(1 - trigger) : +(tempo / 60 * division / ma.SR) : ma.frac) ~ _;
    trigger = gate(reset) <: _ > _';
};

gate(x) = loop ~ _ with { loop(p) = (x > 0.6) | ((x > 0.4) & p); };

tempo = hslider("[0]Tempo[unit:BPM]", 120, 20, 300, 1);
division = hslider("[1]Division[style:menu{'quarter':1;'eighth':2;'sixteenth':4}]", 1, 1, 4, 1);
width = hslider("[2]Width", 0.5, 0.05, 0.95, 0.01);
