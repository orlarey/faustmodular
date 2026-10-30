declare name "Stereo Width";
declare author "GRAME";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Stereo image width: 2 inputs (left, right), 2 outputs
- Width = 0: mono, 1: unchanged, 2: wide (side signal doubled)

*/

process = vgroup("Stereo Width", width);

width(l, r) = m + s, m - s
with {
	w = hslider("Width", 1, 0, 2, 0.01) : si.smoo;
	m = (l + r) / 2;
	s = (l - r) / 2 * w;
};
