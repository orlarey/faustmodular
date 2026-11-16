// Documents in a memory store: format version 4, committed and working copies, names, trash,
// codes and environments (src/documents/).
import { describe, expect, it } from "vitest";
import { DocumentStore } from "../../src/documents/DocumentStore";
import { documentContent, documentFromPatch, parseDocument, patchFromDocument } from "../../src/documents/DocumentFormat";
import { MemoryStore } from "../../src/documents/FileStore";
import { sha1 } from "../../src/documents/Sha1";
import { wrapModuleCode } from "../../src/model/ModuleCode";
import { PatchFileV2 } from "../../src/model/PatchFormat";

const faust = { libfaust: "2.90.19", libraries: null };

function patch(code = 'import("stdfaust.lib");\nprocess = os.osc(440);'): PatchFileV2 {
    return {
        format: "faustplayground-patch", version: 3, sceneName: "Test",
        modules: [
            { id: "input", kind: "input", name: "input", code: "", x: 10, y: 400, inputs: 0, outputs: 1, params: {}, acc: [] },
            { id: "output", kind: "output", name: "output", code: "", x: 1300, y: 400, inputs: 2, outputs: 0, params: {}, acc: [] },
            { id: "2", kind: "faust", name: "Volume", code: wrapModuleCode("Volume", "process = *(hslider(\"v\",0.5,0,1,0.01));"), x: 300, y: 50, inputs: 1, outputs: 1, params: { "/Volume/v": 0.25 }, acc: [] },
            {
                id: "1", kind: "faust", name: "Osc", code: wrapModuleCode("Osc", code), x: 100, y: 50, inputs: 0, outputs: 1, params: {}, acc: [],
                modulations: [{ widget: "/Osc/f", target: "/Osc/f", mode: "modulate", min: 0, max: 1, exponential: false }],
            },
            { id: "3", kind: "faust", name: "Raw", code: "process = _;", x: 500, y: 50, inputs: 1, outputs: 1, params: {}, acc: [] },
        ],
        connections: [
            { from: { module: "2", port: 0 }, to: { module: "output", port: 0 } },
            { from: { module: "1", port: 0 }, to: { module: "2", port: 0 } },
        ],
    };
}

