declare name "Clap";
declare author "Faust libraries";
declare source "sy.clap (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Hand clap: a white noise through four staggered envelopes and a resonant low pass filter
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Tone: the cutoff of the filter (400 to 3500 Hz); Attack and Decay: added to the envelopes of the claps
- From the Faust libraries: sy.clap (synths.lib)

*/

process = sy.clap(tone, attack, decay, gate);

gate = button("[0]Gate");
tone = hslider("[1]Tone[unit:Hz][scale:log]", 1500, 400, 3500, 1);
attack = hslider("[2]Attack[unit:ms]", 0, 0, 200, 0.1) / 1000;
decay = hslider("[3]Decay[unit:ms][scale:log]", 100, 1, 4000, 0.1) / 1000;
