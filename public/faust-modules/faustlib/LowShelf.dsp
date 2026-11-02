declare name "Low Shelf";
declare author "Faust libraries";
declare source "fi.lowshelf (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Low shelf (3rd order): raises or lowers the frequencies below the frequency
- Gain in dB, from -24 to +24; Frequency in Hz
- From the Faust libraries: fi.lowshelf (filters.lib)

*/

process = fi.lowshelf(3, gain, freq);

gain = hslider("[0]Gain[unit:dB]", 0, -24, 24, 0.1);
freq = hslider("[1]Frequency[unit:Hz][scale:log]", 200, 20, 20000, 1);
