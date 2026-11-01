declare name "Mixer";
declare author "GRAME";
declare function "Mixer";
declare summary "Mixer: four inputs, one output";
declare inlets "1; 2; 3; 4";
declare outlets "mix";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Mixes four signals (audio or CV): the sum of each input times its level
- At level 1 a signal goes through unchanged

*/

process = vgroup("Mixer", par(i, 4, *(level(i))) :> _);

level(i) = hslider("Level %j", 1, 0, 1, 0.01) with { j = i + 1; };
