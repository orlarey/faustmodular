declare name "Value";
declare author "GRAME";

/* =============== DESCRIPTION ================

- Shows the value of a signal (a modulation source, a control signal), inserted anywhere: the signal
  goes through unchanged
- The bar covers [-1, 1]; the number is the value itself

*/

process = vgroup("Value", _ <: attach(_, hbargraph("Value", -1, 1)));
