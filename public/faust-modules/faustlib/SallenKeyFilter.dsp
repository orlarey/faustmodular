declare name "Sallen-Key Filter";
declare author "Faust libraries";
declare source "ve.sallenKey2ndOrder (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Virtual analog model of the second order Sallen-Key filter: low pass, band pass or high pass
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Q from 0.5 to 20: the resonance
- From the Faust libraries: ve.sallenKey2ndOrder (vaeffects.lib)

*/

// the outputs of ve.sallenKey2ndOrder: low pass, band pass, high pass
process = ve.sallenKey2ndOrder(nf, q) : ba.selectn(3, mode);

mode = hslider("[0]Mode[style:menu{'low pass':0;'band pass':1;'high pass':2}]", 0, 0, 2, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 0.707, 0.5, 20, 0.001);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
// the normalized frequency of vaeffects.lib (20*1000^nf Hz)
nf = log10(fc / 20) / 3;
