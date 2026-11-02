declare name "Kick";
declare author "Faust libraries";
declare source "sy.kick (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Kick drum: a sine whose frequency falls from five times the frequency to the frequency, through a saturation
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Freq in Hz; Pitch transposes it, 0.1 per octave: a sequencer dropped on Pitch plays the notes from the frequency set
- Click: the time of the fall of the frequency; Attack and Decay: the envelope, linear (Decay: to silence); Drive: the saturation (1 to 10)
- From the Faust libraries: sy.kick (synths.lib)

*/

process = sy.kick(freq, click, attack, decay, drive, gate);

gate = button("[0]Gate");
freq = hslider("[1]Freq[unit:Hz][scale:log]", 50, 20, 200, 0.1) * pow(2, 10 * pitch);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
click = hslider("[3]Click[unit:ms][scale:log]", 50, 5, 1000, 0.1) / 1000;
attack = hslider("[4]Attack[unit:ms][scale:log]", 5, 5, 400, 0.1) / 1000;
decay = hslider("[5]Decay[unit:ms][scale:log]", 500, 5, 4000, 0.1) / 1000;
drive = hslider("[6]Drive[scale:log]", 1, 1, 10, 0.01);
