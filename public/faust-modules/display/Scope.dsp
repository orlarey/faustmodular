declare name "Scope";
declare author "GRAME";
declare display "scope";

/* =============== DESCRIPTION ================

- Oscilloscope, inserted anywhere: the signal goes through unchanged
- Time: the duration shown, from 1 ms to 5 s, in [-1, 1]
- Short durations are triggered on a rising zero crossing (a stable image of a periodic signal);
  long ones scroll (modulation sources, envelopes)

*/

process = attach(_, hslider("Time[unit:ms][scale:log]", 20, 1, 5000, 1));
