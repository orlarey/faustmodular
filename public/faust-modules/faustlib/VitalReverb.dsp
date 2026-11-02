declare name "Vital Reverb";
declare author "Faust libraries";
declare source "dm.vital_rev_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- A port of the reverb from the Vital synthesizer. All input parameters have been normalized to a continuous [0,1] range, making them easy to modulate. The scaling of the parameters happens inside the function.
- Example GUI for `vital_rev` with all parameters exposed.
- From the Faust libraries: dm.vital_rev_demo (demos.lib)

*/

process = dm.vital_rev_demo;
