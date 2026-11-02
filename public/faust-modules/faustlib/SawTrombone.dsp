declare name "Saw Trombone";
declare author "Faust libraries";
declare source "sy.sawTrombone (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Trombone, simply: a sawtooth through a low pass filter that opens with the level, while the gate is held
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Freq in Hz; Pitch transposes it, 0.1 per octave: a sequencer dropped on Pitch plays the notes from the frequency set
- Gain: the level, and the brightness (the cutoff goes from 50 Hz to 5 kHz with it)
- From the Faust libraries: sy.sawTrombone (synths.lib)

*/

process = sy.sawTrombone(freq, gain, gate);

gate = button("[0]Gate");
freq = hslider("[1]Freq[unit:Hz][scale:log]", 220, 20, 2000, 0.1) * pow(2, 10 * pitch);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
gain = hslider("[3]Gain", 0.5, 0, 1, 0.01);
