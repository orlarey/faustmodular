declare name "OTT";
declare author "Faust libraries";
declare source "dm.xfer_ott_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Demo application for `co.xfer_ott`, the model of Xfer Records' OTT, with the plug-in's controls in its own units and at its defaults: Depth, Time, In/Out Gain and Upward/Downward strength, and per band (Low / Mid / High) Threshold, Gain and the two branch bypasses. Continuous controls are smoothed; Bypass switches the whole effect off for A/B comparison.
- From the Faust libraries: dm.xfer_ott_demo (demos.lib)

*/

process = dm.xfer_ott_demo;
