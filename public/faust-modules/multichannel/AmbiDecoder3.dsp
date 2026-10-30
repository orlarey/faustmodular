declare name "Ambisonic Decoder 3";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- 2D ambisonic decoding, order 3: 7 inputs (ambisonic components), 8 outputs (loudspeakers in a circle)
- In-phase optimization, for listeners away from the center
- Follows Ambisonic Encoder 3; on a stereo output, connect the 8 outputs as a bus (they are mixed down)

*/

process = vgroup("Ambisonic Decoder 3", ho.optimInPhase(3) : ho.decoder(3, 8));
