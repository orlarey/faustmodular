declare name "Church Bell";
declare author "Faust libraries";
declare source "pm.churchBell_ui (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Generic church bell modal model. Modeled after T. Rossing and R. Perrin, Vibrations of Bells, Applied Acoustics 2, 1987. Model height is 301 mm. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.
- Church bell physical model based on [`churchBell`](#pmchurchbell) with built-in UI.
- From the Faust libraries: pm.churchBell_ui (physmodels.lib)

*/

process = pm.churchBell_ui;
