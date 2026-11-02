declare name "High Shelf";
declare author "Faust libraries";
declare source "fi.highshelf (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- High shelf (3rd order): raises or lowers the frequencies above the frequency
- Gain in dB, from -24 to +24; Frequency in Hz
- From the Faust libraries: fi.highshelf (filters.lib)

*/

process = fi.highshelf(3, gain, freq);

gain = hslider("[0]Gain[unit:dB]", 0, -24, 24, 0.1);
freq = hslider("[1]Frequency[unit:Hz][scale:log]", 5000, 20, 20000, 1);
