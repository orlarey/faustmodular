declare name "Multi Delay 4";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- 4 independent echoes: 4 inputs, 4 outputs
- The delay of channel k is Time x k (k = 1 to 4), with a common feedback and dry/wet mix

*/

process = vgroup("Multi Delay 4", par(i, 4, echo(i + 1)));

echo(k) = _ <: *(1 - wet), (+ ~ (de.delay(65536, d) * feedback) : *(wet)) :> _
with {
	d = time * k * ma.SR : min(65535);
};

time = hslider("Time[unit:s]", 0.12, 0.01, 0.3, 0.001) : si.smoo;
feedback = hslider("Feedback", 0.4, 0, 0.95, 0.01);
wet = hslider("Wet", 0.5, 0, 1, 0.01) : si.smoo;
