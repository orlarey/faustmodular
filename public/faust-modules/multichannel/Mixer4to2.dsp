declare name "Mixer 4 to 2";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- 4 inputs mixed to stereo (2 outputs), with a gain and a pan for each input

*/

process = vgroup("Mixer 4 to 2", hgroup("Channels", par(i, 4, channel(i))) :> _, _);

channel(i) = vgroup("%j", *(gain) <: *(cos(a)), *(sin(a)))
with {
	j = i + 1;
	gain = vslider("Gain", 0.7, 0, 1, 0.01) : si.smoo;
	a = hslider("Pan", (i + 0.5) / 4, 0, 1, 0.01) : si.smoo : *(ma.PI / 2);
};
