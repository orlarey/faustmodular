// Recalling the scene of a recording (src/store/Recall.ts, Documentation/MATERIALS-SPEC.md): the scene as it was when
// the recording started, found by the SHA-1 of its content, even when the scene was published again since; said so
// when it cannot be found.
import { describe, expect, it } from "vitest";
import { recallScene, descriptionPath } from "../../src/store/Recall";
import { StoreReader } from "../../src/store/StoreReader";
import { StorePublisher } from "../../src/store/StorePublisher";
import { Publishing, StoreTokens } from "../../src/store/Publishing";
import { Stores } from "../../src/store/Stores";
import { github } from "../helpers/github";

const MANIFEST = JSON.stringify({ format: "fauststore", version: 1, name: "Test store" });
const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } } as unknown as Storage;
};
const scene = (gain: number) => JSON.stringify({ format: "faustplayground-patch", version: 2, sceneName: "Nappe", modules: [], connections: [], gain });
const ref = { owner: "o", repo: "r", ref: null };

async function store() {
    const gh = github({ "fauststore.json": MANIFEST, "README.md": "#" });
    const reader = new StoreReader(gh.fetch);
    const p = new Publishing(new StoreTokens(memory()), new Stores(reader, memory()), new StorePublisher(gh.fetch));
    await p.configure("o/r", "good");
    const recording = (name: string) => ({ name, flac: new Uint8Array([0x66, 0x4c, 0x61, 0x43]), description: { sampleRate: 48000, channels: 2, frames: 96000 } });
    return { gh, reader, p, recording };
}

describe("recalling the scene of a recording", () => {
    it("finds the scene at the head when it is the one", async () => {
        const { reader, p, recording } = await store();
        const done = await p.publishRecording("o/r", "Nappe", scene(1), new Map(), recording("Nappe-1"));
        const r = await recallScene(reader, ref, done.material!);
        expect(r).toMatchObject({ scene: "scenes/Nappe/Nappe.jfaust", content: scene(1), exact: true, how: "head" });
        // by the address of its media too
        expect((await recallScene(reader, ref, done.material!.replace(/\.json$/, ".flac"))).content).toBe(scene(1));
    });

    it("finds the version of the recording when the scene was published again since", async () => {
        const { reader, p, recording } = await store();
        const first = await p.publishRecording("o/r", "Nappe", scene(1), new Map(), recording("Nappe-1"));
        await p.publishScene("o/r", "Nappe", scene(2));
        const second = await p.publishRecording("o/r", "Nappe", scene(3), new Map(), recording("Nappe-2"));
        await p.publishScene("o/r", "Nappe", scene(4));
        const r1 = await recallScene(reader, ref, first.material!);
        expect(r1).toMatchObject({ content: scene(1), exact: true, how: "recording", commit: first.commit });
        const r2 = await recallScene(reader, ref, second.material!);
        expect(r2).toMatchObject({ content: scene(3), exact: true, how: "recording", commit: second.commit });
    });

    it("finds it in the versions of the scene when the description came later (added by hand)", async () => {
        const { gh, reader, p } = await store();
        await p.publishScene("o/r", "Nappe", scene(1));
        await p.publishScene("o/r", "Nappe", scene(2));
        const { sha1 } = await import("../../src/documents/Sha1");
        gh.put("materials/Old/Old.json", JSON.stringify({ format: "fauststore-material", version: 1, kind: "recording", name: "Old", recordingOf: "scenes/Nappe/Nappe.jfaust", from: { path: "scenes/Nappe/Nappe.jfaust", sha1: await sha1(scene(1)) } }));
        const r = await recallScene(reader, ref, "materials/Old/Old.json");
        expect(r).toMatchObject({ content: scene(1), exact: true, how: "history" });
    });

    it("says so when the version cannot be found, and gives the scene as it is", async () => {
        const { gh, reader, p, recording } = await store();
        const first = await p.publishRecording("o/r", "Nappe", scene(1), new Map(), recording("Nappe-1"));
        // a description that names a content that was never published
        const fiche = JSON.parse(gh.files().get(first.material!)!);
        fiche.from.sha1 = "0".repeat(40);
        gh.put(first.material!, JSON.stringify(fiche));
        const r = await recallScene(reader, ref, first.material!);
        expect(r).toMatchObject({ content: scene(1), exact: false, how: "current" });
        await expect(recallScene(reader, ref, "materials/None/None.json")).rejects.toMatchObject({ reason: "notFound" });
    });

    it("reads the description from the address of the media", () => {
        expect(descriptionPath("materials/A-1/A-1.flac")).toBe("materials/A-1/A-1.json");
        expect(descriptionPath("materials/A-1/A-1.json")).toBe("materials/A-1/A-1.json");
    });
});
