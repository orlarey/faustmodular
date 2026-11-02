declare name "Filter Bank";
declare author "Faust libraries";
declare source "dm.filterbank_demo (?)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- A bank of band-pass filters splitting the signal into frequency bands, each with its own gain (a graphic equalizer).
- From the Faust libraries: dm.filterbank_demo (?)

*/

process = dm.filterbank_demo;
