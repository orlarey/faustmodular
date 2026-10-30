// Known libfaust defect (2.90.17, wasm backend, faustwasm 0.19.2): with "-ftz 2", the option the
// application compiles every module with, a recursion driven by a constant outputs zeros.
// `it.fails` passes as long as the defect is there: when this test starts failing, libfaust is fixed.
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

    it.fails("zeroes a recursion driven by a constant (known defect)", async () => {
        const [out] = await renderConstant("ftz", CODE, [], 4, "-ftz 2");
        out.forEach((x, t) => expect(x).toBeCloseTo(EXPECTED[t], 6));
    });
});
