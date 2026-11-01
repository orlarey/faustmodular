declare name "Level";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Level meter, inserted anywhere: the signal goes through unchanged
- RMS: mean level over 50 ms, in dB
- Peak: peak level, held and released over 0.5 s, in dB

*/

process = vgroup("Level", \(x).(attach(attach(x, x : rms), x : peak)));

rms = an.rms_envelope_rect(0.05) : ba.linear2db : max(-70) : hbargraph("RMS[unit:dB]", -70, 0);
peak = an.peak_envelope(0.5) : ba.linear2db : max(-70) : hbargraph("Peak[unit:dB]", -70, 0);
