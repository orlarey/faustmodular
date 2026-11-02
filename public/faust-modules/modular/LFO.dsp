declare name "LFO";
declare author "GRAME";
declare function "LFO";
declare summary "Low frequency oscillator, four shapes, bipolar or unipolar, with reset";
declare outlets "LFO";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Low frequency oscillator: sine, triangle, saw or square
- Output in [-1, 1]; Unipolar: in [0, 1] (on a widget, its value is then the minimum of the modulation)
- Reset: restarts the cycle; a clock dropped on it syncs the LFO

*/

process = vgroup("LFO", lfo(button("[3]Reset")));

lfo(reset) = (sin(2 * ma.PI * ph), 1 - 4 * abs(ph - 0.5), 2 * ph - 1, select2(ph < 0.5, -1, 1))
    : ba.selectn(4, shape) <: select2(unipolar, _, (_ + 1) / 2)
with {
    ph = (*(1 - trigger) : +(rate / ma.SR) : ma.frac) ~ _;
    trigger = gate(reset) <: _ > _';
};

gate(x) = loop ~ _ with { loop(p) = (x > 0.6) | ((x > 0.4) & p); };

rate = hslider("[0]Rate[unit:Hz][scale:log]", 1, 0.01, 50, 0.01);
shape = hslider("[1]Shape[style:menu{'sine':0;'triangle':1;'saw':2;'square':3}]", 0, 0, 3, 1);
unipolar = checkbox("[2]Unipolar");
