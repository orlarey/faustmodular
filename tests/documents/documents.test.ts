// The documents controller with a simulated scene (src/documents/Documents.ts): working copy saved
// at each state, Save, Revert, Save as, files opened as new documents, trash, migration.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Documents, LEGACY_KEY } from "../../src/documents/Documents";
import { storedCode } from "../../src/documents/DocumentFormat";
import { sha1 } from "../../src/documents/Sha1";
import { MemoryStore } from "../../src/documents/FileStore";
import { wrapModuleCode } from "../../src/model/ModuleCode";
import { PATCH_FORMAT, PatchFileV2 } from "../../src/model/PatchFormat";

const faust = async () => ({ libfaust: "2.90.19", libraries: "env" });

function patchFile(name: string, x = 100): PatchFileV2 {
    return {
        format: PATCH_FORMAT, version: 2, sceneName: name,
        modules: [
            { id: "input", kind: "input", name: "input", code: "", x: 10, y: 400, inputs: 0, outputs: 2, params: {}, acc: [] },
            { id: "output", kind: "output", name: "output", code: "", x: 1300, y: 400, inputs: 2, outputs: 0, params: {}, acc: [] },
            { id: "1", kind: "faust", name: "Osc", code: wrapModuleCode("Osc", "process = os.osc(440);"), x, y: 50, inputs: 0, outputs: 1, params: { "/Osc/f": 440 }, acc: [] },
        ],
        connections: [{ from: { module: "1", port: 0 }, to: { module: "output", port: 0 } }],
    };
}

// A scene holding a patch file: what the documents see of the real scene.
class FakeScene {
    sceneName = "Patch";
    documents: any = null;
    patch: PatchFileV2 = { format: PATCH_FORMAT, version: 2, sceneName: "Patch", modules: [], connections: [] };
    history = { flush: async () => undefined };
    describePatch(): PatchFileV2 {
        return JSON.parse(JSON.stringify({ ...this.patch, sceneName: this.sceneName }));
    }
    async replaceScene(json: string): Promise<boolean> {
        try {
            const data = JSON.parse(json);
            if (data.format != PATCH_FORMAT) return false;
            // the physical modules keep their channels; empty files keep their positions
            const io = this.patch.modules.filter((m) => m.kind != "faust");
            this.patch = { ...data, modules: data.modules.some((m: any) => m.kind != "faust") ? data.modules : [...io, ...data.modules] };
            this.sceneName = data.sceneName;
            return true;
        } catch {
            return false;
        }
    }
    // a change through the interface, then the step of the history
    change(edit: (patch: PatchFileV2) => void): void {
        edit(this.patch);
        this.documents.changed();
    }
    updates = new Map<string, boolean>();
    showUpdate(id: string, available: boolean): void {
        this.updates.set(id, available);
    }
    // an edit in faustcode (Scene.editModuleCode)
    async updateModuleCode(id: string, code: string): Promise<string | null> {
        const m = this.patch.modules.find((x) => x.id == id)!;
        const previous = storedCode(m.name, m.code).code;
        m.code = wrapModuleCode(m.name, code);
        this.documents.codeEdited(previous, code, m.name);
        this.documents.changed();
        return null;
    }
    codeOf(id: string): string {
        const m = this.patch.modules.find((x) => x.id == id)!;
        return storedCode(m.name, m.code).code;
    }
}

class FakeStorage {
    items = new Map<string, string>();
    getItem(key: string) { return this.items.get(key) ?? null; }
    setItem(key: string, value: string) { this.items.set(key, value); }
    removeItem(key: string) { this.items.delete(key); }
}

const LIBRARY_OSC = 'process = os.osc(440);';            // the code of the library module Osc (patchFile)
const OLD_OSC = 'process = os.osc(220);';                // a former version of it
const library = async () => ({
    modules: { "faust-modules/generators/Osc.dsp": await sha1(LIBRARY_OSC) },
    history: { [await sha1(OLD_OSC)]: { path: "faust-modules/generators/Osc.dsp" } },
});

