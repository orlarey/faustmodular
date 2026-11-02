declare name "Oberheim Filter";
declare author "Faust libraries";
declare source "ve.oberheim (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Virtual analog model of the state variable filter of the Oberheim SEM: low pass, high pass, band pass or band stop
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Q from 0.5 to 10: the resonance
- From the Faust libraries: ve.oberheim (vaeffects.lib)

*/

// the outputs of ve.oberheim: band stop, band pass, high pass, low pass
process = ve.oberheim(nf, q) : ba.selectn(4, 3 - mode);

mode = hslider("[0]Mode[style:menu{'low pass':0;'high pass':1;'band pass':2;'band stop':3}]", 0, 0, 3, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 1, 0.5, 10, 0.001);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
// the normalized frequency of vaeffects.lib (20*1000^nf Hz)
nf = log10(fc / 20) / 3;
