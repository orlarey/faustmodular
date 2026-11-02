declare name "Crossover 4";
declare author "Faust libraries";
declare source "fi.crossover4LR4 (filters.lib)";
declare inlets "audio";
declare outlets "low; low mid; high mid; high";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Four way Linkwitz-Riley crossover (4th order, 24 dB per octave): four bands on four outputs
- Low, Mid and High: the three crossover frequencies (each kept above the previous one); the sum of the bands has a flat response
- From the Faust libraries: fi.crossover4LR4 (filters.lib)

*/

process = fi.crossover4LR4(low, mid, high);

low = hslider("[0]Low[unit:Hz][scale:log]", 200, 20, 20000, 1);
mid = hslider("[1]Mid[unit:Hz][scale:log]", 1000, 20, 20000, 1) : max(low);
high = hslider("[2]High[unit:Hz][scale:log]", 5000, 20, 20000, 1) : max(mid);