async function start(files = new MemoryStore(), legacyStorage: any = null) {
    const scene = new FakeScene();
    const documents = await Documents.start(scene, {
        files, environment: faust, legacyStorage, untitled: "Untitled", library,
        libraryCode: async (path) => path.endsWith("Osc.dsp") ? LIBRARY_OSC : "",
    });
    return { scene, documents, files };
}

function withCode(name: string, code: string, x = 100): PatchFileV2 {
    const file = patchFile(name, x);
    file.modules[2].code = wrapModuleCode("Osc", code);
    return file;
}

const oscX = (scene: FakeScene) => scene.patch.modules.find((m) => m.id == "1")!.x;

afterEach(() => vi.useRealTimers());

describe("documents", () => {
    it("starts on a new blank document, replaced by the first file opened", async () => {
        const { scene, documents } = await start();
        expect(documents.current!.name).toBe("Untitled");
        expect(scene.documents).toBe(documents);
        expect(await documents.importPatch(JSON.stringify(patchFile("Song")))).toBe(true);
        expect(documents.current!.name).toBe("Song");
        expect(documents.store.list().map((d) => d.name)).toEqual(["Song"]);          // the blank one is gone
        expect(documents.store.list(true)).toEqual([]);
        expect(documents.dirty).toBe(false);
    });

    it("writes the working copy at each state, and removes it when the scene is back to the committed copy", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("Song")));
        const id = documents.current!.id;
        scene.change((p) => { p.modules[2].x = 300; });
        await documents.flush();
        expect(documents.dirty).toBe(true);
        expect((await documents.store.read(id)).working!.instances[0].x).toBe(300);
        expect((await documents.store.read(id)).committed.instances[0].x).toBe(100);
        scene.change((p) => { p.modules[2].x = 100; });                                 // undone by hand
        await documents.flush();
        expect(documents.dirty).toBe(false);
        expect((await documents.store.read(id)).working).toBeNull();
    });

    it("reopens the working copy after a restart, and Save makes it the committed copy", async () => {
        const first = await start();
        await first.documents.importPatch(JSON.stringify(patchFile("Song")));
        first.scene.change((p) => { p.modules[2].x = 300; });
        await first.documents.flush();

        const second = await start(first.files);
        expect(second.documents.current!.name).toBe("Song");
        expect(second.documents.dirty).toBe(true);
        expect(oscX(second.scene)).toBe(300);
        await second.documents.save();
        expect(second.documents.dirty).toBe(false);

        const third = await start(first.files);
        expect(third.documents.dirty).toBe(false);
        expect(oscX(third.scene)).toBe(300);
    });

    it("reverts to the committed copy", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("Song")));
        scene.change((p) => { p.modules[2].x = 300; p.connections = []; });
        await documents.flush();
        await documents.revert();
        expect(documents.dirty).toBe(false);
        expect(oscX(scene)).toBe(100);
        expect(scene.patch.connections).toHaveLength(1);
        expect((await documents.store.read(documents.current!.id)).working).toBeNull();
    });

    it("saves as a new document and leaves the original clean", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("Song")));
        const original = documents.current!.id;
        scene.change((p) => { p.modules[2].x = 300; });
        await documents.flush();
        const copy = await documents.saveAs("Song");
        expect(copy!.name).toBe("Song 2");
        expect(documents.current!.id).toBe(copy!.id);
        expect(documents.dirty).toBe(false);
        expect(await documents.store.read(original)).toMatchObject({ working: null, committed: { instances: [{ x: 100 }] } });
        expect((await documents.store.read(copy!.id)).committed.instances[0].x).toBe(300);
    });

    it("opens a file as a new document: the modified one keeps its working copy", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("Song")));
        const song = documents.current!.id;
        scene.change((p) => { p.modules[2].x = 300; });
        await documents.flush();
        await documents.importPatch(JSON.stringify(patchFile("Other", 700)));
        expect(documents.current!.name).toBe("Other");
        expect(oscX(scene)).toBe(700);
        expect(await documents.open(song)).toBe(true);
        expect(documents.dirty).toBe(true);
        expect(oscX(scene)).toBe(300);
        // an unreadable file changes nothing
        expect(await documents.importPatch("{ not json")).toBe(false);
        expect(documents.current!.id).toBe(song);
    });

    it("renames, duplicates, trashes the open document (the next one opens), restores and empties the trash", async () => {
        const { documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("A")));
        const a = documents.current!.id;
        await documents.importPatch(JSON.stringify(patchFile("B", 500)));
        expect(await documents.rename("A")).toBe("A 2");
        expect(await documents.rename("Bee")).toBe("Bee");
        const copy = await documents.duplicate(a);
        expect(copy.name).toBe("A 2");
        expect(documents.current!.name).toBe("Bee");
        await documents.trash(documents.current!.id);
        expect(documents.store.list(true).map((d) => d.name)).toEqual(["Bee"]);
        expect(documents.current).not.toBeNull();
        expect(["A", "A 2"]).toContain(documents.current!.name);
        await documents.restore(documents.store.list(true)[0].id);
        expect(documents.store.list().map((d) => d.name).sort()).toEqual(["A", "A 2", "Bee"]);
        await documents.trash(copy.id);
        await documents.emptyTrash();
        expect(documents.store.list(true)).toEqual([]);
        expect(documents.store.list().map((d) => d.name).sort()).toEqual(["A", "Bee"]);
    });

    it("trashing the last document opens a new one", async () => {
        const { documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("Only")));
        await documents.trash(documents.current!.id);
        expect(documents.current!.name).toBe("Untitled");
    });
});

