declare name "Drone";
declare author "GRAME";
declare license "MIT";
declare function "Oscillator";
declare summary "Drone: three detuned sawtooths through a slow lowpass filter";
declare outlets "out";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Three sawtooths around Freq, Detune apart (in cents), through a lowpass filter
- Cutoff: the frequency of the filter, Gain: the level

*/

process = (os.sawtooth(freq * d) + os.sawtooth(freq) + os.sawtooth(freq / d)) / 3 : fi.lowpass(2, cutoff) * gain
with {
    freq = hslider("[0]Freq[unit:Hz][scale:log]", 110, 20, 2000, 0.01);
    detune = hslider("[1]Detune[unit:cents]", 7, 0, 50, 0.1);
    cutoff = hslider("[2]Cutoff[unit:Hz][scale:log]", 800, 50, 10000, 1);
    gain = hslider("[3]Gain", 0.3, 0, 1, 0.01);
    d = 2 ^ (detune / 1200);
};
