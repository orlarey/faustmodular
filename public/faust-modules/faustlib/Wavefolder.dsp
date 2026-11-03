declare name "Wavefolder";
declare author "Faust libraries";
declare source "aa.triangleFold1, aa.sineFold1, aa.triangleFold2, aa.sineFold2 (aanl.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Wavefolder, antialiased: the sound passes unchanged within [-1, 1], and beyond is folded back, as many times as needed
- Shape: triangle (folded linearly) or sine (each fold a half cosine, smoother); Antialiasing: first or second order (ADAA)
- Drive (dB): the gain before the folder, how many folds; Damping: each fold smaller than the previous one (0: periodic folding)
- Bias: an offset before the folder (its value at Bias removed after); Mix: from the dry sound to the folded one; Level (dB)
- From the Faust libraries: aa.triangleFold1, aa.sineFold1, aa.triangleFold2, aa.sineFold2 (aanl.lib)

*/

process = wet(folded);

shape = hslider("[0]Shape[style:menu{'triangle':0;'sine':1}]", 0, 0, 1, 1);
order = hslider("[1]Antialiasing[style:menu{'first order':0;'second order':1}]", 0, 0, 1, 1);
drive = hslider("[2]Drive[unit:dB]", 12, 0, 36, 0.1) : ba.db2linear;
damping = hslider("[3]Damping", 0, 0, 0.9, 0.01);
bias = hslider("[4]Bias", 0, -1, 1, 0.01);
mix = hslider("[5]Mix", 1, 0, 1, 0.01);
level = hslider("[6]Level[unit:dB]", 0, -24, 12, 0.1) : ba.db2linear;
// from the dry sound to the shaped one
// the offset of the curve at Bias removed: f(x + Bias) - f(Bias) (a high pass would overshoot on the flat tops)
wet(curve) = _ <: _, (*(drive) : +(bias) : curve : -(bias : curve)) : \(dry, shaped).(dry + mix * (shaped - dry)) : *(level);

folded = _ <: aa.triangleFold1(1, r), aa.sineFold1(1, r), aa.triangleFold2(1, r), aa.sineFold2(1, r) : ba.selectn(4, 2 * order + shape)
with {
    r = 1 - damping;
};
