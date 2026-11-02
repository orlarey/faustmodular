// The index of the library (public/faust-modules/library-index.json) gives the hash of each module's
// code: it decides whether an instance is a library module or a user module (status by content).
// Rebuilt by `npm run library-index` when a module of the library changes.
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
// @ts-ignore: a Node.js script
import { currentHashes, libraryCatalog, libraryPaths } from "../../scripts/build-library-index.mjs";
import { sha1 } from "../../src/documents/Sha1";

const root = path.resolve(__dirname, "../..");
const index = JSON.parse(readFileSync(path.join(root, "public/faust-modules/library-index.json"), "utf8"));

describe("library index", () => {
    it("is up to date with the modules of the library (npm run library-index)", () => {
        expect(index.modules).toEqual(currentHashes());
    });

    it("uses the hash of the documents", async () => {
        const [p, hash] = Object.entries(index.modules)[0] as [string, string];
        expect(await sha1(readFileSync(path.join(root, "public", p), "utf8"))).toBe(hash);
    });

    it("keeps past versions apart from the current ones", () => {
        const current = new Set(Object.values(index.modules));
        for (const [hash, past] of Object.entries(index.history) as Array<[string, { path: string }]>) {
            expect(current.has(hash)).toBe(false);
            expect(index.modules[past.path] ?? past.path).toBeTruthy();
        }
    });

    it("has an up to date catalog of the library: every module in one family of its groups", () => {
        const catalog = JSON.parse(readFileSync(path.join(root, "public/faust-modules/library-catalog.json"), "utf8"));
        expect(catalog).toEqual(libraryCatalog());
        expect(catalog.groups.map((g: any) => g.name)).toEqual(["Modular", "FaustPlayground", "Faust libraries"]);
        const families = new Set(catalog.groups.flatMap((g: any) => g.families));
        expect(families.size).toBe(catalog.groups.reduce((n: number, g: any) => n + g.families.length, 0));      // no family twice
        // every module of the library (index.json) once, in a family of the catalog
        const paths = catalog.modules.map((m: any) => m.path);
        expect(new Set(paths).size).toBe(paths.length);
        expect([...paths].sort()).toEqual([...libraryPaths()].sort());
        for (const m of catalog.modules) expect(families.has(m.family), `${m.path}: ${m.family}`).toBe(true);
        // the modular library: functions and descriptions declared
        for (const m of catalog.modules.filter((x: any) => x.path.includes("/modular/"))) {
            expect(m.functions.length, m.path).toBeGreaterThan(0);
            expect(m.description.length, m.path).toBeGreaterThan(0);
        }
        // a FaustPlayground module in its family
        expect(catalog.modules.find((m: any) => m.path.endsWith("/SCMajDryHarp.dsp")).family).toBe("Harps");
        expect(catalog.modules.find((m: any) => m.path.endsWith("/ZitaReverb.dsp")).family).toBe("Echoes and reverbs");
        const vco = catalog.modules.find((m: any) => m.name == "VCO");
        expect(vco).toMatchObject({ family: "Sources", functions: ["Oscillator"], inlets: [], outlets: ["sine", "triangle", "saw", "square"] });
        const vcf = catalog.modules.find((m: any) => m.name == "VCF");
        expect(vcf).toMatchObject({ family: "Timbre", inlets: ["audio"], outlets: ["audio"] });
        // labels of menus without dashes: the JSON of a compiled DSP quotes them with dashes
        for (const m of catalog.modules) {
            const code = readFileSync(path.join(root, "public", m.path), "utf8");
            for (const menu of code.matchAll(/style:(?:menu|radio)\{([^}]*)\}/g)) {
                expect(menu[1], m.path).not.toMatch(/'[^']*-[^']*'/);
            }
        }
    });
});

