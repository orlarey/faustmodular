declare name "Spectral Tilt";
declare author "Faust libraries";
declare source "fi.spectral_tilt (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Spectral tilt: a constant slope of the spectrum, in dB per octave, between two frequencies (six first order sections)
- Slope from -6 dB per octave (darker) to +6 dB per octave (brighter); -3 dB per octave makes a white noise pink
- Low and High: the band of the slope; the response is flat below Low
- From the Faust libraries: fi.spectral_tilt (filters.lib)

*/

process = fi.spectral_tilt(6, low, high - low, slope / (20 * log10(2)));

slope = hslider("[0]Slope[unit:dB/oct]", -3, -6, 6, 0.01);
low = hslider("[1]Low[unit:Hz][scale:log]", 50, 20, 20000, 1);
high = hslider("[2]High[unit:Hz][scale:log]", 10000, 20, 20000, 1) : max(2 * low);
