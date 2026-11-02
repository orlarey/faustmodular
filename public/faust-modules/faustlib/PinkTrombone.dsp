declare name "Pink Trombone";
declare author "Faust libraries";
declare source "dm.pink_trombone_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Neil Thapen's Pink Trombone vocal-tract synthesiser (see `pinktrombone.lib`) with its original controls: voicebox (pitch, tenseness, always voice, pitch wobble), tract (tongue index/diameter, nasal) and two independent constrictions (index, diameter, active). As in the original, "always voice" is on by default, so the demo speaks on start-up.
- From the Faust libraries: dm.pink_trombone_demo (demos.lib)

*/

process = dm.pink_trombone_demo;
