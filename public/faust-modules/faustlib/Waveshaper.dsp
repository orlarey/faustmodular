declare name "Waveshaper";
declare author "Faust libraries";
declare source "aa.hardclip, aa.cubic1, aa.tanh1, aa.arctan, aa.sinarctan, aa.hyperbolic, aa.parabolic, aa.softclipQuadratic1, aa.asinh1 and their second orders (aanl.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Waveshaper, antialiased: the sound through a saturation curve computed by the antiderivative method (ADAA), of the first or of the second order
- Shape: hard clip, cubic, tanh, arctan, sin(arctan), hyperbolic, parabolic, quadratic, asinh; each kept within [-1, 1] (cubic by 1.5, arctan by 2/pi), but asinh, which grows as a logarithm
- Drive (dB): the gain before the curve; Bias: an offset before it, for even harmonics (the value of the curve at Bias removed after); Mix: from the dry sound to the shaped one; Level (dB)
- Their slope at 0: 1, but 1.5 for cubic, 2/pi for arctan and 2 for quadratic; the second order is used where aanl.lib has one (not for cubic and tanh, which keep the first)
- Drive up to 36 dB: beyond, the antiderivative of tanh, log(cosh(x)), overflows in single precision (|x| > 89); in single precision the second order overshoots at low frequencies when driven hard (measured at 50 Hz: 1% at 24 dB, up to 6% at 30 dB and 44% at 36 dB, for arctan): the first order stays within [-1, 1]
- From the Faust libraries: aa.hardclip, aa.cubic1, aa.tanh1, aa.arctan, aa.sinarctan, aa.hyperbolic, aa.parabolic, aa.softclipQuadratic1, aa.asinh1 and their second orders (aanl.lib)

*/

process = wet(shaped);

shape = hslider("[0]Shape[style:menu{'hard clip':0;'cubic':1;'tanh':2;'arctan':3;'sin arctan':4;'hyperbolic':5;'parabolic':6;'quadratic':7;'asinh':8}]", 2, 0, 8, 1);
order = hslider("[1]Antialiasing[style:menu{'first order':0;'second order':1}]", 0, 0, 1, 1);
drive = hslider("[2]Drive[unit:dB]", 12, 0, 36, 0.1) : ba.db2linear;
bias = hslider("[3]Bias", 0, -1, 1, 0.01);
mix = hslider("[4]Mix", 1, 0, 1, 0.01);
level = hslider("[5]Level[unit:dB]", 0, -24, 12, 0.1) : ba.db2linear;
// from the dry sound to the shaped one
// the offset of the curve at Bias removed: f(x + Bias) - f(Bias) (a high pass would overshoot on the flat tops)
wet(curve) = _ <: _, (*(drive) : +(bias) : curve : -(bias : curve)) : \(dry, shaped).(dry + mix * (shaped - dry)) : *(level);

// the curves, kept within [-1, 1] (cubic: 2/3, arctan: pi/2), first then second order
shaped = _ <: aa.hardclip, (aa.cubic1 : *(1.5)), aa.tanh1, (aa.arctan : *(2 / ma.PI)), aa.sinarctan, aa.hyperbolic,
    aa.parabolic, aa.softclipQuadratic1, aa.asinh1,
    aa.hardclip2, (aa.cubic1 : *(1.5)), aa.tanh1, (aa.arctan2 : *(2 / ma.PI)), aa.sinarctan2, aa.hyperbolic2,
    aa.parabolic2, aa.softclipQuadratic2, aa.asinh2 : ba.selectn(18, 9 * order + shape);
