/*				FAUSTOPTIONS.TS
    Options passed to the Faust compiler for every module (application and tests).

    "-ftz 1" flushes denormals to zero with a comparison. "-ftz 2" (bit mask, used up to 1.7.1)
    was avoided: with libfaust 2.90.17 it zeroed recursions driven by a constant, which silenced
    or altered several library modules. Fixed in libfaust 2.90.19 (faustwasm 0.19.6), see
    tests/faust/ftz.test.ts; "-ftz 1" is kept, as all the tests and examples are made with it.
*/

export const FAUST_COMPILE_OPTIONS = "-ftz 1";
