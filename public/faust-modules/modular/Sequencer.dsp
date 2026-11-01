declare name "Sequencer";
declare author "GRAME";
declare function "Sequencer";
declare summary "Sequencer: eight steps of pitch and gate, driven by a clock";
declare inlets "clock; reset";
declare outlets "V/oct; gate";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Step sequencer: each rising edge of the clock moves to the next of the Length steps
- Each step is a pitch in semitones above C4 (0.1 per octave on the V/oct output); -1 is a rest
- Gate: high while the clock is high, except on rests; the pitch holds during a rest
- Reset: a rising edge goes back before the first step (the next clock plays it)

*/

process = vgroup("Sequencer", sequencer);

sequencer(clock, reset) = pitch, g * (semis >= 0)
with {
    g = gate(clock);
    advance = g <: _ > _';
    restart = gate(reset) <: _ > _';
    count = (+(advance) : *(1 - restart)) ~ _;
    step = select2(count > 0, length - 1, int(count - 1) % int(length));
    semis = ba.selectn(8, step, s(0), s(1), s(2), s(3), s(4), s(5), s(6), s(7));
    pitch = max(semis, 0) / 120 : ba.sAndH(semis >= 0);
};

gate(x) = loop ~ _ with { loop(p) = (x > 0.6) | ((x > 0.4) & p); };

s(i) = hslider("[%j]Step %j[unit:st]", ba.take(i + 1, (0, 12, 7, -1, 3, 10, 7, 5)), -1, 24, 1) with { j = i + 1; };
length = hslider("[9]Length", 8, 1, 8, 1);
