declare name "TF2 Filter";
declare author "Faust libraries";
declare source "dm.tf2_tpt_demo (demos.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- A resonator swept by a sinusoid, realized with `fi.tf2_tpt`. Pink noise (or the input) drives a second-order resonator of unity peak gain whose resonance frequency is modulated by up to 4 octaves either way, at rates up to 2 kHz, with Q from 0.1 to 100. The topology-preserving realization stays stable and accurate under this audio-rate modulation, and runs mirrored above SR/4, so the resonance can reach the Nyquist limit. With the pink-noise source, Level is the output RMS in dBFS: pink noise has the same power in every octave, so a constant-Q band passes about the same power at every frequency, and a table of the measured level versus Q normalizes it (within 1.5 dB from 100 Hz to 15 kHz at 44.1 to 192 kHz, 1 dB for Q >= 1). With the input as source, Level is the gain at the resonance peak.
- From the Faust libraries: dm.tf2_tpt_demo (demos.lib)

*/

process = dm.tf2_tpt_demo;
