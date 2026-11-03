declare name "Dimension Expander";
declare author "Faust libraries";
declare source "ef.xferDimensionExpander (misceffects.lib)";
declare inlets "left; right";
declare outlets "left; right";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Stereo widener in the spirit of the Roland Dimension D: four delay taps of the mono sum, modulated, spread between the two sides
- Size: the delays of the taps (15 to 25 ms at 0, 115 to 189 ms at 1); Wet: their level, the dry sound always at its own
- From the Faust libraries: ef.xferDimensionExpander (misceffects.lib)

*/

process = ef.xferDimensionExpander(size, wet);

size = hslider("[0]Size", 0.3, 0, 1, 0.01);
wet = hslider("[1]Wet", 0.5, 0, 1, 0.01);