describe("document format 5", () => {
    it("replaces the codes by their hashes, unwrapped, in resources, and converts back to the same patch", async () => {
        const { document, codes } = await documentFromPatch(patch(), "Doc", faust);
        expect(document.version).toBe(5);
        expect(document.instances.map((i) => [i.id, i.resource])).toEqual([["1", "Osc"], ["2", "Volume"], ["3", "Raw"]]);  // in the order of the ids
        expect(document.io).toEqual({ input: { x: 10, y: 400 }, output: { x: 1300, y: 400 } });
        expect(document.connections).toEqual(["1:0>2:0", "2:0>output:0"]);
        expect(document.resources.map((r) => [r.name, r.file, r.wrapped])).toEqual([["Osc", "Osc.dsp", true], ["Raw", "Raw.dsp", false], ["Volume", "Volume.dsp", true]]);
        const osc = document.resources[0];
        expect(codes.get(osc.code)).toBe('import("stdfaust.lib");\nprocess = os.osc(440);');
        expect(osc.code).toBe(await sha1('import("stdfaust.lib");\nprocess = os.osc(440);'));
        expect(codes.get(document.resources[1].code)).toBe("process = _;");                // not in the wrapped form: as it is

        const back = patchFromDocument(parseDocument(JSON.parse(JSON.stringify(document))), (h) => codes.get(h));
        const original = patch();
        const byId = (p: PatchFileV2) => Object.fromEntries(p.modules.map((m) => [m.id, { ...m, outputs: m.kind == "faust" ? m.outputs : 0, inputs: m.kind == "faust" ? m.inputs : 0 }]));
        expect(byId(back)).toEqual(byId(original));
        expect(back.connections.map((c) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`).sort()).toEqual(["1:0>2:0", "2:0>output:0"]);
        expect(back.version).toBe(4);
        expect(back.resources!.map((r) => r.name)).toEqual(["Osc", "Raw", "Volume"]);
    });

    it("shares a resource among the instances of the same name and code; a name held by two codes is suffixed", async () => {
        const file = patch();
        const volume = file.modules.find((m) => m.id == "2")!;
        file.modules.push({ ...volume, id: "4", params: { "/Volume/v": 0.75 } });
        file.modules.push({ ...volume, id: "5", code: wrapModuleCode("Volume", "process = *(0.5);"), params: { "/Volume/v": 0.1 } });
        const { document } = await documentFromPatch(file, "Doc", faust);
        expect(document.resources.map((r) => r.name)).toEqual(["Osc", "Raw", "Volume", "Volume-2"]);
        expect(document.instances.map((i) => [i.id, i.resource, i.params])).toEqual([
            ["1", "Osc", {}], ["2", "Volume", { "/Volume/v": 0.25 }], ["3", "Raw", {}],
            ["4", "Volume", { "/Volume/v": 0.75 }], ["5", "Volume-2", { "/Volume-2/v": 0.1 }],
        ]);
    });

    it("keeps the provenance the file gives, the resources without instance, and asks for the others", async () => {
        const file = patch();
        file.resources = [
            { name: "Volume", code: "process = *(hslider(\"v\",0.5,0,1,0.01));", wrapped: true, provenance: { kind: "builtin", path: "dyn/Volume.dsp" } },
            { name: "Unused", code: "process = 0;", wrapped: true, provenance: { kind: "none" } },
        ];
        const { document } = await documentFromPatch(file, "Doc", faust, () => ({ kind: "user", module: "u", version: "v" }));
        const by = Object.fromEntries(document.resources.map((r) => [r.name, r.provenance]));
        expect(by.Volume).toEqual({ kind: "builtin", path: "dyn/Volume.dsp" });
        expect(by.Osc).toEqual({ kind: "user", module: "u", version: "v" });
        expect(by.Unused).toEqual({ kind: "none" });
        expect(document.instances.some((i) => i.resource == "Unused")).toBe(false);
    });

    it("migrates a document of format 4", async () => {
        const v4 = {
            format: "faustmodular-document", version: 4, name: "Old", faust, generator: 1,
            instances: [
                { id: "1", name: "VCO", code: "h1", wrapped: true, x: 0, y: 0, inputs: 0, outputs: 1, params: { "/VCO/f": 1 }, acc: [], modulations: [] },
                { id: "2", name: "VCO", code: "h2", wrapped: true, x: 0, y: 0, inputs: 0, outputs: 1, params: { "/VCO/f": 2 }, acc: [], modulations: [] },
            ],
            io: { input: { x: 0, y: 0 }, output: { x: 0, y: 0 } }, connections: [],
        };
        const d = parseDocument(v4);
        expect(d.version).toBe(5);
        expect(d.resources.map((r) => [r.name, r.file, r.code])).toEqual([["VCO", "VCO.dsp", "h1"], ["VCO-2", "VCO-2.dsp", "h2"]]);
        expect(d.instances.map((i) => [i.resource, i.params])).toEqual([["VCO", { "/VCO/f": 1 }], ["VCO-2", { "/VCO-2/f": 2 }]]);
    });

    it("refuses an instance of an unknown resource", () => {
        const d = { format: "faustmodular-document", version: 5, name: "X", faust, generator: 1, resources: [], instances: [{ id: "1", resource: "Nope", x: 0, y: 0, inputs: 0, outputs: 0, params: {}, acc: [], modulations: [] }], io: { input: { x: 0, y: 0 }, output: { x: 0, y: 0 } }, connections: [] };
        expect(() => parseDocument(d)).toThrow(/unknown resource/);
    });

    it("gives the same hash to the same code whatever its line endings", async () => {
        expect(await sha1("a\r\nb\rc\n")).toBe(await sha1("a\nb\nc\n"));
    });

    it("compares documents without their name", async () => {
        const { document } = await documentFromPatch(patch(), "A", faust);
        expect(documentContent({ ...document, name: "B" })).toBe(documentContent(document));
        expect(documentContent({ ...document, connections: [] })).not.toBe(documentContent(document));
    });

    it("rejects malformed documents with the location of the problem", () => {
        expect(() => parseDocument({ format: "faustmodular-document", version: 4, name: "x", instances: [{ id: "1" }], connections: [] })).toThrow(/instances\[0\]\.name/);
        expect(() => parseDocument({ format: "faustmodular-document", version: 6, name: "x" })).toThrow(/version 6/);
        expect(() => parseDocument({ format: "faustmodular-document", version: 5, name: "x", instances: [], connections: [] })).toThrow(/resources/);
        expect(() => parseDocument({ format: "faustmodular-document", version: 4, name: "x", instances: [], connections: ["bad"] })).toThrow(/connections/);
        expect(parseDocument({ format: "faustmodular-document", version: 4, name: "Old", legacy: "{}" }).legacy).toBe("{}");
    });
});

describe("document store", () => {
    async function withDocument() {
        const files = new MemoryStore();
        const store = await DocumentStore.open(files);
        const { document, codes } = await documentFromPatch(patch(), "Doc", faust);
        await store.putCodes(codes);
        const entry = await store.create("Doc", document);
        return { files, store, document, codes, entry };
    }

    it("keeps the committed copy, writes and removes the working copy", async () => {
        const { store, document, entry } = await withDocument();
        expect(await store.read(entry.id)).toEqual({ committed: document, working: null });
        const changed = { ...document, connections: [] };
        await store.writeWorking(entry.id, changed);
        expect((await store.read(entry.id)).working).toEqual(changed);
        await store.commit(entry.id, changed);
        expect(await store.read(entry.id)).toEqual({ committed: changed, working: null });
    });

    it("reopens the same documents and codes from the same files", async () => {
        const { files, document, codes, entry } = await withDocument();
        const again = await DocumentStore.open(files);
        expect(again.list().map((d) => d.name)).toEqual(["Doc"]);
        const { committed } = await again.read(entry.id);
        expect(await again.codesOf(committed)).toEqual(codes);
        expect(committed).toEqual(document);
    });

    it("rebuilds a lost index from the documents", async () => {
        const { files, entry } = await withDocument();
        await files.remove("index.json");
        const again = await DocumentStore.open(files);
        expect(again.list().map((d) => [d.id, d.name])).toEqual([[entry.id, "Doc"]]);
    });

    it("gives unique names: on creation, rename and duplicate", async () => {
        const { store, document, entry } = await withDocument();
        const second = await store.create("Doc", document);
        expect(second.name).toBe("Doc 2");
        expect(await store.rename(second.id, "Doc")).toBe("Doc 2");               // its own name does not count
        expect((await store.duplicate(entry.id)).name).toBe("Doc 3");
        expect(await store.rename(second.id, "Other")).toBe("Other");
        expect((await store.read(second.id)).committed.name).toBe("Other");      // the name is also inside the copies
    });

    it("moves documents to the trash, restores them, and empties the trash", async () => {
        const { store, files, entry } = await withDocument();
        await store.setLast(entry.id);
        await store.setTrashed(entry.id, true);
        expect(store.list()).toEqual([]);
        expect(store.list(true).map((d) => d.id)).toEqual([entry.id]);
        expect(store.last).toBeUndefined();
        await store.setTrashed(entry.id, false);
        expect(store.list().map((d) => d.id)).toEqual([entry.id]);
        await store.setTrashed(entry.id, true);
        await store.emptyTrash();
        expect(store.list(true)).toEqual([]);
        expect(await files.list("documents")).toEqual([]);
    });

    it("stores each code once and collects the codes no document references", async () => {
        const { store, files, document, entry } = await withDocument();
        const codesBefore = await files.list("codes");
        expect(codesBefore).toHaveLength(3);
        const { codes: other } = await documentFromPatch(patch("process = no.noise;"), "Other", faust);
        await store.putCodes(other);
        expect(await files.list("codes")).toHaveLength(4);         // only the new oscillator code
        expect(await store.collect()).toBe(1);
        expect(await files.list("codes")).toEqual(codesBefore);
        // a code referenced by the working copy only is kept
        const { document: next, codes: nextCodes } = await documentFromPatch(patch("process = no.noise;"), "Doc", faust);
        await store.putCodes(nextCodes);
        await store.writeWorking(entry.id, next);
        expect(await store.collect()).toBe(0);
        expect(document.instances).toHaveLength(3);
    });

    it("stores an environment of libraries once, identified by its manifest", async () => {
        const { store, files } = await withDocument();
        const libs = new Map([["maths.lib", "ma = 1;"], ["stdfaust.lib", "ma = library(\"maths.lib\");"]]);
        const id = await store.putEnvironment(libs);
        expect(await store.putEnvironment(new Map([...libs].reverse()))).toBe(id);
        expect(JSON.parse((await files.read(`environments/${id}.json`))!)).toEqual({ "maths.lib": await sha1("ma = 1;"), "stdfaust.lib": await sha1("ma = library(\"maths.lib\");") });
        expect(await files.list("libraries")).toHaveLength(2);
        const changed = await store.putEnvironment(new Map([["maths.lib", "ma = 2;"], ["stdfaust.lib", "ma = library(\"maths.lib\");"]]));
        expect(changed).not.toBe(id);
        expect(await files.list("libraries")).toHaveLength(3);      // the unchanged file is shared
    });
});
