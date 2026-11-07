// Publishing a scene publishes its modules (src/store/ScenePlan.ts): the modules of the library of faustmodular, and
// those already in the store (the same code, or an older version), are not published; a new one is; a name taken by
// another code (in the store, or in the scene) offers a new version or another name; the files as chosen.
import { describe, expect, it } from "vitest";
import { libraryShas, planFiles, planSceneModules } from "../../src/store/ScenePlan";
import { StoreIndex } from "../../src/store/StoreFormat";

const m = (name: string, sha: string) => ({ name, code: `code of ${name} ${sha}`, sha });
const sha = (c: string) => c.repeat(40);

describe("publishing a scene with its modules", () => {
    const index: StoreIndex = {
        modules: [
            { path: "modules/Drone/Drone.dsp", name: "Drone", summary: "", description: "", functions: [], inlets: [], outlets: [], code: sha("a"), versions: [{ code: sha("b"), commit: sha("c") }] },
            { path: "modules/Filter/Filter.dsp", name: "Filter", summary: "", description: "", functions: [], inlets: [], outlets: [], code: sha("d") },
        ],
        scenes: [],
    };
    const library = libraryShas({ modules: { "faust-modules/modular/VCO.dsp": sha("e") }, history: { [sha("f")]: { path: "faust-modules/modular/ADSR.dsp" } } });

    it("knows the library now and before", () => {
        expect(library.get(sha("e"))).toBe("faust-modules/modular/VCO.dsp");
        expect(library.get(sha("f"))).toBe("faust-modules/modular/ADSR.dsp");
    });

    it("publishes only what is not public yet; a name taken offers a new version or another name", () => {
        const rows = planSceneModules([
            m("VCO", sha("e")),             // the library
            m("ADSR", sha("f")),            // the library, before
            m("Drone", sha("a")),           // the same as the store
            m("Filter", sha("1")),          // the name taken in the store by another code
            m("Lfo", sha("2")),             // new
            m("Lfo", sha("2")),             // the same module twice: once
            m("Lfo", sha("3")),             // another Lfo in the scene
        ], index, library);
        expect(rows.map((r) => [r.name, r.status, r.choice])).toEqual([
            ["VCO", "library", "skip"], ["ADSR", "library", "skip"], ["Drone", "same", "skip"],
            ["Filter", "conflict", "version"], ["Lfo", "new", "publish"], ["Lfo", "conflict", "other"],
        ]);
        expect(rows[3].other).toBe("modules/Filter-2/Filter-2.dsp");
        expect(rows[5]).toMatchObject({ inScene: true, other: "modules/Lfo-2/Lfo-2.dsp" });
        expect([...planFiles(rows).keys()]).toEqual(["modules/Filter/Filter.dsp", "modules/Lfo/Lfo.dsp", "modules/Lfo-2/Lfo-2.dsp"]);
        rows[3].choice = "other";
        rows[5].choice = "skip";
        expect([...planFiles(rows).keys()]).toEqual(["modules/Filter-2/Filter-2.dsp", "modules/Lfo/Lfo.dsp"]);
    });

    it("does not take a module of the store back to an older version, nor replace one the scene also uses", () => {
        const rows = planSceneModules([m("Drone", sha("b")), m("Filter", sha("d")), m("Filter", sha("4"))], index, library);
        expect(rows.map((r) => [r.name, r.status, r.choice])).toEqual([["Drone", "older", "skip"], ["Filter", "same", "skip"], ["Filter", "conflict", "other"]]);
        expect(rows[2].inScene).toBe(true);
        expect([...planFiles(rows).keys()]).toEqual(["modules/Filter-2/Filter-2.dsp"]);
    });
});
