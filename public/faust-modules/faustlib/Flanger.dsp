declare name "Flanger";
declare author "Faust libraries";
declare source "pf.flanger_mono (phaflangers.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Flanger: the sound and a copy delayed by a few ms, the delay swept by a sine LFO: the notches of the comb move
- Delay: the center of the sweep (0.1 to 10 ms); Sweep: its extent, from 0 (the delay fixed: an LFO can be dropped on Delay) to 1 (from 0 to twice the delay); Rate: the LFO
- Depth: the level of the delayed copy; Feedback; Invert: the copy subtracted (notches at multiples of 1/Delay, instead of odd multiples of 1/(2 Delay))
- From the Faust libraries: pf.flanger_mono (phaflangers.lib)

*/

process = pf.flanger_mono(8192, delay * ma.SR * (1 + sweep * os.osc(rate)), depth, feedback, invert);

delay = hslider("[0]Delay[unit:ms][scale:log]", 2, 0.1, 10, 0.01) / 1000;
sweep = hslider("[1]Sweep", 0.7, 0, 1, 0.01);
rate = hslider("[2]Rate[unit:Hz][scale:log]", 0.3, 0.01, 10, 0.001);
depth = hslider("[3]Depth", 1, 0, 1, 0.01);
feedback = hslider("[4]Feedback", 0.5, 0, 0.95, 0.01);
invert = checkbox("[5]Invert");
