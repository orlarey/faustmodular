declare name "Transformer";
declare author "Faust libraries";
declare source "dm.ja_transformer_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Magnetic transformer saturation demo using Jiles-Atherton hysteresis. Stereo processor with Pre-EQ, J-A hysteresis core, and inverse Post-EQ.
- From the Faust libraries: dm.ja_transformer_demo (demos.lib)

*/

process = dm.ja_transformer_demo;
