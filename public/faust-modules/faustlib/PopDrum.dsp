declare name "Pop Drum";
declare author "Faust libraries";
declare source "sy.popFilterDrum (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Pop drum: a burst of noise of 2 ms through a resonant band pass filter, which rings at the frequency
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Freq in Hz; Pitch transposes it, 0.1 per octave: a sequencer dropped on Pitch plays the notes from the frequency set
- Q: the resonance of the filter, how long it rings (5: a drum); the level is kept about the same whatever the frequency
- From the Faust libraries: sy.popFilterDrum (synths.lib)

*/

// the level of the burst through the filter grows with the frequency: kept about the same by 1500/freq
process = sy.popFilterDrum(freq, q, gate) * 1500 / freq;

gate = button("[0]Gate");
freq = hslider("[1]Freq[unit:Hz][scale:log]", 150, 20, 5000, 0.1) * pow(2, 10 * pitch);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 5, 1, 100, 0.01);
