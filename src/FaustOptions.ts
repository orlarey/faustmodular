/*				FAUSTOPTIONS.TS
    Options passed to the Faust compiler for every module (application and tests).

    "-ftz 1": the values of every recursion are flushed to zero when |x| <= FLT_MIN (a comparison). Without
    flushing, the decaying tails of the recursions go through denormals, very slow: of the 217 library modules,
    52 are at least twice as slow after an impulse, up to 73 times (EllipticFilter).

    "-ftz 2" (a test of the exponent bits) flushes the denormals as well, and is a little faster (4.6 % less time
    on the library, geometric mean; up to 25 % on the heaviest physical models), but it keeps the NaN and the
    infinities of the recursions: a single NaN reaching a recursion (a setting driven by a signal gone wrong, a
    cycle of cables) silences the module for ever. "-ftz 1" flushes a NaN to 0 as well (a comparison with NaN is
    false): the module recovers at the next sample. In a modular environment, that robustness is worth more than
    the 5 %: "-ftz 1" is kept (comparison of 3.40.1, faustwasm 0.19.6; tests/faust/ftz.test.ts).

    "-ftz 2" also had a defect in libfaust 2.90.17 (recursions driven by a constant zeroed, grame-cncm/faust#1371),
    fixed in 2.90.19 (faustwasm 0.19.6).
*/

export const FAUST_COMPILE_OPTIONS = "-ftz 1";
