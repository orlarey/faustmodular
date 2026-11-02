declare name "Standard Bell";
declare author "Faust libraries";
declare source "pm.standardBell_ui (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Standard church bell modal model. Modeled after T. Rossing and R. Perrin, Vibrations of Bells, Applied Acoustics 2, 1987. Model height is 1.8 m. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.
- Standard church bell physical model based on [`standardBell`](#pmstandardbell) with built-in UI.
- From the Faust libraries: pm.standardBell_ui (physmodels.lib)

*/

process = pm.standardBell_ui;
