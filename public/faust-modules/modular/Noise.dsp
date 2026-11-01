declare name "Noise";
declare author "GRAME";
declare function "Noise";
declare summary "White and pink noise";
declare outlets "white; pink";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Noise source: white noise, and pink (1/f) noise whose peaks stay near 1 (it sounds softer)
- Level: the level of both outputs

*/

process = vgroup("Noise", no.noise * level, no.pink_noise * 4 * level);

level = hslider("Level", 0.5, 0, 1, 0.01) : si.smoo;
