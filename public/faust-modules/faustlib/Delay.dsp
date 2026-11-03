declare name "Delay";
declare author "Faust libraries";
declare source "de.fdelay (delays.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Delay, fractional, with feedback: its time glides when it moves, which transposes the delayed sound, as a tape
- Time: from 1 ms to 1 s; an LFO dropped on it gives a chorus, a vibrato or a flutter
- Feedback: the part of the delayed sound sent back; Mix: from the dry sound to the delayed one alone
- From the Faust libraries: de.fdelay (delays.lib)

*/

// the loop is Time long: fdelay of Time - 1 sample, plus the sample of the feedback (~); the output mem makes
// the delay of the sound Time too (as pf.flanger_mono)
process = mixed(((+ : de.fdelay(262144, max(0, time * ma.SR - 1))) ~ *(feedback)) : mem);

time = hslider("[0]Time[unit:ms][scale:log]", 300, 1, 1000, 0.01) / 1000;
feedback = hslider("[1]Feedback", 0.3, 0, 0.99, 0.01);
mix = hslider("[2]Mix", 0.5, 0, 1, 0.01);
// from the dry sound to the effect
mixed(fx) = _ <: _, fx : \(dry, wet).(dry + mix * (wet - dry));
