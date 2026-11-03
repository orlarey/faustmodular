// The Orbit interface of a module in the model and the files: the view of a module (the Orbit, its size,
// the layout of its points) through the patch file and the document; the widgets the Orbit shows.
import { describe, expect, it } from "vitest";
import { Patch } from "../../src/model/Patch";
import { parsePatchV2, PatchFormatError, serializePatch } from "../../src/model/PatchFormat";
import { documentFromPatch, parseDocument, patchFromDocument } from "../../src/documents/DocumentFormat";
import { hasOrbitWidgets, orbitDescriptor } from "../../src/Modules/OrbitPanel";

const VIEW = { orbit: { width: 400, height: 380, state: { zoom: 120, center: { x: 1, y: 2 }, controls: { "/m/a": { x: 3, y: 4 } } } } };

function patch(): Patch {
    const p = new Patch();
    p.addModule({ id: "input", kind: "input", name: "input", numInputs: 0, numOutputs: 2 });
    p.addModule({ id: "output", kind: "output", name: "output", numInputs: 2, numOutputs: 0 });
    p.addModule({ id: "1", name: "Echo", code: "process = _;", numInputs: 1, numOutputs: 1, view: VIEW });
    p.addModule({ id: "2", name: "Gain", code: "process = _;", numInputs: 1, numOutputs: 1 });
    return p;
}

describe("the view of a module in the files", () => {
    it("goes through the patch file, absent for the classic interface", () => {
        const file = serializePatch(patch(), "Scene");
        expect(file.modules.find((m) => m.id == "1")!.view).toEqual(VIEW);
        expect("view" in file.modules.find((m) => m.id == "2")!).toBe(false);
        const back = parsePatchV2(JSON.parse(JSON.stringify(file))).patch;
        expect(back.getModule("1")!.view).toEqual(VIEW);
        expect(back.getModule("2")!.view).toBeUndefined();
    });

    it("is checked when read", () => {
        const file: any = serializePatch(patch(), "Scene");
        file.modules.find((m: any) => m.id == "1").view = { orbit: { width: "big", height: 300 } };
        expect(() => parsePatchV2(file)).toThrow(PatchFormatError);
        expect(() => parsePatchV2(file)).toThrow(/modules\[2\]\.view\.orbit\.width/);
    });

    it("goes through the document", async () => {
        const file = serializePatch(patch(), "Doc");
        const { document, codes } = await documentFromPatch(file, "Doc", { libfaust: "x", libraries: null });
        expect(document.instances.find((i) => i.id == "1")!.view).toEqual(VIEW);
        const back = patchFromDocument(parseDocument(JSON.parse(JSON.stringify(document))), (h) => codes.get(h));
        expect(back.modules.find((m) => m.id == "1")!.view).toEqual(VIEW);
        expect(back.modules.find((m) => m.id == "2")!.view).toBeUndefined();
        const bad: any = JSON.parse(JSON.stringify(document));
        bad.instances[0].view = { orbit: { width: 1 } };
        expect(() => parseDocument(bad)).toThrow(/view\.orbit\.height/);
    });
});

describe("the widgets the Orbit shows", () => {
    const ui: any[] = [{
        type: "vgroup", label: "m", items: [
            { type: "hslider", label: "a", address: "/m/a", init: 0, min: 0, max: 1, step: 0.01 },
            { type: "button", label: "gate", address: "/m/gate" },
            { type: "hslider", label: "hid", address: "/m/hid", meta: [{ hidden: "1" }], init: 0, min: 0, max: 1, step: 0.01 },
            { type: "hslider", label: "depth a", address: "/m/depth_a", meta: [{ modulation: "a" }], init: 0, min: -1, max: 1, step: 0.01 },
            { type: "hbargraph", label: "level", address: "/m/level", min: 0, max: 1 },
            { type: "hbargraph", label: "driven", address: "/m/driven", meta: [{ driven: "gate" }, { hidden: "1" }], min: 0, max: 1 },
            { type: "hgroup", label: "displays", items: [{ type: "vbargraph", label: "v", address: "/m/displays/v", min: 0, max: 1 }] },
        ],
    }];

    it("the input widgets of the user: not the hidden ones, the depths of the modulations, the bargraphs", () => {
        const kept = orbitDescriptor(ui);
        expect(kept).toHaveLength(1);
        expect(kept[0].items!.map((w) => w.address)).toEqual(["/m/a", "/m/gate"]);
        expect(hasOrbitWidgets(ui)).toBe(true);
    });

    it("none for a display or a module without settings", () => {
        expect(hasOrbitWidgets([{ type: "vgroup", label: "scope", items: [{ type: "hbargraph", label: "x", address: "/s/x" } as any] }])).toBe(false);
        expect(hasOrbitWidgets([])).toBe(false);
    });
});
