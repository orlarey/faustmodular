declare name "Djembe Model";
declare author "Faust libraries";
declare source "pm.djembe_ui_MIDI (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Simple MIDI controllable djembe physical model with built-in UI.
- From the Faust libraries: pm.djembe_ui_MIDI (physmodels.lib)

*/

process = pm.djembe_ui_MIDI;
