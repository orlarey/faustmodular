declare name "Blower";
declare author "Faust libraries";
declare source "pm.blower_ui (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- A virtual blower creating a DC signal with some breath noise in it.
- Same as [`blower`](#blower) but with a built-in UI.
- From the Faust libraries: pm.blower_ui (physmodels.lib)

*/

process = pm.blower_ui;
