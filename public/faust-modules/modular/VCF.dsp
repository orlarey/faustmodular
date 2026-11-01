declare name "VCF";
declare author "GRAME";
declare function "Filter";
declare summary "Filter: low-pass, band-pass or high-pass, cutoff following a pitch";
declare inlets "audio; V/oct";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Voltage controlled state variable filter (12 dB per octave)
- Mode: low pass, band pass or high pass
- Cutoff in Hz; the V/oct input moves it in octaves (0.1 per octave), scaled by Tracking
- Resonance: from no resonance to a sharp peak (Q from 0.5 to 25)

*/

process = vgroup("VCF", vcf);

vcf(x, pitch) = x <: fi.svf.lp(fc, q), fi.svf.bp(fc, q), fi.svf.hp(fc, q) : ba.selectn(3, mode)
with {
    fc = cutoff * pow(2, 10 * pitch * tracking) : max(20) : min(0.45 * ma.SR);
    q = 0.5 * pow(50, resonance);
};

mode = hslider("[0]Mode[style:menu{'low pass':0;'band pass':1;'high pass':2}]", 0, 0, 2, 1);
cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1) : si.smoo;
resonance = hslider("[2]Resonance", 0.2, 0, 1, 0.01) : si.smoo;
tracking = hslider("[3]Tracking", 1, 0, 1, 0.01);
