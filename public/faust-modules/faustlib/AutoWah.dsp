declare name "Auto Wah";
declare author "Faust libraries";
declare source "ve.autowah (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Auto wah: a wah pedal (Crybaby) moved by the level of the signal
- Level: the part of the wah in the output, from 0 (dry) to 1
- From the Faust libraries: ve.autowah (vaeffects.lib)

*/

process = ve.autowah(level);

level = hslider("[0]Level", 1, 0, 1, 0.01);
