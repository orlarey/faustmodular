// The code of a module: the user's code wrapped in a group named after the module.
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { rewrapModuleCode, unwrapModuleCode, userCode, userError, wrapModuleCode } from "../../src/model/ModuleCode";
import { FAUST_COMPILE_OPTIONS } from "../../src/FaustOptions";
import { compileJson, getCompiler } from "../helpers/faust";

const USER = `import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01));`;

// The error message of the application (App.compileFaust: String(error)) for a code that does not compile.
async function compileError(code: string): Promise<string> {
    try {
        await new fw.FaustMonoDspGenerator().compile(await getCompiler(), "FaustDSP", code, FAUST_COMPILE_OPTIONS);
    } catch (e) {
        return String(e);
    }
    throw new Error("compiled");
}

describe("module code", () => {
    it("wraps and unwraps the user's code", async () => {
        const wrapped = wrapModuleCode("Gain", USER);
        expect(unwrapModuleCode(wrapped)).toEqual({ name: "Gain", code: USER });
        expect(userCode(wrapped)).toBe(USER);
        // the parameters get the address of the module's group
        const json = await compileJson("m", wrapped);
        expect(json.ui[0].label).toBe("Gain");
        expect(json.ui[0].items[0].address).toBe("/Gain/gain");
    });

    it("unwraps the codes of the 1.x files (wrapped without line breaks)", () => {
        const old = `process = vgroup("Echo",environment{${USER}}.process);`;
        expect(unwrapModuleCode(old)).toEqual({ name: "Echo", code: USER });
        expect(unwrapModuleCode(`process = _;`)).toBeNull();
        expect(userCode(`process = _;`)).toBe(`process = _;`);
    });

    it("keeps a final line comment from swallowing the closing brace", async () => {
        const json = await compileJson("m", wrapModuleCode("C", "process = _; // the end"));
        expect(json.inputs).toBe(1);
    });

    it("rewraps edited code in the group of the module (as it is if it was not wrapped)", () => {
        const current = `process = vgroup("Echo",environment{${USER}}.process);`;
        expect(rewrapModuleCode(current, "process = _;")).toBe(wrapModuleCode("Echo", "process = _;"));
        expect(rewrapModuleCode("process = _;", "process = *(2);")).toBe("process = *(2);");
    });

    it("gives the errors with the line numbers of the user's code", async () => {
        // syntax error on line 3 of the user's code
        const error = await compileError(wrapModuleCode("M", `import("stdfaust.lib");\nprocess = _;\nfoo = ;`));
        expect(error).toMatch(/FaustDSP:4/);
        expect(userError(error)).toMatch(/^line 3 : ERROR/);
    });
});
