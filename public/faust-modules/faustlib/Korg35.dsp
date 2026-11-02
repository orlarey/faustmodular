declare name "Korg 35";
declare author "Faust libraries";
declare source "ve.korg35LPF, ve.korg35HPF (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Virtual analog model of the Korg 35 filter (MS-10, MS-20): low pass (12 dB per octave) or high pass (6 dB per octave far below the cutoff)
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Q from 0.7 to 10: the resonance
- From the Faust libraries: ve.korg35LPF, ve.korg35HPF (vaeffects.lib)

*/

process = _ <: ve.korg35LPF(nf, q), ve.korg35HPF(nf, q) : ba.selectn(2, mode);

mode = hslider("[0]Mode[style:menu{'low pass':0;'high pass':1}]", 0, 0, 1, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 1, 0.7, 10, 0.001);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
// the normalized frequency of vaeffects.lib (20*1000^nf Hz)
nf = log10(fc / 20) / 3;
