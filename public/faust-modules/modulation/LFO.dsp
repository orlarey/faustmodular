declare name "LFO";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Low frequency oscillator, bipolar output in [-1, 1]: a modulation source
- Shape: 0 sine, 1 triangle, 2 square, 3 sawtooth
- Connect the output to a widget of another module and choose "modulate" in the palette

*/

process = vgroup("LFO", select4(shape, os.osc(rate), os.lf_triangle(rate), os.lf_squarewave(rate), os.lf_saw(rate)));

rate = hslider("Rate[unit:Hz][scale:log]", 1, 0.01, 20, 0.01);
shape = hslider("Shape (sine, triangle, square, saw)", 0, 0, 3, 1);
select4(s, a, b, c, d) = select2(s >= 2, select2(s >= 1, a, b), select2(s >= 3, c, d));
