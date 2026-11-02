declare name "Diode Ladder";
declare author "Faust libraries";
declare source "ve.diodeLadder (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Virtual analog model of the diode ladder (EMS, Roland TB-303), after a saturation of the input
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Q from 0.7 to 20: the resonance
- From the Faust libraries: ve.diodeLadder (vaeffects.lib)

*/

process = ve.diodeLadder(nf, q);

cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 1, 0.7, 20, 0.001);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
// the normalized frequency of vaeffects.lib (20*1000^nf Hz)
nf = log10(fc / 20) / 3;
