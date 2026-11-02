declare name "SVF Filter";
declare author "Faust libraries";
declare source "fi.svf (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- State variable filter (Zavalishin, topology preserving): nine responses of a second order filter
- Mode: low pass, band pass, high pass, notch, peak, all pass, bell, low shelf, high shelf
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Q from 0.5 to 20 (0.707: Butterworth); Gain (dB) for the bell and the shelves
- From the Faust libraries: fi.svf (filters.lib)

*/

process = _ <: fi.svf.lp(fc, q), fi.svf.bp(fc, q), fi.svf.hp(fc, q), fi.svf.notch(fc, q), fi.svf.peak(fc, q),
    fi.svf.ap(fc, q), fi.svf.bell(fc, q, gain), fi.svf.ls(fc, q, gain), fi.svf.hs(fc, q, gain) : ba.selectn(9, mode);

mode = hslider("[0]Mode[style:menu{'low pass':0;'band pass':1;'high pass':2;'notch':3;'peak':4;'all pass':5;'bell':6;'low shelf':7;'high shelf':8}]", 0, 0, 8, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
q = hslider("[3]Q[scale:log]", 0.707, 0.5, 20, 0.001);
gain = hslider("[4]Gain[unit:dB]", 0, -24, 24, 0.1);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
