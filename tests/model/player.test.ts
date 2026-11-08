// The player (src/model/Player.ts): its code compiles, with its reserved inputs of faust-sync, its soundfile and its
// controls; its trace (uses).
import { describe, expect, it } from "vitest";
import { playerCode, usesOf } from "../../src/model/Player";
import { syncInputs } from "../../src/sync/SyncInputs";
import { compileJson } from "../helpers/faust";

const source = { name: "Nappe-1", url: "https://raw.githubusercontent.com/o/r/abc/materials/Nappe-1/Nappe-1.flac", channels: 2, bars: 4, bar: 3, store: "o/r", path: "materials/Nappe-1/Nappe-1.json", sha1: "a".repeat(40) };

describe("the player", () => {
    it("compiles: 4 reserved inputs (bar, index, run, start), its channels out, its soundfile, its controls", async () => {
        const code = playerCode(source);
        expect(syncInputs(code)).toEqual([7, 5, 1, 2]);
        const json = await compileJson("Player", code);
        expect(json.inputs).toBe(4);
        expect(json.outputs).toBe(2);
        const items: any[] = [];
        const walk = (ui: any[]) => ui.forEach((x) => (x.items ? walk(x.items) : items.push(x)));
        walk(json.ui);
        expect(items.map((x) => [x.type, x.label]).filter(([t]) => t != "soundfile")).toEqual([["nentry", "Bar"], ["checkbox", "Loop"], ["hslider", "Gain"]]);
        // the soundfile and its address (faustwasm reads it as {'<url>'})
        expect(items.find((x) => x.type == "soundfile").url).toContain(source.url);
        expect(items.find((x) => x.label == "Bar").init).toBe(3);
    });

    it("plays mono and 8 channels; its trace", async () => {
        expect((await compileJson("P1", playerCode({ ...source, channels: 1 }))).outputs).toBe(1);
        expect((await compileJson("P8", playerCode({ ...source, channels: 8 }))).outputs).toBe(8);
        expect(usesOf(playerCode(source))).toBe("o/r:materials/Nappe-1/Nappe-1.json");
        expect(usesOf("process = _;")).toBeNull();
    });
});
