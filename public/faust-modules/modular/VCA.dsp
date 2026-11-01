declare name "VCA";
declare author "GRAME";
declare function "VCA";
declare summary "Amplifier: gain plus CV, linear or exponential";
declare inlets "audio; CV";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Voltage controlled amplifier: the gain is the Gain knob plus the CV input, kept in [0, 1]
- Gain 0 (default): closed until a CV (an envelope) opens it
- Response: linear, or exponential (60 dB from 0 to 1, a natural loudness curve)

*/

process = vgroup("VCA", vca);

vca(x, cv) = x * select2(response, g, ba.db2linear(60 * (g - 1)) * (g > 0))
with {
    g = gain + cv : max(0) : min(1);
};

gain = hslider("[0]Gain", 0, 0, 1, 0.01) : si.smoo;
response = hslider("[1]Response[style:menu{'linear':0;'exponential':1}]", 0, 0, 1, 1);
