declare name "ADSR";
declare author "GRAME";
declare function "Envelope Generator";
declare summary "Envelope: attack, decay, sustain, release, from a gate";
declare outlets "envelope";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Envelope generator in [0, 1], started by the Gate and released when it falls
- Gate: a button to play by hand; a gate dropped on it (a sequencer, a clock) drives it
  (high above 0.6, low below 0.4)
- Attack, Decay and Release in seconds; Sustain is a level
- To shape a level: drop the envelope on the Gain of a VCA

*/

process = vgroup("ADSR", gate(button("[0]Gate")) : en.adsr(attack, decay, sustain, release));

// high above 0.6, low below 0.4: a noisy gate does not chatter
gate(x) = loop ~ _ with { loop(p) = (x > 0.6) | ((x > 0.4) & p); };

attack = hslider("[1]Attack[unit:s][scale:log]", 0.01, 0.001, 10, 0.001);
decay = hslider("[2]Decay[unit:s][scale:log]", 0.3, 0.001, 10, 0.001);
sustain = hslider("[3]Sustain", 0.7, 0, 1, 0.01);
release = hslider("[4]Release[unit:s][scale:log]", 0.5, 0.001, 20, 0.001);
