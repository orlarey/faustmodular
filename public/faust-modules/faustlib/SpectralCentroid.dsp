declare name "Spectral Centroid";
declare author "Faust libraries";
declare source "an.spectralCentroid (analyzers.lib)";
declare inlets "audio";
declare outlets "pitch";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Spectral centroid: the brightness of the sound, the frequency that balances the power above and below it, as a pitch (0.1 per octave from C4)
- Dropped on the Pitch of a filter, the cutoff follows the brightness of another sound
- Response: the time constant; Nonlinear: a cubic integration, steadier for responses under 5 ms
- From the Faust libraries: an.spectralCentroid (analyzers.lib)

*/

process = an.spectralCentroid(nonlinear, tau) <: attach(pitchOf, hbargraph("[8]Freq[unit:Hz][scale:log]", 20, 20000));

tau = hslider("[0]Response[unit:ms][scale:log]", 50, 1, 1000, 0.1) / 1000;
nonlinear = checkbox("[1]Nonlinear");
// a frequency as a pitch, 0.1 per octave from C4
pitchOf(f) = log(f / 261.6256) / log(2) / 10;
