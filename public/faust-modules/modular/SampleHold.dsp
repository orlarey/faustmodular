declare name "SampleHold";
declare author "GRAME";
declare function "Sample and Hold";
declare function2 "Random";
declare summary "Sample and hold of an input or of noise, at each trigger";
declare inlets "in; trigger";
declare outlets "out";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Samples a signal at each rising edge of the trigger and holds it until the next one
- Source: the input, or internal noise (random values in [-1, 1], with a clock: stepped random)

*/

process = vgroup("SampleHold", sh);

sh(x, trigger) = select2(source, x, no.noise) : ba.sAndH(gate(trigger) <: _ > _');

gate(x) = loop ~ _ with { loop(p) = (x > 0.6) | ((x > 0.4) & p); };

source = hslider("Source[style:menu{'input':0;'noise':1}]", 0, 0, 1, 1);
