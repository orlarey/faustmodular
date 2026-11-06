// Publishing to a store (Documentation/STORE-SPEC.md, "Publier"): an in-memory GitHub with the Git API (the
// repository and its rights, the ref of the branch, commits, trees, contents), behind a token. One commit per
// publication, the index made again (a module published again keeps its code before in its versions, a module added
// by hand is described), the branch moved without forcing (made again if it moved); the reader keeps an entry of the
// index while its file is the same.
import { describe, expect, it } from "vitest";
import { gitBlobSha, modulePath, parseIndex, parseStoreRef, scenePath, slug } from "../../src/store/StoreFormat";
import { buildIndex } from "../../src/store/StoreIndex";
import { StoreReader } from "../../src/store/StoreReader";
import { PublishError, StorePublisher } from "../../src/store/StorePublisher";
import { MyStore, Publishing, shareLink } from "../../src/store/Publishing";
import { Stores } from "../../src/store/Stores";
import { github } from "../helpers/github";

const MANIFEST = JSON.stringify({ format: "fauststore", version: 1, name: "Test store" });
const code = (name: string, body = "process = _;") => `declare name "${name}";\ndeclare summary "${name} summary";\n${body}\n`;

const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } } as unknown as Storage;
};

function publishing(gh: ReturnType<typeof github>) {
    const reader = new StoreReader(gh.fetch);
    const stores = new Stores(reader, memory());
    const p = new Publishing(new MyStore(memory()), stores, new StorePublisher(gh.fetch));
    return { p, stores };
}

