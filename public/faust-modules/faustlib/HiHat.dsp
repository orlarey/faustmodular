declare name "Hi-Hat";
declare author "Faust libraries";
declare source "sy.hat (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Hi-hat: two sines in phase modulation driven by a noise, through a resonant low pass filter
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Freq in Hz; Pitch transposes it, 0.1 per octave: a sequencer dropped on Pitch plays the notes from the frequency set
- Tone: the cutoff of the filter (800 Hz to 18 kHz); Attack and Decay: the envelope, linear (Decay: to silence)
- From the Faust libraries: sy.hat (synths.lib)

*/

// the resonance of the filter of sy.hat (1.214) takes it to 1.29: kept within [-1, 1] by 0.75
process = sy.hat(freq, tone, attack, decay, gate) * 0.75;

gate = button("[0]Gate");
freq = hslider("[1]Freq[unit:Hz][scale:log]", 1000, 317, 3170, 0.1) * pow(2, 10 * pitch);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
tone = hslider("[3]Tone[unit:Hz][scale:log]", 8000, 800, 18000, 1);
attack = hslider("[4]Attack[unit:ms][scale:log]", 5, 5, 200, 0.1) / 1000;
decay = hslider("[5]Decay[unit:ms][scale:log]", 100, 5, 4000, 0.1) / 1000;
