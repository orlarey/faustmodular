declare name "Clock";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Gate signal: 1 during a fraction of each period, 0 otherwise
- Tempo in beats per minute, Length: fraction of the period where the gate is on
- To trigger envelopes (ADSR) or drive buttons ("drive" in the palette)

*/

process = vgroup("Clock", (os.phasor(1, tempo / 60) < length) : float);

tempo = hslider("Tempo[unit:BPM]", 120, 20, 600, 1);
length = hslider("Length", 0.5, 0.01, 0.99, 0.01);
