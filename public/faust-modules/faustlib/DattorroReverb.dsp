declare name "Dattorro Reverb";
declare author "Faust libraries";
declare source "dm.dattorro_rev_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Reverberator based on the Dattorro reverb topology. This implementation does not use modulated delay lengths (excursion).
- Example GUI for `dattorro_rev` with all parameters exposed and additional dry/wet and output gain control.
- From the Faust libraries: dm.dattorro_rev_demo (demos.lib)

*/

process = dm.dattorro_rev_demo;
