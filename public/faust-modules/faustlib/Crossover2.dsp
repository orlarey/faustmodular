declare name "Crossover 2";
declare author "Faust libraries";
declare source "fi.crossover2LR4 (filters.lib)";
declare inlets "audio";
declare outlets "low; high";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Two way Linkwitz-Riley crossover (4th order, 24 dB per octave): the low and the high frequencies on two outputs
- The two bands are at -6 dB at the frequency, and their sum has a flat response
- From the Faust libraries: fi.crossover2LR4 (filters.lib)

*/

process = fi.crossover2LR4(freq);

freq = hslider("[0]Frequency[unit:Hz][scale:log]", 1000, 20, 20000, 1);
