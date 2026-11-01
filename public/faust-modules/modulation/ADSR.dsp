declare name "ADSR";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Envelope generator, unipolar output in [0, 1]
- Triggered by its input (a gate: on while above 0, e.g. from Clock) or by its Gate button
- To shape a level: release the cable on a gain slider set to its minimum

*/

process = vgroup("ADSR", _ > 0 : max(button("Gate")) : en.adsr(a, d, s, r));

a = hslider("[1]Attack[unit:s]", 0.01, 0.001, 2, 0.001);
d = hslider("[2]Decay[unit:s]", 0.2, 0.001, 2, 0.001);
s = hslider("[3]Sustain", 0.5, 0, 1, 0.01);
r = hslider("[4]Release[unit:s]", 0.3, 0.001, 5, 0.001);
