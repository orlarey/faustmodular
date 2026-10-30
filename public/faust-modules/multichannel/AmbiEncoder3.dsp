declare name "Ambisonic Encoder 3";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- 2D ambisonic encoding, order 3: 1 input, 7 outputs (ambisonic components)
- Angle: direction of the source (0 to 1 = one turn), Rotation: automatic rotation in turns per second
- To be followed by Ambisonic Decoder 3 (7 inputs)

*/

process = vgroup("Ambisonic Encoder 3", encode);

encode(x) = ho.encoder(3, x, angle * 2 * ma.PI);

angle = (hslider("Angle", 0, 0, 1, 0.01) + os.phasor(1, hslider("Rotation[unit:turn/s]", 0.1, 0, 2, 0.01))) : ma.frac;
