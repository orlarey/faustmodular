declare name "StereoLevel";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Level meter of two channels, inserted anywhere: the signals go through unchanged
- RMS level over 50 ms of each channel, in dB

*/

process = vgroup("StereoLevel", (_ <: attach(_, meter(0))), (_ <: attach(_, meter(1))));

meter(c) = an.rms_envelope_rect(0.05) : ba.linear2db : max(-70) : hbargraph("Channel %c[unit:dB]", -70, 0);
