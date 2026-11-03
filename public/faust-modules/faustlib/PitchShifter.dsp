declare name "Pitch Shifter";
declare author "Faust libraries";
declare source "ef.transpose_windowed (misceffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Pitch shifter: two Hann windowed taps of a delay line swept at the speed of the shift, which overlap without clicks
- Two taps, not four: with four, the frequencies at odd multiples of 2 SR / Window cancel for good (every 80 Hz from 40 Hz with 50 ms); with two, none is lost (-3 dB at worst, on average)
- Shift: in semitones (-24 to +24); Window: the length of the taps (short: less delay, longer: smoother)
- Mix: from the dry sound to the shifted one
- From the Faust libraries: ef.transpose_windowed (misceffects.lib)

*/

// two taps: with P taps a quarter of a window apart (P = 4), their Hann weights cancel the frequencies whose
// half period is that spacing, at every instant
process = mixed(ef.transpose_windowed(2, window * ma.SR, shift));

shift = hslider("[0]Shift[unit:st]", 7, -24, 24, 0.01);
window = hslider("[1]Window[unit:ms][scale:log]", 50, 10, 200, 0.01) / 1000;
mix = hslider("[2]Mix", 1, 0, 1, 0.01);
// from the dry sound to the effect
mixed(fx) = _ <: _, fx : \(dry, wet).(dry + mix * (wet - dry));
