declare name "Phaser";
declare author "Faust libraries";
declare source "pf.phaser2_mono (phaflangers.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Phaser: the sound and its copy through a chain of all pass filters whose notches are swept by a sine LFO
- Notches: 2, 4 or 8; Min and Max: the range of the sweep of the first notch; Ratio: from one notch to the next; Width: of the notches
- Rate: the LFO; Depth: the level of the copy (0: the dry sound); Feedback; Invert
- From the Faust libraries: pf.phaser2_mono (phaflangers.lib)

*/

process = _ <: pf.phaser2_mono(2, 0, width, low, ratio, high, rate, depth, feedback, invert),
    pf.phaser2_mono(4, 0, width, low, ratio, high, rate, depth, feedback, invert),
    pf.phaser2_mono(8, 0, width, low, ratio, high, rate, depth, feedback, invert) : ba.selectn(3, notches);

notches = hslider("[0]Notches[style:menu{'2':0;'4':1;'8':2}]", 1, 0, 2, 1);
rate = hslider("[1]Rate[unit:Hz][scale:log]", 0.5, 0.01, 10, 0.001);
low = hslider("[2]Min[unit:Hz][scale:log]", 100, 20, 5000, 0.001);
high = hslider("[3]Max[unit:Hz][scale:log]", 800, 50, 20000, 0.001) : max(low);
ratio = hslider("[4]Ratio[scale:log]", 1.5, 1.1, 4, 0.001);
width = hslider("[5]Width[unit:Hz][scale:log]", 1000, 10, 5000, 0.001);
depth = hslider("[6]Depth", 1, 0, 1, 0.01);
feedback = hslider("[7]Feedback", 0, -0.95, 0.95, 0.01);
invert = checkbox("[8]Invert");
