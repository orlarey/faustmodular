declare name "Offset";
declare author "GRAME";
declare function "Attenuator";
declare function2 "Precision Adder";
declare summary "Attenuverter and offset; transposes a pitch in semitones";
declare inlets "in";
declare outlets "out";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Attenuverter, offset and precision adder: out = in * Gain + Offset + Transpose
- Gain from -1 (inverted) to 1; Offset from -1 to 1
- Transpose in semitones, for a pitch (0.1 per octave): 12 semitones add 0.1

*/

process = vgroup("Offset", _ * gain + offset + transpose * 0.1 / 12);

gain = hslider("[0]Gain", 1, -1, 1, 0.01) : si.smoo;
offset = hslider("[1]Offset", 0, -1, 1, 0.001) : si.smoo;
transpose = hslider("[2]Transpose[unit:st]", 0, -24, 24, 1);
