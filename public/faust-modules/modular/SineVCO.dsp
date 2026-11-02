declare name "SineVCO";
declare author "GRAME";
declare function "Oscillator";
declare summary "Sine oscillator: a frequency in Hz and a gain; two of them make classic FM";
declare outlets "sine";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Sine oscillator: Freq in Hz, Gain from 0 to 1
- Freq is modulated linearly ([mod:lin]): f = Freq * (1 + D * m), D being the deviation set on the
  modulation port (1 by default, from -10 to 10)
- Classic FM: the output of a SineVCO (the modulator, at fm) dropped on the Freq of another (the
  carrier, at fc) gives the index I = D * Gain * fc / fm; with the same frequency, the Gain of the
  modulator is the index. The frequency may go through zero (the phase then turns backwards).

*/

// Not smoothed: a modulation goes through the settings at audio rate.
process = vgroup("SineVCO", os.osc(freq) * gain);

freq = hslider("[0]Freq[unit:Hz][scale:log][mod:lin]", 440, 20, 20000, 0.01);
gain = hslider("[1]Gain", 0.5, 0, 1, 0.01);
