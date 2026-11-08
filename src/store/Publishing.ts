/*				PUBLISHING.TS
    Publishing to a store (Documentation/STORE-SPEC.md, "Publier"): the stores followed are in read only, or in read
    and write with a token for each (kept in the browser, only sent to api.github.com); the publication of a scene or
    a module to one of them in one commit, with the index made again. After it: the store read again (fresh, with the
    token), and the link to share the element at the commit published, copied.
*/

import { materialPath, modulePath, parseIndex, parseStoreRef, scenePath, serializeIndex, STORE_INDEX, storeKey, StoreIndex, StoreRef } from "./StoreFormat";
import { sha1 } from "../documents/Sha1";
import { buildIndex } from "./StoreIndex";
import { PublishError, StorePublisher } from "./StorePublisher";
import { Stores, TOKENS_KEY } from "./Stores";

const TOKENS = TOKENS_KEY;
// before 3.48.0: one store to publish to
const OLD_REPO = "faustmodular:my-store";
const OLD_TOKEN = "faustmodular:my-store-token";

// The tokens of the stores one writes to (a store with a token: read and write), kept in the browser, only sent to
// api.github.com.
export class StoreTokens {
    constructor(private fStorage: Storage | null = StoreTokens.storage()) {
        // the store of 3.47.0, with its token
        try {
            const repo = this.fStorage?.getItem(OLD_REPO), token = this.fStorage?.getItem(OLD_TOKEN);
            if (repo && token && !this.get(repo)) this.set(repo, token);
            this.fStorage?.removeItem(OLD_REPO);
            this.fStorage?.removeItem(OLD_TOKEN);
        } catch { /* nothing */ }
    }

    private static storage(): Storage | null {
        try { return localStorage; } catch { return null; }
    }

    private all(): Record<string, string> {
        try {
            const x = JSON.parse(this.fStorage?.getItem(TOKENS) ?? "{}");
            return x && typeof x == "object" ? x : {};
        } catch {
            return {};
        }
    }

    private write(all: Record<string, string>): void {
        try { this.fStorage?.setItem(TOKENS, JSON.stringify(all)); } catch { /* not kept */ }
    }

    get(key: string): string | undefined {
        return this.all()[key];
    }

    set(key: string, token: string): void {
        this.write({ ...this.all(), [key]: token });
    }

    remove(key: string): void {
        const all = this.all();
        delete all[key];
        this.write(all);
    }

    keys(): string[] {
        return Object.keys(this.all());
    }
}

export interface Published { store: string; path: string; commit: string; branch: string; replaced: boolean; modules?: string[]; material?: string }

// The largest media published in a store (Documentation/STORE-SPEC.md, "Les médias": GitHub warns beyond 50 MB).
export const MAX_MEDIA = 50 * 1024 * 1024;

// A recording to publish with its scene: its name, its media (FLAC), its description without what the publication
// adds (the media, the recipe).
export interface RecordingToPublish { name: string; flac: Uint8Array; description: Record<string, unknown> }

