declare name "Resonant Filter";
declare author "Faust libraries";
declare source "fi.resonlp, fi.resonhp, fi.resonbp (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Resonant second order filter (bilinear transform of the analog prototype): low pass, high pass or band pass
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Q from 0.5 to 20: the resonance at the cutoff
- From the Faust libraries: fi.resonlp, fi.resonhp, fi.resonbp (filters.lib)

*/

process = _ <: fi.resonlp(fc, q, 1), fi.resonhp(fc, q, 1), fi.resonbp(fc, q, 1) : ba.selectn(3, mode);

mode = hslider("[0]Mode[style:menu{'low pass':0;'high pass':1;'band pass':2}]", 0, 0, 2, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 2, 0.5, 20, 0.001);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
