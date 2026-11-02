declare name "Butterworth Filter";
declare author "Faust libraries";
declare source "fi.lowpass, fi.highpass (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Butterworth filter, maximally flat: low pass or high pass, -3 dB at the cutoff
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Order: 1, 2, 4 or 8 (6, 12, 24 or 48 dB per octave)
- From the Faust libraries: fi.lowpass, fi.highpass (filters.lib)

*/

process = _ <: fi.lowpass(1, fc), fi.lowpass(2, fc), fi.lowpass(4, fc), fi.lowpass(8, fc),
    fi.highpass(1, fc), fi.highpass(2, fc), fi.highpass(4, fc), fi.highpass(8, fc) : ba.selectn(8, 4 * mode + order);

mode = hslider("[0]Mode[style:menu{'low pass':0;'high pass':1}]", 0, 0, 1, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
order = hslider("[3]Order[style:menu{'1st':0;'2nd':1;'4th':2;'8th':3}]", 2, 0, 3, 1);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