// The link to open an element published, at its commit: the address of its file on GitHub after ?scene= (STORE-SPEC.md,
// "Partager une scène par son adresse").
export function shareLink(app: string, ref: StoreRef, commit: string, path: string): string {
    return `${app}?scene=https://github.com/${ref.owner}/${ref.repo}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export class Publishing {
    constructor(readonly tokens: StoreTokens, readonly stores: Stores, readonly publisher = new StorePublisher()) {
        stores.tokenFor = (key) => this.tokens.get(key);
    }

    // The stores one can publish to: followed, with a token.
    writable(): string[] {
        return this.stores.list().map((s) => s.key).filter((key) => !!this.tokens.get(key));
    }

    // A token for a store, checked (the repository readable and writable with it), then kept: the store followed, in
    // read and write.
    async configure(store: string, token: string): Promise<{ key: string; branch: string; private: boolean }> {
        const ref = parseStoreRef(store);
        if (!ref) throw new PublishError("notFound", store);
        const verified = await this.publisher.verify(ref, token.trim());
        const key = storeKey(ref);
        this.tokens.set(key, token.trim());
        if (this.stores.get(key)) await this.stores.refresh(key);
        else await this.stores.follow(key);
        return { key, ...verified };
    }

    // The store in read only again: its token forgotten by the browser.
    forget(store: string): void {
        this.tokens.remove(store);
        this.stores.refresh(store);
    }

    private target(store: string): { ref: StoreRef; token: string } {
        const ref = parseStoreRef(store), token = this.tokens.get(store);
        if (!ref || !token) throw new PublishError("token", store);
        return { ref, token };
    }

    // Whether a file is in a store (at the head of its branch).
    async exists(store: string, path: string): Promise<boolean> {
        const { ref, token } = this.target(store);
        const { branch } = await this.publisher.verify(ref, token);
        return (await this.publisher.branch(ref, token, branch)).tree.some((e) => e.path == path);
    }

    // Publishes files (path -> content: text, or bytes for a media) to a store: one commit, the index made again from
    // the branch.
    async publish(store: string, files: Map<string, string | Uint8Array>, message: string): Promise<{ commit: string; branch: string; index: StoreIndex }> {
        const { ref, token } = this.target(store);
        let index: StoreIndex = { modules: [], scenes: [] };
        const result = await this.publisher.publish(ref, token, async (branch) => {
            const at = { ...ref, ref: branch.commit };
            let before: StoreIndex | null = null;
            try { before = parseIndex(JSON.parse(await this.stores.reader.text(at, STORE_INDEX, token))); } catch { /* none */ }
            const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
            const texts = new Map([...files].filter((e): e is [string, string] => typeof e[1] == "string"));
            index = await buildIndex(branch.tree, before, (path) => this.stores.reader.text(at, path, token), { files: texts, parent: branch.commit, date });
            return {
                files: [...[...files].map(([path, content]) => (typeof content == "string" ? { path, content } : { path, bytes: content })),
                    { path: STORE_INDEX, content: serializeIndex(index, date) }],
                message,
            };
        });
        // the store read again, fresh (with the token), and followed
        const key = storeKey(ref);
        if (this.stores.get(key)) await this.stores.refresh(key);
        else await this.stores.follow(key);
        return { ...result, index };
    }

    // A scene, and modules with it (path -> code, ScenePlan.ts): one commit.
    async publishScene(store: string, name: string, content: string, modules: Map<string, string> = new Map()): Promise<Published> {
        const path = scenePath(name);
        const replaced = await this.exists(store, path);
        const files = new Map([[path, content], ...modules]);
        const what = `the scene ${name}` + (modules.size ? ` and ${modules.size} module${modules.size > 1 ? "s" : ""} (${[...modules.keys()].map((p) => p.split("/")[1]).join(", ")})` : "");
        const { commit, branch } = await this.publish(store, files, `${replaced ? "Publish again" : "Publish"} ${what} (faustmodular)`);
        return { store, path, commit, branch, replaced, modules: [...modules.keys()] };
    }

    // A scene as it was recorded, its modules (path -> code, ScenePlan.ts), and the recording (FLAC, its description:
    // recordingOf the scene, by its path and the SHA-1 of its content): one commit, the material linked already.
    async publishRecording(store: string, name: string, content: string, modules: Map<string, string>, recording: RecordingToPublish): Promise<Published> {
        if (recording.flac.length > MAX_MEDIA) throw new Error(`the recording is ${Math.round(recording.flac.length / 1048576)} MB (50 MB at most in a store)`);
        const path = scenePath(name);
        const replaced = await this.exists(store, path);
        const description = materialPath(recording.name);
        const dir = description.slice(0, description.lastIndexOf("/") + 1);
        const media = dir + description.slice(dir.length).replace(/\.json$/, ".flac");
        const fiche = {
            format: "fauststore-material", version: 1, kind: "recording", name: recording.name,
            ...recording.description,
            media: { path: media.slice(dir.length), type: "audio/flac", sha1: await bytesSha1(recording.flac), size: recording.flac.length },
            recordingOf: path,
            from: { path, sha1: await sha1(content) },
        };
        const files = new Map<string, string | Uint8Array>([[path, content], ...modules, [media, recording.flac], [description, JSON.stringify(fiche, null, 1) + "\n"]]);
        const what = `the scene ${name}, its recording ${recording.name}` + (modules.size ? ` and ${modules.size} module${modules.size > 1 ? "s" : ""} (${[...modules.keys()].map((p) => p.split("/")[1]).join(", ")})` : "");
        const { commit, branch } = await this.publish(store, files, `${replaced ? "Publish again" : "Publish"} ${what} (faustmodular)`);
        return { store, path, commit, branch, replaced, modules: [...modules.keys()], material: description };
    }

    async publishModule(store: string, name: string, code: string): Promise<Published> {
        const path = modulePath(name);
        const replaced = await this.exists(store, path);
        const { commit, branch } = await this.publish(store, new Map([[path, code]]), `${replaced ? "Publish a new version of" : "Publish"} the module ${name} (faustmodular)`);
        return { store, path, commit, branch, replaced };
    }
}

// The SHA-1 of bytes.
async function bytesSha1(bytes: Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest("SHA-1", bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