describe("migration of the localStorage", () => {
    it("turns each saved scene into a document, converted when first opened, once", async () => {
        const storage = new FakeStorage();
        storage.setItem(LEGACY_KEY, JSON.stringify([["Old", JSON.stringify(patchFile("Old", 250))], ["Older", JSON.stringify(patchFile("Older", 260))], "junk"]));
        const { documents, files, scene } = await start(new MemoryStore(), storage);
        expect(documents.store.list().map((d) => d.name).sort()).toEqual(["Old", "Older"]);
        // one of them is opened at start (converted); the other is still in its old format
        const old = documents.store.list().find((d) => d.id != documents.current!.id)!;
        expect((await documents.store.read(old.id)).committed.legacy).toBeDefined();
        expect(await documents.open(old.id)).toBe(true);
        expect(oscX(scene)).toBe(old.name == "Old" ? 250 : 260);
        expect(documents.dirty).toBe(false);
        const converted = (await documents.store.read(old.id)).committed;
        expect(converted.legacy).toBeUndefined();
        expect(converted.instances[0]).toMatchObject({ name: "Osc", x: oscX(scene), wrapped: true });

        const again = await start(files, storage);
        expect(again.documents.store.list()).toHaveLength(2);                      // not migrated twice
        expect(storage.getItem(LEGACY_KEY)).not.toBeNull();                        // kept for now
    });

    it("removes the old key after at least 7 days and 2 starts", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 10, 1));
        const storage = new FakeStorage();
        storage.setItem(LEGACY_KEY, JSON.stringify([["Old", JSON.stringify(patchFile("Old"))]]));
        const { files } = await start(new MemoryStore(), storage);
        await start(files, storage);
        await start(files, storage);                                                // 2 starts, but 0 day
        expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
        vi.setSystemTime(new Date(2026, 10, 9));
        await start(files, storage);
        expect(storage.getItem(LEGACY_KEY)).toBeNull();
    });
});

