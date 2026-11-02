declare name "Notch Filter";
declare author "Faust libraries";
declare source "fi.notchw (filters.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Notch filter: removes the frequencies around the cutoff
- Cutoff in Hz; an envelope or an LFO dropped on it moves it in octaves
- Pitch: moves the cutoff, 0.1 per octave; a pitch dropped on it (a sequencer) makes the cutoff follow the notes, its amount on the modulation port being the keyboard tracking
- Width in Hz: the width of the notch
- From the Faust libraries: fi.notchw (filters.lib)

*/

process = fi.notchw(width, fc);

cutoff = hslider("[1]Cutoff[unit:Hz][scale:log]", 1000, 20, 20000, 1);
pitch = hslider("[2]Pitch[unit:pitch]", 0, -1, 1, 0.0001);
width = hslider("[3]Width[unit:Hz][scale:log]", 100, 1, 5000, 1);
// the cutoff moved by the pitch, 0.1 per octave
fc = cutoff * pow(2, 10 * pitch) : max(20) : min(0.45 * ma.SR);
