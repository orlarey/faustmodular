declare name "Comb String";
declare author "Faust libraries";
declare source "sy.combString (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Plucked string, the simplest one: a burst of noise of 2 ms in a comb filter tuned to the frequency
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Freq in Hz; Pitch transposes it, 0.1 per octave: a sequencer dropped on Pitch plays the notes from the frequency set
- Decay: the time to -60 dB of the string (the module converts it to the resonance of the library: 1000 Decay Freq / (6.91 SR))
- From the Faust libraries: sy.combString (synths.lib)

*/

// the resonance of sy.combString is the time constant of its feedback per period, in ms: its time to -60 dB is
// 6.91 res SR / (1000 freq); the module sets it from the decay asked. The delay line holds 1024 samples: the
// frequency is kept above SR/1000.
process = sy.combString(f, 1000 * decay * f / (6.91 * ma.SR), gate)
with {
    f = freq : max(ma.SR / 1000);
};

gate = button("[0]Gate");
freq = hslider("[1]Freq[unit:Hz][scale:log]", 220, 50, 2000, 0.1) * pow(2, 10 * pitch);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
decay = hslider("[3]Decay[unit:s][scale:log]", 2, 0.05, 20, 0.01);
