declare name "VCO";
declare author "GRAME";
declare function "Oscillator";
declare summary "Oscillator: sine, triangle, saw and square, pitch 0.1 per octave";
declare outlets "sine; triangle; saw; square";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Oscillator, four waveforms at once (alias-suppressed), in [-1, 1]
- Pitch: 0.1 per octave, 0 = C4 (261.63 Hz); a pitch (a sequencer) dropped on it is added to it
- Octave and Tune transpose; FM: frequency modulation in octaves (an audio signal dropped on it)
- Width: the duty cycle of the square (pulse width modulation)

*/

// The settings are not smoothed: a modulation goes through them at audio rate.
process = vgroup("VCO", os.osc(f), os.triangle(f), os.sawtooth(f), os.pulsetrain(f, width))
with {
    p = pitch + octave * 0.1 + tune * 0.1 / 12 + fm * 0.1;
    f = 261.6256 * pow(2, 10 * p) : max(0.1) : min(20000);
};

pitch = hslider("[0]Pitch[unit:pitch]", 0, -1, 1, 0.001);
octave = hslider("[1]Octave", 0, -4, 4, 1);
tune = hslider("[2]Tune[unit:st]", 0, -12, 12, 0.01);
fm = hslider("[3]FM[unit:oct]", 0, -4, 4, 0.01);
width = hslider("[4]Width", 0.5, 0.05, 0.95, 0.01);
