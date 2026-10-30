// Widget modulations in the patch model, the file format and the export.
import { describe, expect, it } from "vitest";
import { exportFaust } from "../../src/export/FaustExporter";
import { ModulationSpec } from "../../src/model/Modulation";
import { Connection, Patch, PatchError, PatchEvent, totalInputs } from "../../src/model/Patch";
import { parsePatchV2, PatchFormatError, serializePatch } from "../../src/model/PatchFormat";
import { renderConstant } from "../helpers/faust";

const spec = (target: string, mode: ModulationSpec["mode"] = "modulate"): ModulationSpec => ({ target, mode, min: 0, max: 1, exponential: false });
const port = (module: string, p: number) => ({ module, port: p });
const pairs = (connections: Connection[]) => connections.map((c) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`).sort();

function makePatch(): Patch {
    const patch = new Patch();
    patch.addModule({ id: "output", kind: "output", name: "output", numInputs: 2, numOutputs: 0 });
    patch.addModule({ id: "lfo", name: "LFO", code: "process = 0.5;", numInputs: 0, numOutputs: 1 });
    patch.addModule({ id: "fx", name: "FX", code: 'process = *(hslider("gain", 0.5, 0, 1, 0.01)), _;', numInputs: 2, numOutputs: 2 });
    return patch;
}

describe("modulations in the model", () => {
    it("give each modulated widget an input port after the audio inputs", () => {
        const patch = makePatch();
        const gain = patch.addModulation("fx", "/FX/gain", spec("gain"));
        const level = patch.addModulation("fx", "/FX/level", spec("level", "scale"));
        const fx = patch.getModule("fx")!;
        expect(totalInputs(fx)).toBe(4);
        expect([patch.modulationPort("fx", gain.id), patch.modulationPort("fx", level.id)]).toEqual([2, 3]);
        expect(patch.modulationAt("fx", 3)).toBe(level);
        expect(patch.modulationAt("fx", 1)).toBeUndefined();
        patch.connect(port("lfo", 0), port("fx", 3));
        expect(() => patch.connect(port("lfo", 0), port("fx", 4))).toThrow(/no input 4/);
    });

    it("allow one modulation per widget, on Faust modules only, within 32 inputs", () => {
        const patch = makePatch();
        patch.addModulation("fx", "/FX/gain", spec("gain"));
        expect(() => patch.addModulation("fx", "/FX/gain", spec("gain", "scale"))).toThrow(/already modulated/);
        expect(() => patch.addModulation("output", "/x", spec("x"))).toThrow(PatchError);
        patch.addModule({ id: "big", name: "Big", numInputs: 31, numOutputs: 1 });
        patch.addModulation("big", "/Big/a", spec("a"));
        expect(() => patch.addModulation("big", "/Big/b", spec("b"))).toThrow(/between 0 and 32/);
    });

    it("renumber the following modulation ports when a modulation is removed", () => {
        const patch = makePatch();
        const gain = patch.addModulation("fx", "/FX/gain", spec("gain"));
        patch.addModulation("fx", "/FX/level", spec("level"));
        patch.connect(port("lfo", 0), port("fx", 2));
        patch.connect(port("lfo", 0), port("fx", 3));
        patch.connect(port("lfo", 0), port("fx", 0));
        const events: string[] = [];
        patch.subscribe((e: PatchEvent) => events.push(e.type));
        expect(pairs(patch.removeModulation("fx", gain.id))).toEqual(["lfo:0>fx:2"]);
        expect(pairs(patch.getConnections())).toEqual(["lfo:0>fx:0", "lfo:0>fx:2"]);    // level moved from 3 to 2
        expect(patch.getModule("fx")!.modulations.map((m) => m.widget)).toEqual(["/FX/level"]);
        expect(events).toEqual(["connectionRemoved", "connectionRemoved", "modulationsChanged", "connectionAdded"]);
    });

    it("move the modulation ports with the audio inputs when the arity changes", () => {
        const patch = makePatch();
        patch.addModulation("fx", "/FX/gain", spec("gain"));
        patch.connect(port("lfo", 0), port("fx", 1));       // audio input 1
        patch.connect(port("lfo", 0), port("fx", 2));       // modulation
        patch.setArity("fx", 3, 2);
        expect(pairs(patch.getConnections())).toEqual(["lfo:0>fx:1", "lfo:0>fx:3"]);
        const removed = patch.setArity("fx", 1, 2);
        expect(pairs(removed)).toEqual(["lfo:0>fx:1"]);
        expect(pairs(patch.getConnections())).toEqual(["lfo:0>fx:1"]);                 // the modulation, now on port 1
        expect(patch.modulationAt("fx", 1)!.widget).toBe("/FX/gain");
    });

    it("treat a module modulating its own widget as a feedback loop", () => {
        const patch = makePatch();
        patch.addModulation("fx", "/FX/gain", spec("gain"));
        const loop = patch.connect(port("fx", 0), port("fx", 2));
        expect(patch.analyze().feedback).toEqual(new Set([loop.id]));
    });
});

describe("modulations in patch files", () => {
    it("are saved in version 3 and read back", () => {
        const patch = makePatch();
        patch.addModulation("fx", "/FX/gain", { target: "gain", mode: "modulate", min: 0, max: 1, exponential: false });
        patch.connect(port("lfo", 0), port("fx", 2));
        const file = serializePatch(patch, "S");
        expect(file.version).toBe(3);
        expect(file.modules.find((m) => m.id == "fx")!.modulations).toEqual([{ widget: "/FX/gain", target: "gain", mode: "modulate", min: 0, max: 1, exponential: false }]);
        const back = parsePatchV2(JSON.parse(JSON.stringify(file))).patch;
        expect(serializePatch(back, "S")).toEqual(file);
        expect(back.modulationAt("fx", 2)!.spec.target).toBe("gain");
    });

    it("stay in version 2 without modulation, and reject unknown modes", () => {
        expect(serializePatch(makePatch(), "S").version).toBe(2);
        const patch = makePatch();
        patch.addModulation("fx", "/FX/gain", spec("gain"));
        const file: any = JSON.parse(JSON.stringify(serializePatch(patch, "S")));
        file.modules.find((m: any) => m.id == "fx").modulations[0].mode = "ring";
        expect(() => parsePatchV2(file)).toThrow(PatchFormatError);
        expect(() => parsePatchV2(file)).toThrow(/modulations\[0\]\.mode/);
    });
});

describe("modulations in the export", () => {
    it("export the effective code of the modulated modules", async () => {
        const patch = makePatch();
        patch.addModulation("fx", "/FX/gain", { target: "gain", mode: "scale", min: 0, max: 1, exponential: false });
        patch.addModule({ id: "one", name: "One", code: "process = 1, 3;", numInputs: 0, numOutputs: 2 });
        patch.connect(port("one", 0), port("fx", 0));
        patch.connect(port("one", 1), port("fx", 1));
        patch.connect(port("lfo", 0), port("fx", 2));       // gain × 0.5
        patch.connect(port("fx", 0), port("output", 0));
        patch.connect(port("fx", 1), port("output", 1));
        const exported = exportFaust(patch, { name: "Mod" });
        const [left, right] = await renderConstant("export", exported.code, [], 2);
        expect(left[1]).toBeCloseTo(1 * 0.5 * 0.5, 6);
        expect(right[1]).toBeCloseTo(3, 6);
    });
});
