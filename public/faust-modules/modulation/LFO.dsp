declare name "LFO";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Low frequency oscillator, bipolar output in [-1, 1]: a modulation source
- Shape: sine, triangle, square or sawtooth (a menu)
- Connect the output to a widget of another module: release the cable on the widget

*/

process = vgroup("LFO", select4(shape, os.osc(rate), os.lf_triangle(rate), os.lf_squarewave(rate), os.lf_saw(rate)));

rate = hslider("Rate[unit:Hz][scale:log]", 1, 0.01, 20, 0.01);
shape = hslider("Shape [style:menu{'sine':0;'triangle':1;'square':2;'saw':3}]", 0, 0, 3, 1);
select4(s, a, b, c, d) = select2(s >= 2, select2(s >= 1, a, b), select2(s >= 3, c, d));
