declare name "ADSR";
declare author "GRAME";
declare function "Envelope Generator";
declare summary "Envelope: attack, decay, sustain, release, from a gate";
declare inlets "gate";
declare outlets "envelope";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Envelope generator in [0, 1], started by a gate (high above 0.5) and released when it falls
- Attack, Decay and Release in seconds; Sustain is a level
- To shape a level: connect it to the CV input of a VCA

*/

process = vgroup("ADSR", gate : en.adsr(attack, decay, sustain, release));

// high above 0.6, low below 0.4: a noisy gate does not chatter
gate(x) = loop ~ _ with { loop(p) = (x > 0.6) | ((x > 0.4) & p); };

attack = hslider("[0]Attack[unit:s][scale:log]", 0.01, 0.001, 10, 0.001);
decay = hslider("[1]Decay[unit:s][scale:log]", 0.3, 0.001, 10, 0.001);
sustain = hslider("[2]Sustain", 0.7, 0, 1, 0.01);
release = hslider("[3]Release[unit:s][scale:log]", 0.5, 0.001, 20, 0.001);
