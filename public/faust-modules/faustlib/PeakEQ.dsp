declare name "Peak EQ";
declare author "Faust libraries";
declare source "fi.peak_eq_cq (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Peaking equalizer, constant Q: raises or lowers the frequencies around the frequency
- Gain in dB at the frequency, from -24 to +24; Q from 0.5 to 20 (the bandwidth is the frequency divided by Q)
- From the Faust libraries: fi.peak_eq_cq (filters.lib)

*/

process = fi.peak_eq_cq(gain, freq, q);

gain = hslider("[0]Gain[unit:dB]", 0, -24, 24, 0.1);
freq = hslider("[1]Frequency[unit:Hz][scale:log]", 1000, 20, 20000, 1);
q = hslider("[2]Q[scale:log]", 1, 0.5, 20, 0.001);
