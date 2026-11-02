declare name "Elliptic Filter";
declare author "Faust libraries";
declare source "fi.lowpass3e, fi.lowpass6e, fi.highpass3e, fi.highpass6e (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Elliptic (Cauer) filter: the steepest transition, with ripples in the passband (0.2 dB) and the stopband
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Mode: low pass or high pass; Order: 3rd or 6th; the cutoff is the edge of the passband (-0.2 dB)
- From the Faust libraries: fi.lowpass3e, fi.lowpass6e, fi.highpass3e, fi.highpass6e (filters.lib)

*/

process = _ <: fi.lowpass3e(fc), fi.lowpass6e(fc), fi.highpass3e(fc), fi.highpass6e(fc) : ba.selectn(4, 2 * mode + order);

mode = hslider("[0]Mode[style:menu{'low pass':0;'high pass':1}]", 0, 0, 1, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
order = hslider("[3]Order[style:menu{'3rd':0;'6th':1}]", 0, 0, 1, 1);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
