import { describe, expect, it } from "vitest";
import { Patch } from "../../src/model/Patch";
import { isPatchFileV2, parsePatchV2, PatchFormatError, serializePatch } from "../../src/model/PatchFormat";
import { isPatchFileV1 } from "../../src/model/PatchFormatV1";

function samplePatch(): Patch {
    const patch = new Patch();
    patch.addModule({ id: "input", kind: "input", name: "input", numInputs: 0, numOutputs: 2 });
    patch.addModule({ id: "output", kind: "output", name: "output", numInputs: 2, numOutputs: 0 });
    patch.addModule({
        id: "1", name: "Echo", code: "process = _;", x: 10.5, y: 20, numInputs: 1, numOutputs: 1,
        params: { "/Echo/delay": 0.25 },
        acc: [{ address: "/Echo/delay", axis: 0, curve: 1, amin: -10, amid: 0, amax: 10, enabled: true }],
        factory: { code: "AGFzbQ==", json: { inputs: 1, outputs: 1 }, poly: false, shaKey: "abc" },
    });
    patch.connect({ module: "input", port: 1 }, { module: "1", port: 0 });
    patch.connectBus("1", "output");
    patch.connect({ module: "1", port: 0 }, { module: "1", port: 0 });
    return patch;
}

describe("patch file v2", () => {
    it("round-trips through JSON", () => {
        const file = serializePatch(samplePatch(), "Scene", true);
        const { patch, sceneName } = parsePatchV2(JSON.parse(JSON.stringify(file)));
        expect(sceneName).toBe("Scene");
        expect(serializePatch(patch, "Scene", true)).toEqual(file);
        expect(patch.getModule("1")!.factory!.shaKey).toBe("abc");
    });

    it("saves factories only when asked", () => {
        const file = serializePatch(samplePatch(), "Scene");
        expect(file.modules.every((m) => m.factory === undefined)).toBe(true);
    });

    it("is told apart from version 1 files", () => {
        const file = serializePatch(samplePatch(), "Scene");
        expect(isPatchFileV2(file)).toBe(true);
        expect(isPatchFileV1(file)).toBe(false);
        expect(isPatchFileV2({ "1": { patchId: "1" } })).toBe(false);
    });

    it.each([
        ["wrong version", (f: any) => { f.version = 3; }, /unsupported patch version 3/],
        ["missing field", (f: any) => { delete f.modules[2].code; }, /modules\[2\]\.code: string expected/],
        ["unknown kind", (f: any) => { f.modules[2].kind = "midi"; }, /modules\[2\]\.kind: unknown module kind/],
        ["too many channels", (f: any) => { f.modules[2].inputs = 33; }, /modules\[2\]: number of inputs/],
        ["invalid port", (f: any) => { f.connections[0].to.port = 1; }, /connections\[0\]: module 1 has no input 1/],
        ["unknown module", (f: any) => { f.connections[0].from.module = "9"; }, /connections\[0\]: module 9 does not exist/],
        ["duplicate connection", (f: any) => { f.connections.push(f.connections[0]); }, /connections\[4\]: .* already connected/],
        ["non-numeric parameter", (f: any) => { f.modules[2].params["/Echo/delay"] = "0.25"; }, /params\["\/Echo\/delay"\]: number expected/],
    ])("reports errors with their location: %s", (_, corrupt, message) => {
        const file: any = JSON.parse(JSON.stringify(serializePatch(samplePatch(), "Scene")));
        corrupt(file);
        expect(() => parsePatchV2(file)).toThrow(PatchFormatError);
        expect(() => parsePatchV2(file)).toThrow(message);
    });
});
