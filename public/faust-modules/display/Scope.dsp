declare name "Scope";
declare author "GRAME";
declare display "scope";

/* =============== DESCRIPTION ================

- Oscilloscope and spectrum analyser, inserted anywhere: the signal goes through unchanged
- View: the waveform, or the spectrum
- Waveform: Time is the duration shown (1 ms to 5 s, in [-1, 1]); short durations are triggered on a
  crossing of the Threshold (Slope: rising or falling; Trigger auto: the signal is shown even without a
  crossing, normal: the last image stays), long ones scroll (modulation sources, envelopes)
- Spectrum: in dB of a sine (0 dB: a sine at full scale), on a logarithmic axis with a line per
  semitone (Scale: log) or a linear one; the strongest peak is written (frequency, note, level)
- The corner at the bottom right resizes the display

*/

// the widgets are read by the display: attached, so that the compiler keeps them
process = attach(_, view + time + trigger + slope + threshold + scale + width + height);

view = hslider("[0]View[style:menu{'waveform':0;'spectrum':1}]", 0, 0, 1, 1);
time = hslider("[1]Time[unit:ms][scale:log]", 20, 1, 5000, 1);
trigger = hslider("[2]Trigger[style:menu{'auto':0;'normal':1}]", 0, 0, 1, 1);
slope = hslider("[3]Slope[style:menu{'rising':0;'falling':1}]", 0, 0, 1, 1);
threshold = hslider("[4]Threshold", 0, -1, 1, 0.01);
scale = hslider("[5]Scale[style:menu{'log':0;'linear':1}]", 0, 0, 1, 1);
// the size of the display, set by its corner
width = hslider("[6]Width[hidden:1]", 320, 160, 1600, 1);
height = hslider("[7]Height[hidden:1]", 140, 80, 1000, 1);
