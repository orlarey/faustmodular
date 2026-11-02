declare name "LFO";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Low frequency oscillator, output in [-1, 1]: a modulation source
- Shape: sine, triangle, square or sawtooth (a menu)
- Unipolar: the output in [0, 1]; on a widget, its value is then the minimum of the modulation
- Connect the output to a widget of another module: release the cable on the widget

*/

process = vgroup("LFO", select4(shape, os.osc(rate), os.lf_triangle(rate), os.lf_squarewave(rate), os.lf_saw(rate)) : polarity);

rate = hslider("[0]Rate[unit:Hz][scale:log]", 1, 0.01, 20, 0.01);
shape = hslider("[1]Shape [style:menu{'sine':0;'triangle':1;'square':2;'saw':3}]", 0, 0, 3, 1);
// [-1, 1], or [0, 1]
polarity = _ <: select2(checkbox("[2]Unipolar"), _, (_ + 1) / 2);
select4(s, a, b, c, d) = select2(s >= 2, select2(s >= 1, a, b), select2(s >= 3, c, d));
