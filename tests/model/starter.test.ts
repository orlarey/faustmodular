// The scene of the first visit (src/documents/Starter.ts): a SineVCO to the first two inputs of the output
// module (one on a mono device), not with ?starter=0 nor when faustcode opens faustmodular.
import { describe, expect, it } from "vitest";
import { STARTER_CODE, starterPatch, starterWanted } from "../../src/documents/Starter";
import { PATCH_FORMAT, PATCH_VERSION, PatchFileV2 } from "../../src/model/PatchFormat";

const empty = (outputs: number): PatchFileV2 => ({
    format: PATCH_FORMAT, version: PATCH_VERSION, sceneName: "Untitled", connections: [],
    modules: [
        { id: "output", kind: "output", name: "output", code: "", x: 1200, y: 400, inputs: outputs, outputs: 0, params: {}, acc: [] },
        { id: "input", kind: "input", name: "input", code: "", x: 10, y: 400, inputs: 0, outputs: 2, params: {}, acc: [] },
    ],
});

describe("starter scene", () => {
    it("connects a SineVCO to the left and right outputs", () => {
        const patch = starterPatch(empty(2), { x: 500, y: 300 });
        const sine = patch.modules.find((m) => m.kind == "faust")!;
        expect(sine).toMatchObject({ name: "SineVCO", x: 500, y: 300, inputs: 0, outputs: 1 });
        expect(sine.code).toContain(STARTER_CODE.trim().split("\n")[0]);
        expect(patch.connections).toEqual([
            { from: { module: sine.id, port: 0 }, to: { module: "output", port: 0 } },
            { from: { module: sine.id, port: 0 }, to: { module: "output", port: 1 } },
        ]);
        expect(starterPatch(empty(1), { x: 0, y: 0 }).connections).toHaveLength(1);
        expect(starterPatch(empty(8), { x: 0, y: 0 }).connections).toHaveLength(2);
    });

    it("is wanted at the first visit, not with ?starter=0 nor from faustcode", () => {
        expect(starterWanted("")).toBe(true);
        expect(starterWanted("?starter=0")).toBe(false);
        expect(starterWanted("?link=faustcode&faustcode=x")).toBe(false);
    });
});
