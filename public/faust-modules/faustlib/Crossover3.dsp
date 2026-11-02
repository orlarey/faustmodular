declare name "Crossover 3";
declare author "Faust libraries";
declare source "fi.crossover3LR4 (filters.lib)";
declare inlets "audio";
declare outlets "low; mid; high";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Three way Linkwitz-Riley crossover (4th order, 24 dB per octave): low, mid and high on three outputs
- Low and High: the two crossover frequencies (High kept above Low); the sum of the bands has a flat response
- From the Faust libraries: fi.crossover3LR4 (filters.lib)

*/

process = fi.crossover3LR4(low, high);

low = hslider("[0]Low[unit:Hz][scale:log]", 300, 20, 20000, 1);
high = hslider("[1]High[unit:Hz][scale:log]", 3000, 20, 20000, 1) : max(low);
