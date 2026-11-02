declare name "French Bell";
declare author "Faust libraries";
declare source "pm.frenchBell_ui (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- French church bell modal model. Modeled after D.Bartocha and Baron, Influence of Tin Bronze Melting and Pouring Parameters on Its Properties and Bell' Tone, Archives of Foundry Engineering, 2016. Model height is 1 m. This model contains 7 excitation positions going linearly from the bottom to the top of the bell. Obviously, a model with more excitation position could be regenerated using `mesh2faust`. This function also implements a virtual exciter to drive the model.
- French church bell physical model based on [`frenchBell`](#pmfrenchbell) with built-in UI.
- From the Faust libraries: pm.frenchBell_ui (physmodels.lib)

*/

process = pm.frenchBell_ui;
