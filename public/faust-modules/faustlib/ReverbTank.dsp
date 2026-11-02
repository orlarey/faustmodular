declare name "Reverb Tank";
declare author "Faust libraries";
declare source "dm.reverbTank_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- This is a stereo reverb following the "ReverbTank" example in [1], although some parameter ranges and scaling have been adjusted. It is an unofficial version of the Spin Semiconductor® Reverb. Other relevant instructional material can be found in [2-4].
- From the Faust libraries: dm.reverbTank_demo (demos.lib)

*/

process = dm.reverbTank_demo;
