declare name "Klon Centaur";
declare author "Faust libraries";
declare source "ve.klonCentaur (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Wave digital model of the Klon Centaur overdrive pedal
- Gain, Treble and Level: the knobs of the pedal, from 0 to 1
- From the Faust libraries: ve.klonCentaur (vaeffects.lib)

*/

process = ve.klonCentaur(gain, treble, level);

gain = hslider("[0]Gain", 0.5, 0, 1, 0.01);
treble = hslider("[1]Treble", 0.5, 0, 1, 0.01);
level = hslider("[2]Level", 0.5, 0, 1, 0.01);
