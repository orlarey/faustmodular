// The search of the Modules menu (src/model/LibrarySearch.ts): every word of the query, ignoring case and
// accents, in the name, the Faust functions, the family, the summary or the description; ranked by where
// the words are found (the name first), the order of the library kept within a rank.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { normalize, queryWords, search, searchRank } from "../../src/model/LibrarySearch";

const modules = [
    { name: "Echo", family: "Échos et réverbérations", familyKey: "Echoes and reverbs", description: "A tape echo" },
    { name: "Zita Light", family: "Reverbs", familyKey: "Lib reverbs", description: "From the Faust libraries: dm.zita_light" },
    { name: "SineVCO", family: "Sources", description: "A sine oscillator" },
    { name: "VCO", family: "Sources", description: "Oscillator, four waveforms" },
    { name: "Moog Ladder", family: "Filters", functions: ["ve.moogLadder"], description: "A resonant low-pass" },
    { name: "Flute", family: "Instruments with reverb", description: "A flute" },
];
const names = (q: string) => search(q, modules).map((m) => m.name);

describe("library search", () => {
    it("ignores case and accents", () => {
        expect(normalize("Écho RÉVERB")).toBe("echo reverb");
        expect(queryWords("  zita,  Light ")).toEqual(["zita", "light"]);
        expect(names("ÉCHO")).toEqual(["Echo"]);
        expect(names("réverbérations")).toEqual(["Echo"]);
    });

    it("needs every word", () => {
        expect(names("zita light")).toEqual(["Zita Light"]);
        expect(names("zita echo")).toEqual([]);
        expect(names("")).toEqual([]);
    });

    it("ranks the name first: its beginning, a word of it, inside it; then the functions, the family, the text", () => {
        expect(searchRank("vco", modules[3])).toBe(0);      // VCO
        expect(searchRank("vco", modules[2])).toBe(1);      // Sine|VCO
        expect(names("vco")).toEqual(["VCO", "SineVCO"]);
        expect(searchRank("ladder", modules[4])).toBe(1);
        expect(searchRank("moogladder", modules[4])).toBe(3);   // its function
        expect(searchRank("reverb", modules[1])).toBe(4);      // its family
        expect(searchRank("oscillator", modules[3])).toBe(5);  // its description
        // the module named after the word before those of the family, the library order within a rank
        expect(names("reverb")).toEqual(["Echo", "Zita Light", "Flute"]);
    });

    it("finds the modules of the library by their names, families and Faust functions", () => {
        const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/faust-modules/library-catalog.json"), "utf8"));
        const all = catalog.modules.filter((m: any) => m.family).map((m: any) => ({ ...m, familyKey: m.family }));
        expect(search("zita", all)[0].name).toBe("Zita Light");
        expect(search("moog", all).map((m: any) => m.name)).toEqual(expect.arrayContaining(["Moog VCF", "Moog Ladder"]));
        expect(search("vco", all)[0].name).toBe("VCO");
        expect(search("xyzzy", all)).toEqual([]);
    });
});
