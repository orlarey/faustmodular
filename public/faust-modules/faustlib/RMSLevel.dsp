declare name "RMS Level";
declare author "Faust libraries";
declare source "an.rms_envelope_tau (analyzers.lib)";
declare inlets "audio";
declare outlets "level";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- RMS level of the sound in dB, as a unipolar signal: 0 at the floor, 1 at 0 dB (a sine of amplitude 1 is at -3 dB)
- A level in dB follows the loudness as heard, where the Envelope Follower follows the amplitude
- Response: the time constant; Floor: the level that gives 0
- From the Faust libraries: an.rms_envelope_tau (analyzers.lib)

*/

process = an.rms_envelope_tau(tau) : ba.linear2db <: attach(_ - bottom : /(-bottom) : max(0) : min(1), hbargraph("[8]Level[unit:dB]", -96, 0));

tau = hslider("[0]Response[unit:ms][scale:log]", 50, 1, 1000, 0.1) / 1000;
bottom = hslider("[1]Floor[unit:dB]", -60, -96, -12, 0.1);
