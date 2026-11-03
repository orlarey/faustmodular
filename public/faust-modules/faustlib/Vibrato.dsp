declare name "Vibrato";
declare author "Faust libraries";
declare source "de.fdelay (delays.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Vibrato: the sound through a delay swept by a sine LFO, which moves its pitch
- Rate: the LFO (0.5 to 20 Hz); Depth: the largest rise of the pitch, in cents (the delay swept is computed from it)
- From the Faust libraries: de.fdelay (delays.lib)

*/

// A delay d(t) = D (1 + sin(2 pi f t)) plays the sound at the speed 1 - d'(t), which rises at most to
// 1 + 2 pi f D: for a rise of c cents, D = (2^(c/1200) - 1) / (2 pi f).
process = de.fdelay(16384, d * ma.SR)
with {
    D = (pow(2, depth / 1200) - 1) / (2 * ma.PI * rate);
    d = D * (1 + os.osc(rate));
};

rate = hslider("[0]Rate[unit:Hz][scale:log]", 5, 0.5, 20, 0.001);
depth = hslider("[1]Depth[unit:cent]", 20, 0, 100, 0.1);
