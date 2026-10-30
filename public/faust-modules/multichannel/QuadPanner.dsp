declare name "Quad Panner";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- 1 input spatialized on 4 loudspeakers placed in a circle (4 outputs)
- Angle: position on the circle (0 to 1 = one turn), Distance: from the center (0) to the circle (1)
- Rotation: automatic rotation speed, in turns per second

*/

process = vgroup("Quad Panner", sp.spat(4, angle, distance));

angle = (hslider("Angle", 0, 0, 1, 0.01) + os.phasor(1, hslider("Rotation[unit:turn/s]", 0, 0, 2, 0.01))) : ma.frac;
distance = hslider("Distance", 1, 0, 1, 0.01) : si.smoo;
