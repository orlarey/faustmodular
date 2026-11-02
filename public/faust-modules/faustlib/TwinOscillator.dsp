declare name "Twin Oscillator";
declare author "Faust libraries";
declare source "dm.twin_osc_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- TwinOsc - virtual analog synthesis with a time-varying comb filter. Based on: "Virtual Analog Synthesis with a Time-Varying Comb Filter" D. Lowenfels, AES Convention 115, October 2003.
- From the Faust libraries: dm.twin_osc_demo (demos.lib)

*/

process = dm.twin_osc_demo;
