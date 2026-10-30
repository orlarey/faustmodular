declare name "Panner";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Mono to stereo: 1 input, 2 outputs (left, right)
- Pan = 0: left only, 0.5: center, 1: right only (constant power)

*/

process = vgroup("Panner", _ <: *(cos(a)), *(sin(a)))
with {
	a = hslider("Pan", 0.5, 0, 1, 0.01) : si.smoo : *(ma.PI / 2);
};
