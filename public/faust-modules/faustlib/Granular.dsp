declare name "Granular";
declare author "Faust libraries";
declare source "ef.granular (misceffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Granulator: three voices replay Hann windowed grains of the sound, taken Position back, which overlap into a texture (with four, shifted grains would cancel some frequencies for good, as in the Pitch Shifter)
- Grain: their duration; Shift: their pitch, in semitones; Jitter: a random part of their position; with no shift and no jitter, the sound delayed by Position
- Mix: from the dry sound to the grains (the line holds 65536 samples: 1.36 s at 48 kHz)
- From the Faust libraries: ef.granular (misceffects.lib)

*/

process = mixed(ef.granular(3, grain, pow(2, shift / 12), position, jitter));

grain = hslider("[0]Grain[unit:ms][scale:log]", 100, 10, 300, 0.01) / 1000;
shift = hslider("[1]Shift[unit:st]", 0, -24, 24, 0.01);
position = hslider("[2]Position[unit:ms]", 100, 0, 300, 0.1) / 1000;
jitter = hslider("[3]Jitter[unit:ms]", 0, 0, 300, 0.1) / 1000;
mix = hslider("[4]Mix", 1, 0, 1, 0.01);
// from the dry sound to the effect
mixed(fx) = _ <: _, fx : \(dry, wet).(dry + mix * (wet - dry));
