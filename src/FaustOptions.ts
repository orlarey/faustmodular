/*				FAUSTOPTIONS.TS
    Options passed to the Faust compiler for every module (application and tests).

    "-ftz 1" flushes denormals to zero with a comparison. "-ftz 2" (bit mask, used up to 1.7.1)
    is avoided: with libfaust 2.90.17 it zeroes recursions driven by a constant, which silenced
    or altered several library modules (see tests/faust/ftz.test.ts).
*/

export const FAUST_COMPILE_OPTIONS = "-ftz 1";
