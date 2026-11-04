declare name "MIDI to CV";
declare author "GRAME";
declare function "MIDI";
declare summary "MIDI to CV: the notes of a MIDI keyboard as a pitch and a gate, with the velocity, the modulation wheel and the aftertouch";
declare outlets "pitch; gate; velocity; mod; aftertouch";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Plays the modules from a MIDI keyboard, one note at a time (Web MIDI: Chrome, Edge, Firefox; not Safari)
- pitch: 0.1 per octave from C4 (MIDI note 60), the pitch bend added; it stays on the last note after its release
- gate: 1 while a note is held; a new note falls for a sample, so that an envelope starts again (not in Legato)
- velocity, mod (the modulation wheel, CC 1), aftertouch: from 0 to 1
- Channel: omni or 1 to 16; Priority: the last note played, the lowest or the highest of the notes held
- Legato: a note played while another one is held changes the pitch without a new attack
- Bend: the range of the pitch bend, in semitones; Note: the note that sounds

*/

process = vgroup("MidiCV", attach(pitch, settings), gate, velocity, mod, touch)
with {
    // set by the application from the MIDI messages (src/midi/MidiModules.ts), hidden
    note = hslider("note[midicv:note][hidden:1]", 60, 0, 127, 1);
    held = hslider("gate[midicv:gate][hidden:1]", 0, 0, 1, 1);
    trigger = hslider("trigger[midicv:trigger][hidden:1]", 0, 0, 1000, 1);
    velocity = hslider("velocity[midicv:velocity][hidden:1]", 0, 0, 1, 0.001);
    bend = hslider("bend[midicv:bend][hidden:1]", 0, -1, 1, 0.0001) : si.smoo;
    mod = hslider("mod[midicv:mod][hidden:1]", 0, 0, 1, 0.001) : si.smoo;
    touch = hslider("aftertouch[midicv:aftertouch][hidden:1]", 0, 0, 1, 0.001) : si.smoo;
    // a new attack: the trigger counter changed, the gate falls for one sample
    gate = held * (trigger == trigger');
    pitch = (note - 60 + bend * range) / 120 : attach(_, note : hbargraph("[4]Note", 0, 127));
    // read by the application (src/midi/MidiModules.ts)
    settings = nentry("[0]Channel[style:menu{'omni':0;'1':1;'2':2;'3':3;'4':4;'5':5;'6':6;'7':7;'8':8;'9':9;'10':10;'11':11;'12':12;'13':13;'14':14;'15':15;'16':16}][midicv:channel]", 0, 0, 16, 1)
        + nentry("[1]Priority[style:menu{'last':0;'lowest':1;'highest':2}][midicv:priority]", 0, 0, 2, 1)
        + checkbox("[2]Legato[midicv:legato]");
    range = hslider("[3]Bend[unit:st]", 2, 0, 24, 1);
};
