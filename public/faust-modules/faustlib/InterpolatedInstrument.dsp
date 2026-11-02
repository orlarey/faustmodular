declare name "Interpolated Instrument";
declare author "Faust libraries";
declare source "pm.modularInterpInstr_ui_MIDI (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Modular string instrument resonator based on IR measurements made on 3D printed models. The 2D space allowing for the control of the shape and the scale of the model is enabled by interpolating between modes parameters. More information about this technique/project can be found here: <https://ccrma.stanford.edu/~rmichon/3dPrintingModeling/>.
- Ready-to-use MIDI-enabled string instrument with a modular body (see [`modeInterpRes`](#pm.modeinterpres) and <https://ccrma.stanford.edu/~rmichon/3dPrintingModeling/>) with built-in UI.
- Pitch: 0.1 per octave, 0 = C4 (261.63 Hz), in place of the frequency of the instrument: a pitch dropped on it (a sequencer) plays in tune; Gate: the note
- From the Faust libraries: pm.modularInterpInstr_ui_MIDI (physmodels.lib)

*/

// the freq widget (Hz) of the instrument replaced by the frequency of a pitch, 0.1 per octave from C4
process = ["freq" : (!, hz) -> pm.modularInterpInstr_ui_MIDI]
with {
    hz = hslider("Pitch[unit:pitch]", 0, -1, 1, 0.0001) : \(p).(261.6256 * pow(2, 10 * p));
};
