declare name "Vocoder";
declare author "Faust libraries";
declare source "dm.vocoder_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Use example of the vocoder function where an impulse train is used as excitation. The vocoder output is duplicated on two outputs.
- From the Faust libraries: dm.vocoder_demo (demos.lib)

*/

process = dm.vocoder_demo;
