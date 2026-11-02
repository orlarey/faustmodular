declare name "Moog Ladder";
declare author "Faust libraries";
declare source "ve.moogLadder (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Virtual analog model of the Moog ladder: four one pole low pass filters in a feedback loop (24 dB per octave)
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Q from 0.707 (no feedback) to 25 (the threshold of self oscillation)
- From the Faust libraries: ve.moogLadder (vaeffects.lib)

*/

process = ve.moogLadder(nf, q);

cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 1, 0.707, 25, 0.001);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
// the normalized frequency of vaeffects.lib (20*1000^nf Hz)
nf = log10(fc / 20) / 3;
