declare name "Random";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Sample and hold of a noise: a new random value in [-1, 1] at each tick of the clock
- Rate: ticks per second; Smooth: glides from a value to the next (0 = steps)
- Unipolar: the values in [0, 1]; on a widget, its value is then the minimum of the modulation

*/

process = vgroup("Random", no.noise : ba.sAndH(tick) : si.smooth(ba.tau2pole(smooth)) : polarity);

rate = hslider("[0]Rate[unit:Hz][scale:log]", 4, 0.1, 50, 0.01);
smooth = hslider("[1]Smooth[unit:s]", 0, 0, 1, 0.01);
// [-1, 1], or [0, 1]
polarity = _ <: select2(checkbox("[2]Unipolar"), _, (_ + 1) / 2);
tick = os.lf_imptrain(rate) > 0;
