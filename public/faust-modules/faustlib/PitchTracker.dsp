declare name "Pitch Tracker";
declare author "Faust libraries";
declare source "an.pitchTracker (analyzers.lib)";
declare inlets "audio";
declare outlets "pitch; gate";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Pitch tracker: the frequency of the sound, by its zero crossings after an adaptive low pass filter (2nd order), as a pitch (0.1 per octave from C4), and a gate while the sound is above the threshold
- Dropped on the Pitch of a VCO and on the Gate of an ADSR, the voice plays what it hears; the gate closes when the sound falls below the threshold or stops (1.5 periods without a zero crossing), and the pitch is held
- Response: the time constant (with 20 ms: settled in about 170 ms, within 1.4 cents at 55 Hz, 0.2 cent from 110 Hz); Threshold: the level of the gate (RMS, dB)
- From the Faust libraries: an.pitchTracker (analyzers.lib)

*/

process = _ <: (fi.highpass(1, 20) : rising : since), tracked, an.rms_envelope_tau(tau) : voice
with {
    // the frequency of an.pitchTracker (a rate of zero crossings averaged by one pole, which ripples at the
    // frequency of the sound: 100 cents at 220 Hz for 20 ms) smoothed twice more in Hz, before the logarithm:
    // the ripple falls to 0.2 cent at 110 Hz, with no bias
    tracked = an.pitchTracker(2, tau) : fi.lptau(tau) : fi.lptau(tau);
    // the samples since the last rising zero crossing of the sound
    rising(x) = (x > 0) & (x' <= 0);
    since(c) = (+(1) : *(1 - c)) ~ _;
    // the gate: the sound above the threshold, and still crossing zero (a sound that stops leaves the tracker
    // falling for as long as its level takes to fall: the gate closes after 1.5 periods without crossing).
    // The pitch follows while the gate is open; closed, it holds the pitch of two periods before.
    voice(s, hz, level) = attach(select2(gate, held, p), hz : hbargraph("[8]Freq[unit:Hz]", 20, 5000)), gate
    with {
        p = pitchOf(hz);
        period = ma.SR / max(20, hz);
        gate = (level > ba.db2linear(threshold)) & (s < 1.5 * period);
        held = ba.sAndH(gate, p : de.delay(8192, int(2 * period)));
    };
};

tau = hslider("[0]Response[unit:ms][scale:log]", 20, 1, 1000, 0.1) / 1000;
threshold = hslider("[1]Threshold[unit:dB]", -40, -80, 0, 0.1);
// a frequency as a pitch, 0.1 per octave from C4; from 20 Hz, so that a frequency not yet measured (0, at the
// start of a sound, or in silence) gives a low pitch rather than minus infinity (a VCO it drives would be lost)
pitchOf(f) = log(max(20, f) / 261.6256) / log(2) / 10;
