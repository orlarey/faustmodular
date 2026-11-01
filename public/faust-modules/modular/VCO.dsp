declare name "VCO";
declare author "GRAME";
declare function "Oscillator";
declare summary "Oscillator: sine, triangle, saw and square, 0.1 per octave";
declare inlets "V/oct; FM";
declare outlets "sine; triangle; saw; square";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Voltage controlled oscillator, four waveforms at once (alias-suppressed), in [-1, 1]
- V/oct: pitch, 0.1 per octave, 0 = C4 (261.63 Hz)
- FM: exponential frequency modulation, the FM knob giving the octaves for an input of 1
- Octave and Tune transpose; Width is the duty cycle of the square

*/

process = vgroup("VCO", vco);

vco(pitch, fm) = os.osc(f), os.triangle(f), os.sawtooth(f), square
with {
    p = pitch + octave * 0.1 + tune * 0.1 / 12 + fm * depth * 0.1;
    f = 261.6256 * pow(2, 10 * p) : max(0.1) : min(20000);
    square = os.pulsetrain(f, width);
};

octave = hslider("[0]Octave", 0, -4, 4, 1);
tune = hslider("[1]Tune[unit:st]", 0, -12, 12, 0.01) : si.smoo;
depth = hslider("[2]FM[unit:oct]", 0, 0, 4, 0.01) : si.smoo;
width = hslider("[3]Width", 0.5, 0.05, 0.95, 0.01) : si.smoo;
