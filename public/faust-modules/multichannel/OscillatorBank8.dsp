declare name "Oscillator Bank 8";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- 8 sine oscillators on 8 outputs: the harmonics 1 to 8 of a fundamental
- Output k plays harmonic k with an amplitude 1/k
- To spread them in space: connect the outputs to the ports of a spatializer or of the output

*/

process = vgroup("Oscillator Bank 8", par(i, 8, os.osc(f0 * (i + 1)) * level / (i + 1)));

f0 = hslider("Fundamental[unit:Hz]", 110, 40, 440, 1) : si.smoo;
level = hslider("Level", 0.3, 0, 1, 0.01) : si.smoo;
