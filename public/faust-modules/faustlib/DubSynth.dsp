declare name "Dub Synth";
declare author "Faust libraries";
declare source "sy.dubDub (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Dub synth: a sawtooth through a resonant low pass filter, while the gate is held (10 ms of attack and release)
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Freq in Hz; Pitch transposes it, 0.1 per octave: a sequencer dropped on Pitch plays the notes from the frequency set
- Cutoff and Q: the filter
- From the Faust libraries: sy.dubDub (synths.lib)

*/

process = sy.dubDub(freq, cutoff, q, gate);

gate = button("[0]Gate");
freq = hslider("[1]Freq[unit:Hz][scale:log]", 110, 20, 2000, 0.1) * pow(2, 10 * pitch);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
cutoff = hslider("[3]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
q = hslider("[4]Q[scale:log]", 3, 0.5, 20, 0.001);
