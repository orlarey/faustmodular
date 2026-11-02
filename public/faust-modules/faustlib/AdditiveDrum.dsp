declare name "Additive Drum";
declare author "Faust libraries";
declare source "sy.additiveDrum (synths.lib)";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Additive drum: sines at the frequencies of the modes of a membrane or of a bar, each with its envelope
- Gate: triggers the sound; a gate dropped on it (a sequencer, a clock) plays it
- Freq in Hz; Pitch transposes it, 0.1 per octave: a sequencer dropped on Pitch plays the notes from the frequency set
- Mode: membrane (the modes of a circular membrane, 1, 1.59, 2.14, 2.30...) or bar (a free bar, 1, 2.76, 5.40, 8.93)
- Damping: how much faster the upper modes die (0 to 1); Attack and Release: the envelope
- From the Faust libraries: sy.additiveDrum (synths.lib)

*/

process = sy.additiveDrum(freq, (1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501), (1, 0.8, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25), damping, attack, release, gate) / 4,
    sy.additiveDrum(freq, (1, 2.756, 5.404, 8.933), (1, 0.6, 0.4, 0.25), damping, attack, release, gate) / 2.25 : ba.selectn(2, mode);

mode = hslider("[1]Mode[style:menu{'membrane':0;'bar':1}]", 0, 0, 1, 1);
gate = button("[0]Gate");
freq = hslider("[2]Freq[unit:Hz][scale:log]", 120, 20, 2000, 0.1) * pow(2, 10 * pitch);
pitch = hslider("[3]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
damping = hslider("[4]Damping", 0.5, 0, 1, 0.01);
attack = hslider("[5]Attack[unit:ms][scale:log]", 2, 1, 500, 0.1) / 1000;
release = hslider("[6]Release[unit:ms][scale:log]", 500, 10, 5000, 0.1) / 1000;
