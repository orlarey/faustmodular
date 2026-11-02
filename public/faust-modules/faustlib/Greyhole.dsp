declare name "Greyhole";
declare author "Faust libraries";
declare source "dm.greyhole_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- A complex echo-like effect (stereo in/out), inspired by the classic Eventide effect of a similar name. The effect consists of a diffuser (like a mini-reverb, structurally similar to the one used in `jpverb`) connected in a feedback system with a long, modulated delay-line. Excels at producing spacey washes of sound.
- Example GUI for `greyhole` with all parameters exposed.
- From the Faust libraries: dm.greyhole_demo (demos.lib)

*/

process = dm.greyhole_demo;
