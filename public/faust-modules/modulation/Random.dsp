declare name "Random";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Sample and hold of a noise: a new random value in [-1, 1] at each tick of the clock
- Rate: ticks per second; Smooth: glides from a value to the next (0 = steps)

*/

process = vgroup("Random", no.noise : ba.sAndH(tick) : si.smooth(ba.tau2pole(smooth)));

rate = hslider("Rate[unit:Hz][scale:log]", 4, 0.1, 50, 0.01);
smooth = hslider("Smooth[unit:s]", 0, 0, 1, 0.01);
tick = os.lf_imptrain(rate) > 0;