describe("store: names and blobs", () => {
    it("names an element by its name, accents and spaces taken off", () => {
        expect(slug("Ma scène d'été")).toBe("Ma-scene-dete");
        expect(slug("  ")).toBe("Untitled");
        expect(modulePath("Drone 2")).toBe("modules/Drone-2/Drone-2.dsp");
        expect(scenePath("Nappe")).toBe("scenes/Nappe/Nappe.jfaust");
    });

    it("computes the git blob of a text as git does", async () => {
        expect(await gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    });

    it("makes the link to share an element at its commit", () => {
        expect(shareLink("https://orlarey.github.io/faustmodular/", parseStoreRef("o/r")!, "abc", "scenes/Ma scène/Ma scène.jfaust"))
            .toBe("https://orlarey.github.io/faustmodular/?scene=https://github.com/o/r/blob/abc/scenes/Ma%20sc%C3%A8ne/Ma%20sc%C3%A8ne.jfaust");
    });
});

describe("store: the index", () => {
    it("keeps an entry while its file is the same, describes the others, keeps the code before in the versions", async () => {
        const drone = code("Drone");
        const tree = [{ path: "modules/Drone/Drone.dsp", sha: await gitBlobSha(drone) }];
        const first = await buildIndex(tree, null, async () => drone, { files: new Map(), parent: "p0", date: "d0" });
        expect(first.modules[0]).toMatchObject({ name: "Drone", summary: "Drone summary", sha: tree[0].sha, updated: "d0" });
        // the same file: the entry kept, the file not read
        let reads = 0;
        const same = await buildIndex(tree, first, async () => { reads++; return drone; });
        expect(reads).toBe(0);
        expect(same.modules[0]).toBe(first.modules[0]);
        // published again with another code: a version
        const drone2 = code("Drone", "process = _ * 0.5;");
        const second = await buildIndex(tree, first, async () => drone, { files: new Map([["modules/Drone/Drone.dsp", drone2]]), parent: "c1", date: "d1" });
        expect(second.modules[0].versions).toEqual([{ code: first.modules[0].code, commit: "c1", date: "d0" }]);
        expect(second.modules[0].updated).toBe("d1");
        // a module added by hand (not in the index): described from its file
        const lfo = code("Lfo");
        const files: Record<string, string> = { "modules/Drone/Drone.dsp": drone2, "modules/Lfo/Lfo.dsp": lfo };
        const third = await buildIndex([{ path: "modules/Drone/Drone.dsp", sha: await gitBlobSha(drone2) }, { path: "modules/Lfo/Lfo.dsp", sha: await gitBlobSha(lfo) }],
            second, async (path) => { reads++; return files[path]; });
        expect(reads).toBe(1);                                                      // Lfo only: Drone is the same
        expect(third.modules.map((m) => m.name)).toEqual(["Drone", "Lfo"]);
    });
});

describe("store: publishing", () => {
    it("checks the token: the repository writable with it", async () => {
        const gh = github({ "fauststore.json": MANIFEST });
        const { p } = publishing(gh);
        await expect(p.configure("o/r", "bad")).rejects.toMatchObject({ reason: "token" });
        expect(p.ready).toBe(false);
        expect(await p.configure("https://github.com/o/r", "good")).toEqual({ key: "o/r", branch: "master", private: false });
        expect(p.ready).toBe(true);
    });

    it("publishes a scene in one commit, with the index; the store read again, fresh", async () => {
        const gh = github({ "fauststore.json": MANIFEST, "README.md": "#", "modules/Drone/Drone.dsp": code("Drone") });
        const { p, stores } = publishing(gh);
        await p.configure("o/r", "good");
        const scene = JSON.stringify({ format: "faustplayground-patch", version: 2, sceneName: "Nappe", modules: [{ kind: "faust", name: "Drone", code: 'process = vgroup("Drone",environment{\nprocess = _;\n}.process);' }], connections: [] });
        const before = gh.head;
        const done = await p.publishScene("Nappe", scene);
        expect(done).toMatchObject({ store: "o/r", path: "scenes/Nappe/Nappe.jfaust", branch: "master", replaced: false });
        expect(gh.head).toBe(done.commit);
        expect(gh.commit(done.commit).parents).toEqual([before]);                    // one commit
        expect(gh.commit(done.commit).message).toBe("Publish the scene Nappe (faustmodular)");
        expect(gh.files().get("scenes/Nappe/Nappe.jfaust")).toBe(scene);
        const index = parseIndex(JSON.parse(gh.files().get("index.json")!))!;
        expect(index.modules.map((m) => m.name)).toEqual(["Drone"]);
        expect(index.scenes).toMatchObject([{ path: "scenes/Nappe/Nappe.jfaust", name: "Nappe", sha: await gitBlobSha(scene) }]);
        expect(index.scenes[0].codes!.length).toBe(1);
        // followed, its scenes known at once
        expect(stores.get("o/r")!.store!.index.scenes.map((s) => s.name)).toEqual(["Nappe"]);
    });

    it("publishes a module again: a new version, its code before kept with the commit that contains it", async () => {
        const gh = github({ "fauststore.json": MANIFEST });
        const { p } = publishing(gh);
        await p.configure("o/r", "good");
        const first = await p.publishModule("Drone", code("Drone"));
        expect(first.replaced).toBe(false);
        const second = await p.publishModule("Drone", code("Drone", "process = _ * 0.5;"));
        expect(second.replaced).toBe(true);
        expect(gh.commit(second.commit).message).toBe("Publish a new version of the module Drone (faustmodular)");
        const index = parseIndex(JSON.parse(gh.files().get("index.json")!))!;
        expect(index.modules[0].versions!.map((v) => v.commit)).toEqual([first.commit]);
    });

    it("if the branch moved meanwhile, makes the publication again on it, without losing what was added", async () => {
        const gh = github({ "fauststore.json": MANIFEST });
        const { p } = publishing(gh);
        await p.configure("o/r", "good");
        gh.moveDuringNext("modules/Lfo/Lfo.dsp", code("Lfo"));
        const done = await p.publishModule("Drone", code("Drone"));
        expect(gh.head).toBe(done.commit);
        expect([...gh.files().keys()].sort()).toEqual(["fauststore.json", "index.json", "modules/Drone/Drone.dsp", "modules/Lfo/Lfo.dsp"]);
        expect(parseIndex(JSON.parse(gh.files().get("index.json")!))!.modules.map((m) => m.name)).toEqual(["Drone", "Lfo"]);
        expect(gh.calls.filter((c) => c.startsWith("PATCH")).length).toBe(2);
    });

    it("says why it cannot publish: no right to write", async () => {
        const gh = github({ "fauststore.json": MANIFEST });
        await expect(new StorePublisher(gh.fetch).verify(parseStoreRef("o/r")!, "good").then(() => null)).resolves.toBeNull();
        const readOnly = { ...gh, fetch: async (url: string, init?: RequestInit) => url == "https://api.github.com/repos/o/r" ? new Response(JSON.stringify({ default_branch: "master", permissions: { push: false } })) : gh.fetch(url, init) };
        await expect(new StorePublisher(readOnly.fetch).verify(parseStoreRef("o/r")!, "good")).rejects.toBeInstanceOf(PublishError);
    });
});
