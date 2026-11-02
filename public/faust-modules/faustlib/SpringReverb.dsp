declare name "Spring Reverb";
declare author "Faust libraries";
declare source "dm.springreverb_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Mono spring-inspired reverb demo using `re.springreverb`.
- From the Faust libraries: dm.springreverb_demo (demos.lib)

*/

process = dm.springreverb_demo;
