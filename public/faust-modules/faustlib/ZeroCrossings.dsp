declare name "Zero Crossings";
declare author "Faust libraries";
declare source "an.zcr (analyzers.lib)";
declare inlets "audio";
declare outlets "rate";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Zero crossing rate: the part of the samples where the sound changes sign, from 0 to 1; low for a low or pure sound, about 0.5 for a white noise (a sine of f Hz gives 2f/SR)
- A measure of the noisiness of a sound, to drop on a setting
- Response: the time constant
- From the Faust libraries: an.zcr (analyzers.lib)

*/

process = an.zcr(tau) <: attach(_, hbargraph("[8]Rate", 0, 1));

tau = hslider("[0]Response[unit:ms][scale:log]", 50, 1, 1000, 0.1) / 1000;
