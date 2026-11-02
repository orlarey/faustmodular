declare name "Marimba Model";
declare author "Faust libraries";
declare source "pm.marimba_ui_MIDI (physmodels.lib)";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Generic marimba tone bar modal model. This model was generated using `mesh2faust` from a 3D CAD model of a marimba tone bar (`libraries/modalmodels/marimbaBar`). The corresponding CAD model is that of a C2 tone bar (original fundamental frequency: ~65Hz). While `marimbaBarModel` allows to translate the harmonic content of the generated sound by providing a frequency (`freq`), mode transposition has limits and the model will sound less and less like a marimba tone bar as it diverges from C2. To make an accurate model of a marimba, we'd want to have an independent model for each bar... This model contains 5 excitation positions going linearly from the center bottom to the center top of the bar. Obviously, a model with more excitation position could be regenerated using `mesh2faust`.
- Simple MIDI controllable marimba physical model with built-in UI implementing a single tone bar connected to tube. This model is scalable and can be adapted to any size of bar/tube (see [`marimbaBarModel`](#marimbabarmodel) to know more about the limitations of this type of system).
- Pitch: 0.1 per octave, 0 = C4 (261.63 Hz), in place of the frequency of the instrument: a pitch dropped on it (a sequencer) plays in tune; Gate: the note
- From the Faust libraries: pm.marimba_ui_MIDI (physmodels.lib)

*/

// the freq widget (Hz) of the instrument replaced by the frequency of a pitch, 0.1 per octave from C4
process = ["freq" : (!, hz) -> pm.marimba_ui_MIDI]
with {
    hz = hslider("Pitch[unit:pitch]", 0, -1, 1, 0.0001) : \(p).(261.6256 * pow(2, 10 * p));
};
