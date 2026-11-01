declare name "VCA";
declare author "GRAME";
declare function "VCA";
declare summary "Amplifier: gain driven by an envelope, linear or exponential";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Amplifier: the audio input times the gain, in [0, 1]
- Gain 0 (default): closed until an envelope dropped on it opens it (depth 1: the envelope is the gain)
- Response: linear, or exponential (60 dB from 0 to 1, a natural loudness curve)

*/

process = vgroup("VCA", *(select2(response, gain, ba.db2linear(60 * (gain - 1)) * (gain > 0))));

gain = hslider("[0]Gain", 0, 0, 1, 0.01);
response = hslider("[1]Response[style:menu{'linear':0;'exponential':1}]", 0, 0, 1, 1);
