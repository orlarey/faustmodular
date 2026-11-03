declare name "Echo";
declare author "Faust libraries";
declare source "ef.echo (misceffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Echo: a delay line whose output is fed back: an echo every Time, the first Feedback times the sound, each next one Feedback times the previous one
- Time: from 1 ms to 2 s, a whole number of samples (moving it clicks: the Delay module glides)
- Mix: from the dry sound to the echoes alone
- From the Faust libraries: ef.echo (misceffects.lib)

*/

// ef.echo gives the dry sound and its echoes: the echoes alone are its output minus its input
process = mixed(echoes);
echoes = _ <: ef.echo(2, time, feedback), _ : -;

time = hslider("[0]Time[unit:ms][scale:log]", 300, 1, 2000, 0.01) / 1000;
feedback = hslider("[1]Feedback", 0.4, 0, 0.99, 0.01);
mix = hslider("[2]Mix", 0.5, 0, 1, 0.01);
// from the dry sound to the effect
mixed(fx) = _ <: _, fx : \(dry, wet).(dry + mix * (wet - dry));
