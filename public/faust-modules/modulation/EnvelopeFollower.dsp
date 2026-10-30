declare name "Envelope Follower";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Follows the amplitude of its input: unipolar output in [0, 1] for inputs in [-1, 1]
- Attack and Release: reaction times; Gain: sensitivity
- To make a parameter follow the loudness of a sound (e.g. a filter cutoff)

*/

process = vgroup("Envelope Follower", *(gain) : an.amp_follower_ar(attack, release) : min(1));

attack = hslider("Attack[unit:s]", 0.01, 0.001, 1, 0.001);
release = hslider("Release[unit:s]", 0.2, 0.001, 2, 0.001);
gain = hslider("Gain", 1, 0, 10, 0.01);
