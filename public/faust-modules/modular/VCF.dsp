declare name "VCF";
declare author "GRAME";
declare function "Filter";
declare summary "Filter: low-pass, band-pass or high-pass, cutoff following a pitch";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- State variable filter (12 dB per octave): low pass, band pass or high pass
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow
  the notes, its amount on the modulation port being the keyboard tracking
- Resonance: from no resonance to a sharp peak (Q from 0.5 to 25)

*/

process = vgroup("VCF", vcf);

vcf(x) = x <: fi.svf.lp(fc, q), fi.svf.bp(fc, q), fi.svf.hp(fc, q) : ba.selectn(3, mode)
with {
    fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
    q = 0.5 * pow(50, resonance);
};

mode = hslider("[0]Mode[style:menu{'low pass':0;'band pass':1;'high pass':2}]", 0, 0, 2, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
resonance = hslider("[3]Resonance", 0.2, 0, 1, 0.01);
