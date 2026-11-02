declare name "Brass Model";
declare author "Faust libraries";
declare source "pm.brass_ui_MIDI (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Ready-to-use MIDI-controllable brass instrument physical model with built-in UI.
- Pitch: 0.1 per octave, 0 = C4 (261.63 Hz), in place of the frequency of the instrument: a pitch dropped on it (a sequencer) plays in tune; Gate: the note
- From the Faust libraries: pm.brass_ui_MIDI (physmodels.lib)

*/

// the freq widget (Hz) of the instrument replaced by the frequency of a pitch, 0.1 per octave from C4
process = ["freq" : (!, hz) -> pm.brass_ui_MIDI]
with {
    hz = hslider("Pitch[unit:pitch]", 0, -1, 1, 0.0001) : \(p).(261.6256 * pow(2, 10 * p));
};
