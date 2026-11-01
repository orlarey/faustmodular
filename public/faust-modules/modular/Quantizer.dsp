declare name "Quantizer";
declare author "GRAME";
declare function "Quantizer";
declare summary "Quantizer: a pitch to the nearest note of a scale";
declare inlets "pitch";
declare outlets "pitch";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Moves a pitch (0.1 per octave) to the nearest note of a scale, ties going down
- Scale: chromatic, major, natural minor, major or minor pentatonic
- Tonic: the first note of the scale

*/

process = vgroup("Quantizer", quantize);

quantize(p) = (tonic + 12 * octave + rdtable(scales, int(scale) * 12 + degree)) / 120
with {
    r = int(floor(p * 120 - tonic + 0.5));
    octave = int(floor(r / 12.0));
    degree = r - 12 * octave;
};

// for each scale, the nearest note of the scale for each semitone 0..11 (12: the next octave)
scales = waveform{
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    0, 0, 2, 2, 4, 5, 5, 7, 7, 9, 9, 11,
    0, 0, 2, 3, 3, 5, 5, 7, 8, 8, 10, 10,
    0, 0, 2, 2, 4, 4, 7, 7, 7, 9, 9, 12,
    0, 0, 3, 3, 3, 5, 5, 7, 7, 10, 10, 10
};

scale = hslider("[0]Scale[style:menu{'chromatic':0;'major':1;'minor':2;'major pentatonic':3;'minor pentatonic':4}]", 1, 0, 4, 1);
tonic = hslider("[1]Tonic[style:menu{'C':0;'C#':1;'D':2;'D#':3;'E':4;'F':5;'F#':6;'G':7;'G#':8;'A':9;'A#':10;'B':11}]", 0, 0, 11, 1);
