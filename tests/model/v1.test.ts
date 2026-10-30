// Migration of the version 1 example patches (public/json/) to the multi-I/O model.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { busPairs } from "../../src/model/Patch";
import { parsePatchV2, serializePatch } from "../../src/model/PatchFormat";
import { Arity, isPatchFileV1, migrateV1, precompiledArity, readV1, V1Draft } from "../../src/model/PatchFormatV1";
import { compileJson } from "../helpers/faust";

const examplesDir = path.resolve(__dirname, "../../public/json");
const examples = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".json")).sort();
const load = (file: string) => JSON.parse(fs.readFileSync(path.join(examplesDir, file), "utf8"));

// Arity of every module of a draft that compiles, obtained by compiling its code (as the application will).
async function compileArities(draft: V1Draft): Promise<Map<string, Arity>> {
    const arities = new Map<string, Arity>();
    for (const m of draft.modules) {
        try {
            const json = await compileJson(m.name, m.code);
            arities.set(m.id, { numInputs: json.inputs, numOutputs: json.outputs });
        } catch (e) {
            // left out: migrateV1 must drop the module
        }
    }
    return arities;
}

// Modules of the examples that no longer compile with the current Faust libraries
// (they import instrument.lib or reduce.lib, removed from Faust): already unusable in 1.x.
const brokenModules: Record<string, string[]> = {
    "patch_big.json": ["2", "4", "5", "10"],
    "patch_big_precompile.json": ["2", "4", "5", "10"],
};

describe("version 1 reader", () => {
    it("recognises all the examples as version 1 files", () => {
        expect(examples).toHaveLength(8);
        examples.forEach((f) => expect(isPatchFileV1(load(f)), f).toBe(true));
    });

    it("reads modules, positions, parameters and deduplicated links", () => {
        const draft = readV1(load("patch_light.json"));
        expect(draft.modules.map((m) => [m.id, m.name])).toEqual([["1", "Echo"], ["2", "SOscillator"], ["3", "Volume"]]);
        expect(draft.links).toEqual([{ from: "2", to: "1" }, { from: "1", to: "3" }, { from: "3", to: "output" }]);
        expect(draft.modules[0].params["/Echo/Echo_Delay"]).toBe(0.5);
        expect(typeof draft.modules[0].x).toBe("number");
    });

    it("converts numbers saved as strings and accelerometer mappings", () => {
        const draft = readV1(load("Small_Exemple_Precompile.json"));
        const harp = draft.modules[0];
        expect(harp.params["/SAtonalSoftHarp/0x00/Instrument_Hand"]).toBe(10);
        expect(harp.acc[0]).toEqual({
            address: "/SAtonalSoftHarp/0x00/Instrument_Hand", axis: 0, curve: 1, amin: -10, amid: 0, amax: 10, enabled: true,
        });
        expect(draft.sceneName).toBe("Small_Exemple");
    });

    it("keeps faustwasm factories and drops obsolete asm.js ones with a warning", () => {
        const recent = readV1(load("Big_Exemple_Precompile.json"));
        expect(recent.modules.every((m) => m.factory !== undefined)).toBe(true);
        expect(recent.warnings).toEqual([]);
        const old = readV1(load("patch_big_precompile.json"));
        expect(old.modules.every((m) => m.factory === undefined)).toBe(true);
        expect(old.warnings).toHaveLength(old.modules.length);
    });
});

describe.each(examples)("migration of %s", (file) => {
    it("turns each v1 link into a bus connection and round-trips as v2", async () => {
        const draft = readV1(load(file));
        const arities = await compileArities(draft);

        // Precompiled factories, when present, agree with the compiled code.
        for (const m of draft.modules) {
            const precompiled = precompiledArity(m);
            if (precompiled) expect(precompiled, `${file} module ${m.id}`).toEqual(arities.get(m.id));
        }

        const broken = brokenModules[file] ?? [];
        expect(draft.modules.filter((m) => !arities.has(m.id)).map((m) => m.id)).toEqual(broken);

        const { patch, warnings } = migrateV1(draft, (m) => arities.get(m.id));
        const dropped = warnings.slice(draft.warnings.length);
        broken.forEach((id) => expect(dropped.some((w) => w.startsWith(`module ${id} `)), `warning for module ${id}`).toBe(true));
        expect(dropped.filter((w) => !w.startsWith("link ") && !broken.some((id) => w.startsWith(`module ${id} `)))).toEqual([]);
        expect(patch.getModules()).toHaveLength(draft.modules.length - broken.length + 2);
        const links = draft.links.filter(({ from, to }) => patch.getModule(from) && patch.getModule(to));

        // Exactly the cyclic-rule connections for each link, nothing else.
        const expected = links.flatMap(({ from, to }) =>
            busPairs(patch.getModule(from)!.numOutputs, patch.getModule(to)!.numInputs).map(([i, j]) => `${from}:${i}>${to}:${j}`));
        const actual = patch.getConnections().map((c) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`);
        expect(actual.sort()).toEqual(expected.sort());

        // Every module whose chain to the output is intact still reaches it.
        expect(patch.analyze().feedback.size).toBe(0);
        const reached = new Set(["output"]);
        for (let changed = true; changed;) {
            changed = false;
            for (const c of patch.getConnections()) {
                if (reached.has(c.to.module) && !reached.has(c.from.module)) {
                    reached.add(c.from.module);
                    changed = true;
                }
            }
        }
        const intact = (id: string): boolean => id == "output" ||
            (patch.getModule(id) !== undefined && draft.links.filter((l) => l.from == id).every((l) => intact(l.to)));
        draft.modules.filter((m) => intact(m.id)).forEach((m) => expect(reached.has(m.id), `${file} module ${m.id}`).toBe(true));

        const v2 = serializePatch(patch, draft.sceneName, true);
        expect(serializePatch(parsePatchV2(JSON.parse(JSON.stringify(v2))).patch, draft.sceneName, true)).toEqual(v2);
    }, 120_000);
});

describe("migration edge cases", () => {
    it("drops modules of unknown arity and their links, with warnings", () => {
        const draft = readV1(load("patch_light.json"));
        const { patch, warnings } = migrateV1(draft, (m) => m.id == "2" ? undefined : { numInputs: 1, numOutputs: 1 });
        expect(patch.getModule("2")).toBeUndefined();
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toMatch(/module 2 .* dropped/);
        expect(warnings[1]).toMatch(/link 2 -> 1: unknown module/);
    });

    it("sizes the physical I/O modules from the hardware", () => {
        const draft = readV1(load("Small_Exemple.json"));
        const { patch } = migrateV1(draft, () => ({ numInputs: 1, numOutputs: 1 }), { inputs: 1, outputs: 8 });
        expect(patch.getInputModule()).toMatchObject({ numInputs: 0, numOutputs: 1 });
        expect(patch.getOutputModule()).toMatchObject({ numInputs: 8, numOutputs: 0 });
        // a mono module feeding the 8-channel output is spread over the 8 channels
        expect(patch.connectionsTo("output")).toHaveLength(8);
    });

    it("reads an empty v1 patch", () => {
        const { patch } = migrateV1(readV1({}), () => undefined);
        expect(patch.getModules().map((m) => m.kind)).toEqual(["input", "output"]);
    });
});
