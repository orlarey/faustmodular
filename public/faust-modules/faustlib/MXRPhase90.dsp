declare name "MXR Phase 90";
declare author "Faust libraries";
declare source "ve.mxrPhase90 (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Model of the MXR Phase 90 phaser pedal: four phase shift stages swept by an LFO
- Rate: the frequency of the LFO, from 0.1 to 10 Hz
- From the Faust libraries: ve.mxrPhase90 (vaeffects.lib)

*/

process = ve.mxrPhase90(rate);

rate = hslider("[0]Rate[unit:Hz][scale:log]", 1, 0.1, 10, 0.01);
