declare name "Fulltone OCD";
declare author "Faust libraries";
declare source "ve.fulltoneOCD (vaeffects.lib)";
declare inlets "audio";
declare outlets "audio";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Wave digital model of the Fulltone OCD overdrive pedal (v2)
- Drive, Tone and Volume: the knobs of the pedal, from 0 to 1; the drive raises the level a lot (Volume around 0.05 for the level of the input)
- HP: the HP position of the switch (more gain, brighter), LP otherwise
- From the Faust libraries: ve.fulltoneOCD (vaeffects.lib)

*/

process = ve.fulltoneOCD(drive, tone, volume, hp);

drive = hslider("[0]Drive", 0.5, 0, 1, 0.01);
tone = hslider("[1]Tone", 0.5, 0, 1, 0.01);
volume = hslider("[2]Volume", 0.05, 0, 1, 0.001);
hp = checkbox("[3]HP");
