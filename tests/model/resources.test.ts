import { describe, expect, it } from "vitest";
import {
    NO_PROVENANCE, Provenance, Resource, compareIds, findReusable, migrateInstances, renameAddress, renameInstance,
    resourceFileName, sameSource, uniqueName, unusedResources,
} from "../../src/model/Resources";

const builtin = (path: string): Provenance => ({ kind: "builtin", path });
const res = (name: string, code: string, provenance: Provenance = NO_PROVENANCE): Resource => ({ name, code, wrapped: true, provenance });

describe("resources", () => {
    it("gives a name not taken", () => {
        expect(uniqueName("VCO", [])).toBe("VCO");
        expect(uniqueName("VCO", ["VCO"])).toBe("VCO-2");
        expect(uniqueName("VCO", ["VCO", "VCO-2", "VCO-3"])).toBe("VCO-4");
    });

    it("gives a file name OPFS can hold, unique without case", () => {
        expect(resourceFileName("VCO")).toBe("VCO.dsp");
        expect(resourceFileName("A/B:C")).toBe("A_B_C.dsp");
        expect(resourceFileName("..")).toBe("_...dsp");
        expect(resourceFileName("vco", ["VCO.dsp"])).toBe("vco-2.dsp");
        expect(resourceFileName("   ")).toBe("module.dsp");
    });

    it("compares sources whatever their version, never for codes written here", () => {
        expect(sameSource(builtin("a.dsp"), builtin("a.dsp"))).toBe(true);
        expect(sameSource(builtin("a.dsp"), builtin("b.dsp"))).toBe(false);
        expect(sameSource({ kind: "user", module: "u1", version: "x" }, { kind: "user", module: "u1", version: "y" })).toBe(true);
        expect(sameSource({ kind: "store", store: "o/r", path: "m/A.dsp", commit: "1" }, { kind: "store", store: "o/r", path: "m/A.dsp", commit: "2" })).toBe(true);
        expect(sameSource(NO_PROVENANCE, NO_PROVENANCE)).toBe(false);
    });

    it("reuses a resource of the same source and the same code only", () => {
        const resources = [res("VCO", "c1", builtin("VCO.dsp")), res("VCO-2", "c2", builtin("VCO.dsp")), res("Mine", "c1")];
        expect(findReusable(resources, builtin("VCO.dsp"), "c2")?.name).toBe("VCO-2");
        expect(findReusable(resources, builtin("VCO.dsp"), "c3")).toBeUndefined();
        expect(findReusable(resources, NO_PROVENANCE, "c1")).toBeUndefined();
    });

    it("renames the addresses of an instance with its group", () => {
        expect(renameAddress("/VCO/VCO/freq", "VCO", "VCO-2")).toBe("/VCO-2/VCO/freq");
        expect(renameAddress("/Other/freq", "VCO", "VCO-2")).toBe("/Other/freq");
        expect(renameAddress("/VCOX/freq", "VCO", "VCO-2")).toBe("/VCOX/freq");
        const renamed = renameInstance({ params: { "/VCO/freq": 440 }, acc: [{ address: "/VCO/freq", axis: 0 }], modulations: [{ widget: "/VCO/freq", mode: "modulate" }] }, "VCO", "V");
        expect(renamed).toEqual({ params: { "/V/freq": 440 }, acc: [{ address: "/V/freq", axis: 0 }], modulations: [{ widget: "/V/freq", mode: "modulate" }] });
    });

    it("orders ids: numbers by value, then the others", () => {
        expect(["10", "b", "2", "a", "1"].sort(compareIds)).toEqual(["1", "2", "10", "a", "b"]);
    });

    it("migrates format 4: one resource per name and code, the names taken by other codes suffixed in the order of the ids", () => {
        const inst = (id: string, name: string, code: string, freq = 1) => ({ id, name, code, wrapped: true, x: 0, y: 0, params: { [`/${name}/freq`]: freq }, acc: [], modulations: [{ widget: `/${name}/freq` }] });
        const { resources, instances } = migrateInstances(
            [inst("10", "VCO", "B", 3), inst("2", "VCO", "A", 1), inst("3", "VCO", "A", 2), inst("4", "VCF", "C")],
            (code) => (code == "A" ? builtin("VCO.dsp") : NO_PROVENANCE),
        );
        expect(resources).toEqual([
            { name: "VCO", code: "A", wrapped: true, provenance: builtin("VCO.dsp") },
            { name: "VCF", code: "C", wrapped: true, provenance: NO_PROVENANCE },
            { name: "VCO-2", code: "B", wrapped: true, provenance: NO_PROVENANCE },
        ]);
        expect(instances.map((i) => [i.id, i.resource, i.params])).toEqual([
            ["10", "VCO-2", { "/VCO-2/freq": 3 }],
            ["2", "VCO", { "/VCO/freq": 1 }],
            ["3", "VCO", { "/VCO/freq": 2 }],
            ["4", "VCF", { "/VCF/freq": 1 }],
        ]);
        expect(instances[0].modulations).toEqual([{ widget: "/VCO-2/freq" }]);
        expect(instances[0]).not.toHaveProperty("code");
        expect(instances[0]).not.toHaveProperty("name");
    });

    it("migrates a code not wrapped without renaming its addresses", () => {
        const { resources, instances } = migrateInstances([
            { id: "1", name: "Old", code: "A", wrapped: false, params: { "/X/g": 1 }, acc: [] },
            { id: "2", name: "Old", code: "B", wrapped: false, params: { "/Y/g": 1 }, acc: [] },
        ]);
        expect(resources.map((r) => r.name)).toEqual(["Old", "Old-2"]);
        expect(instances.map((i) => i.params)).toEqual([{ "/X/g": 1 }, { "/Y/g": 1 }]);
    });

    it("finds the resources no instance uses", () => {
        expect(unusedResources([res("A", "1"), res("B", "2")], [{ resource: "A" }]).map((r) => r.name)).toEqual(["B"]);
    });
});
