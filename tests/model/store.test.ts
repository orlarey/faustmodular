// The store (Documentation/STORE-SPEC.md): its reference, its manifest and its index checked, a module described
// from its code, the repository read with its index or without (rebuilt from git/trees), the stores followed.
import { describe, expect, it } from "vitest";
import { contentsOf, moduleEntry, parseFileUrl, parseIndex, parseManifest, parseStoreRef, safePath, storeKey } from "../../src/store/StoreFormat";
import { storeLink } from "../../src/store/StoreLink";
import { StoreError, StoreReader } from "../../src/store/StoreReader";
import { Stores } from "../../src/store/Stores";

const DRONE = `declare name "Drone";
declare author "Yann Orlarey";
declare license "MIT";
declare function "Oscillator";
declare summary "Drone: three detuned saws";
declare inlets "pitch";
declare outlets "out";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

- Three saws, slightly detuned
- Pitch: 0.1 per octave

*/

process = os.sawtooth(110) * 0.1;
`;

// A repository in memory, served as GitHub serves it (raw files, the tree of the API).
function github(files: Record<string, string>, owner = "o", repo = "r") {
    const calls: string[] = [];
    const fetch = async (url: string) => {
        calls.push(url);
        const raw = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`;
        if (url.startsWith(raw)) {
            const path = decodeURIComponent(url.slice(raw.length));
            return path in files ? new Response(files[path]) : new Response("404: Not Found", { status: 404 });
        }
        if (url == `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`) {
            return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) }));
        }
        return new Response("", { status: 404 });
    };
    return { fetch, calls };
}

const MANIFEST = JSON.stringify({ format: "fauststore", version: 1, name: "Modules de Yann", license: "MIT" });

describe("store: references and formats", () => {
    it("reads a store reference: owner/repo, @ref, the address on GitHub", () => {
        expect(parseStoreRef("orlarey/faust-store")).toEqual({ owner: "orlarey", repo: "faust-store", ref: null });
        expect(parseStoreRef("orlarey/faust-store@v1")).toEqual({ owner: "orlarey", repo: "faust-store", ref: "v1" });
        expect(parseStoreRef("https://github.com/orlarey/faust-store/tree/main")).toEqual({ owner: "orlarey", repo: "faust-store", ref: "main" });
        expect(parseStoreRef("github.com/orlarey/faust-store.git")).toEqual({ owner: "orlarey", repo: "faust-store", ref: null });
        for (const bad of ["", "orlarey", "a/b/c", "../x/y", "a b/c", "o/r@a b"]) expect(parseStoreRef(bad), bad).toBeNull();
        expect(storeKey({ owner: "o", repo: "r", ref: "main" })).toBe("o/r@main");
    });

    it("accepts only relative paths, without going up or into a hidden folder", () => {
        expect(safePath("modules/Drone/Drone.dsp")).toBe(true);
        for (const bad of ["/etc/passwd", "../x.dsp", "modules/../../x", "modules/.git/x", "", "a//b"]) expect(safePath(bad), bad).toBe(false);
    });

    it("checks the manifest and the index", () => {
        expect(parseManifest(JSON.parse(MANIFEST))?.name).toBe("Modules de Yann");
        expect(parseManifest({ format: "other", version: 1 })).toBeNull();
        expect(parseManifest({ format: "fauststore", version: 2 })).toBeNull();
        const index = parseIndex({
            format: "fauststore-index", version: 1,
            modules: [{ path: "modules/Drone/Drone.dsp", name: "Drone", functions: ["Oscillator", 3] }, { path: "../evil.dsp" }, { path: "modules/x.txt" }],
            scenes: [{ path: "scenes/Nappe/Nappe.jfaust", preview: "../p.png" }],
        })!;
        expect(index.modules.map((m) => m.path)).toEqual(["modules/Drone/Drone.dsp"]);
        expect(index.modules[0].functions).toEqual(["Oscillator"]);
        expect(index.scenes).toEqual([{ path: "scenes/Nappe/Nappe.jfaust", name: "Nappe", summary: undefined, author: undefined, preview: undefined }]);
        expect(parseIndex({ modules: [] })).toBeNull();
    });

    it("describes a module from its code, as the modules of the library", () => {
        const m = moduleEntry("modules/Drone/Drone.dsp", DRONE);
        expect(m).toMatchObject({ name: "Drone", author: "Yann Orlarey", license: "MIT", functions: ["Oscillator"], inlets: ["pitch"], outlets: ["out"], summary: "Drone: three detuned saws" });
        expect(m.description).toContain("Three saws");
        expect(moduleEntry("modules/Bare/Bare.dsp", "process = _;")).toMatchObject({ name: "Bare", summary: "", functions: [] });
    });

    it("finds the modules and the scenes of a repository", () => {
        expect(contentsOf(["README.md", "modules/Drone/Drone.dsp", "scenes/Nappe/Nappe.jfaust", "scenes/Nappe/preview.png", "other/x.dsp", ".github/x.dsp"]))
            .toEqual({ modules: ["modules/Drone/Drone.dsp"], scenes: ["scenes/Nappe/Nappe.jfaust"] });
    });
});

describe("store: links", () => {
    it("reads the address of a file of a store, as GitHub shows it or raw", () => {
        expect(parseFileUrl("https://github.com/orlarey/faust-store/blob/main/scenes/Nappe/Nappe.jfaust"))
            .toEqual({ ref: { owner: "orlarey", repo: "faust-store", ref: "main" }, path: "scenes/Nappe/Nappe.jfaust" });
        expect(parseFileUrl("https://raw.githubusercontent.com/orlarey/faust-store/3f2a9c1/scenes/Ma%20sc%C3%A8ne/Ma%20sc%C3%A8ne.jfaust"))
            .toEqual({ ref: { owner: "orlarey", repo: "faust-store", ref: "3f2a9c1" }, path: "scenes/Ma scène/Ma scène.jfaust" });
        for (const bad of ["http://github.com/o/r/blob/main/x.jfaust", "https://github.com/o/r/tree/main/x", "https://example.com/o/r/main/x.jfaust",
            "https://github.com/o/r/blob/main/../x.jfaust", "https://github.com/o/r/blob/main", "not a url"]) expect(parseFileUrl(bad), bad).toBeNull();
    });

    it("opens a scene from the address of its file in the address of faustmodular, encoded or not", () => {
        const file = "https://github.com/orlarey/faust-store/blob/main/scenes/Nappe/Nappe.jfaust";
        const expected = { store: "orlarey/faust-store@main", scene: "scenes/Nappe/Nappe.jfaust" };
        expect(storeLink("?scene=" + file)).toEqual(expected);
        expect(storeLink("?starter=0&scene=" + encodeURIComponent(file))).toEqual(expected);
        expect(storeLink("?store=o/r&scene=scenes/A/A.jfaust&ref=abc")).toEqual({ store: "o/r@abc", scene: "scenes/A/A.jfaust" });
        expect(storeLink("?store=o/r")).toEqual({ store: "o/r", scene: undefined });
        expect(storeLink("?scene=scenes/A/A.jfaust")).toBeNull();
        expect(storeLink("?starter=0")).toBeNull();
    });
});

describe("store: reading", () => {
    it("reads the manifest and the index from the raw files, without the API", async () => {
        const index = { format: "fauststore-index", version: 1, modules: [{ path: "modules/Drone/Drone.dsp", name: "Drone" }], scenes: [] };
        const { fetch, calls } = github({ "fauststore.json": MANIFEST, "index.json": JSON.stringify(index) });
        const store = await new StoreReader(fetch).open(parseStoreRef("o/r")!);
        expect(store.rebuilt).toBe(false);
        expect(store.manifest.name).toBe("Modules de Yann");
        expect(store.index.modules.map((m) => m.name)).toEqual(["Drone"]);
        expect(calls.every((c) => c.startsWith("https://raw.githubusercontent.com/"))).toBe(true);
    });

    it("without an index, rebuilds it from the repository: one call of the API, the modules described", async () => {
        const { fetch, calls } = github({ "fauststore.json": MANIFEST, "modules/Drone/Drone.dsp": DRONE, "scenes/Nappe/Nappe.jfaust": "{}", "README.md": "#" });
        const store = await new StoreReader(fetch).open(parseStoreRef("o/r")!);
        expect(store.rebuilt).toBe(true);
        expect(store.index.modules).toMatchObject([{ path: "modules/Drone/Drone.dsp", name: "Drone", functions: ["Oscillator"] }]);
        expect(store.index.scenes).toEqual([{ path: "scenes/Nappe/Nappe.jfaust", name: "Nappe" }]);
        expect(calls.filter((c) => c.startsWith("https://api.github.com/")).length).toBe(1);
    });

    it("says why a store cannot be read: not found, not a store", async () => {
        const reader = new StoreReader(github({}).fetch);
        await expect(reader.open(parseStoreRef("o/r")!)).rejects.toMatchObject({ reason: "notFound" });
        const other = new StoreReader(github({ "fauststore.json": "{\"format\":\"x\"}" }).fetch);
        await expect(other.open(parseStoreRef("o/r")!)).rejects.toBeInstanceOf(StoreError);
        await expect(other.open(parseStoreRef("o/r")!)).rejects.toMatchObject({ reason: "notAStore" });
    });

    it("gives the address of a file, encoded, on the default branch or a ref", () => {
        const reader = new StoreReader();
        expect(reader.rawUrl(parseStoreRef("o/r")!, "scenes/Ma scène/Ma scène.jfaust")).toBe("https://raw.githubusercontent.com/o/r/HEAD/scenes/Ma%20sc%C3%A8ne/Ma%20sc%C3%A8ne.jfaust");
        expect(reader.rawUrl(parseStoreRef("o/r@abc")!, "x.dsp")).toBe("https://raw.githubusercontent.com/o/r/abc/x.dsp");
    });
});

describe("stores followed", () => {
    const memory = () => {
        const data = new Map<string, string>();
        return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } } as unknown as Storage;
    };

    it("follows a store, keeps it, reads it again at the next start; refuses what is not a store", async () => {
        const storage = memory();
        const reader = new StoreReader(github({ "fauststore.json": MANIFEST, "modules/Drone/Drone.dsp": DRONE }).fetch);
        const stores = new Stores(reader, storage);
        const state = await stores.follow("https://github.com/o/r");
        expect(state.status).toBe("ready");
        expect(state.store!.index.modules[0].name).toBe("Drone");
        await expect(stores.follow("o/missing")).rejects.toMatchObject({ reason: "notFound" });
        expect(stores.list().map((s) => s.key)).toEqual(["o/r"]);
        // the next start
        const again = new Stores(reader, storage);
        expect(again.list().map((s) => [s.key, s.status])).toEqual([["o/r", "loading"]]);
        await again.loadAll();
        expect(again.get("o/r")!.status).toBe("ready");
        again.unfollow("o/r");
        expect(new Stores(reader, storage).list()).toEqual([]);
    });
});
