// libfaust defect of 2.90.17 (wasm backend, faustwasm 0.19.2), fixed in 2.90.19 (faustwasm 0.19.6):
// with "-ftz 2" (the option used by the application up to 1.7.1), a recursion driven by a constant
// output zeros. The application compiles with "-ftz 1" since 2.0.0 (src/FaustOptions.ts); this test
// now guards against a regression.
import { describe, expect, it } from "vitest";
import { renderConstant } from "../helpers/faust";

const CODE = "process = (0.3, _ : -) ~ *(0.5);";       // y = 0.3 - 0.5 y'
const EXPECTED = [0.3, 0.15, 0.225, 0.1875];

describe("libfaust -ftz 2", () => {
    it("is correct without -ftz and with -ftz 1", async () => {
        for (const options of ["", "-ftz 1"]) {
            const [out] = await renderConstant("ftz", CODE, [], 4, options);
            out.forEach((x, t) => expect(x).toBeCloseTo(EXPECTED[t], 6));
        }
    });

    it("is correct with -ftz 2 (defect of libfaust 2.90.17, fixed in 2.90.19)", async () => {
        const [out] = await renderConstant("ftz", CODE, [], 4, "-ftz 2");
        out.forEach((x, t) => expect(x).toBeCloseTo(EXPECTED[t], 6));
    });
});
