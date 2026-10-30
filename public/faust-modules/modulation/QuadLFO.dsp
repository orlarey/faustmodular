declare name "Quad LFO";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- 4 sine LFOs in quadrature (phases 0, 90, 180 and 270 degrees), bipolar outputs in [-1, 1]
- To modulate 4 parameters with related motions, e.g. the positions of 4 sources in space

*/

process = vgroup("Quad LFO", par(i, 4, sin(2 * ma.PI * (os.phasor(1, rate) + i / 4))));

rate = hslider("Rate[unit:Hz][scale:log]", 0.5, 0.01, 20, 0.01);
