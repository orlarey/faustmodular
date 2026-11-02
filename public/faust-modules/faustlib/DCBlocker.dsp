declare name "DC Blocker";
declare author "Faust libraries";
declare source "fi.dcblocker (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- DC blocker: removes the constant part of the signal (a zero at 0 Hz, a pole at 0.995), transparent above 30 Hz
- From the Faust libraries: fi.dcblocker (filters.lib)

*/

process = fi.dcblocker;