describe("user modules", () => {
    const names = (documents: Documents) => documents.store.listModules().map((m) => `${m.name}:${m.versions.length}`).sort();

    it("a code of the library is a library module; any other code gets a user module, once", async () => {
        const { documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("Song")));                 // the library Osc
        expect(names(documents)).toEqual([]);
        await documents.importPatch(JSON.stringify(withCode("Mine", "process = no.noise;")));
        expect(names(documents)).toEqual(["Osc:1"]);
        await documents.importPatch(JSON.stringify(withCode("Again", "process = no.noise;")));
        expect(names(documents)).toEqual(["Osc:1"]);                                    // the same code: the same module
        expect(documents.statusOf(await sha1("process = no.noise;"))).toMatchObject({ name: "Osc" });
        expect(documents.statusOf(await sha1(LIBRARY_OSC))).toBe("library");
    });

    it("an edit in faustcode: a new user module from a library module, a new version of a user module", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(patchFile("Song")));
        await scene.updateModuleCode("1", "process = os.osc(880);");
        await documents.flush();
        expect(names(documents)).toEqual(["Osc:1"]);
        await scene.updateModuleCode("1", "process = os.osc(990);");
        await documents.flush();
        expect(names(documents)).toEqual(["Osc:2"]);
        expect(documents.store.listModules()[0].versions).toEqual([await sha1("process = os.osc(880);"), await sha1("process = os.osc(990);")]);
        expect(scene.updates.get("1")).toBe(false);
    });

    it("an instance of an older version gets the latest one by an update", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(withCode("Song", "process = os.osc(880);")));
        await scene.updateModuleCode("1", "process = os.osc(990);");
        await documents.flush();
        // another document still uses the first version
        await documents.importPatch(JSON.stringify(withCode("Old", "process = os.osc(880);")));
        expect(scene.updates.get("1")).toBe(true);
        expect(await documents.updateInstance("1")).toBeNull();
        await documents.flush();
        expect(scene.codeOf("1")).toBe("process = os.osc(990);");
        expect(scene.updates.get("1")).toBe(false);
        expect(names(documents)).toEqual(["Osc:2"]);
    });

    it("an older version of a library module becomes a user module that can be updated to the library module", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(withCode("Song", OLD_OSC)));
        expect(documents.store.listModules()).toMatchObject([{ name: "Osc", basedOn: "faust-modules/generators/Osc.dsp" }]);
        expect(scene.updates.get("1")).toBe(true);
        await documents.updateInstance("1");
        await documents.flush();
        expect(scene.codeOf("1")).toBe(LIBRARY_OSC);
        expect(scene.updates.get("1")).toBe(false);
    });

    it("a module in the trash keeps its codes; the trash emptied, it is created again when used", async () => {
        const { documents, files } = await start();
        await documents.importPatch(JSON.stringify(withCode("Song", "process = no.noise;")));
        const id = documents.store.listModules()[0].id;
        await documents.renameModule(id, "Noise");
        await documents.trashModule(id);
        expect(documents.store.listModules()).toEqual([]);
        await documents.importPatch(JSON.stringify(withCode("Again", "process = no.noise;")));
        expect(documents.store.listModules(true).map((m) => m.name)).toEqual(["Noise"]);
        expect(documents.store.listModules()).toEqual([]);
        expect(await documents.store.collect()).toBe(0);
        await documents.emptyTrash();
        expect(await files.list("modules")).toEqual([]);
        await documents.importPatch(JSON.stringify(withCode("Third", "process = no.noise;")));
        expect(names(documents)).toEqual(["Osc:1"]);
    });

    it("gives the latest code of a user module, to add an instance of it", async () => {
        const { scene, documents } = await start();
        await documents.importPatch(JSON.stringify(withCode("Song", "process = os.osc(880);")));
        await scene.updateModuleCode("1", "process = os.osc(990);");
        await documents.flush();
        expect(await documents.moduleCode(documents.store.listModules()[0].id)).toEqual({ name: "Osc", code: "process = os.osc(990);" });
    });
});
