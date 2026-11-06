/*				PUBLISHING.TS
    Publishing to one's store (Documentation/STORE-SPEC.md, "Publier"): my store (its repository and the token to
    write to it, kept in the browser, only sent to api.github.com), and the publication of a scene or a module in one
    commit, with the index made again. After it: the store read again (fresh, with the token), and the link to share
    the element at the commit published, copied.
*/

import { modulePath, parseIndex, parseStoreRef, scenePath, serializeIndex, STORE_INDEX, storeKey, StoreIndex, StoreRef } from "./StoreFormat";
import { buildIndex } from "./StoreIndex";
import { PublishError, StorePublisher } from "./StorePublisher";
import { Stores } from "./Stores";

const REPO = "faustmodular:my-store";
const TOKEN = "faustmodular:my-store-token";

export class MyStore {
    constructor(private fStorage: Storage | null = MyStore.storage()) { }

    private static storage(): Storage | null {
        try { return localStorage; } catch { return null; }
    }

    get repo(): string | null { return this.fStorage?.getItem(REPO) ?? null; }
    get token(): string | null { return this.fStorage?.getItem(TOKEN) ?? null; }
    get ref(): StoreRef | null { return this.repo ? parseStoreRef(this.repo) : null; }

    save(repo: string, token: string): void {
        try {
            this.fStorage?.setItem(REPO, repo);
            this.fStorage?.setItem(TOKEN, token);
        } catch { /* not kept */ }
    }

    forget(): void {
        try {
            this.fStorage?.removeItem(REPO);
            this.fStorage?.removeItem(TOKEN);
        } catch { /* nothing */ }
    }
}

export interface Published { store: string; path: string; commit: string; branch: string; replaced: boolean }

// The link to open an element published, at its commit: the address of its file on GitHub after ?scene= (STORE-SPEC.md,
// "Partager une scène par son adresse").
export function shareLink(app: string, ref: StoreRef, commit: string, path: string): string {
    return `${app}?scene=https://github.com/${ref.owner}/${ref.repo}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export class Publishing {
    constructor(readonly myStore: MyStore, readonly stores: Stores, readonly publisher = new StorePublisher()) {
        stores.tokenFor = (key) => (this.myStore.ref && storeKey(this.myStore.ref) == key ? this.myStore.token ?? undefined : undefined);
    }

    get ready(): boolean {
        return !!(this.myStore.ref && this.myStore.token);
    }

    // Checks a repository and a token, and keeps them.
    async configure(repo: string, token: string): Promise<{ key: string; branch: string; private: boolean }> {
        const ref = parseStoreRef(repo);
        if (!ref) throw new PublishError("notFound", repo);
        const verified = await this.publisher.verify(ref, token.trim());
        this.myStore.save(storeKey(ref), token.trim());
        return { key: storeKey(ref), ...verified };
    }

    // Whether a file is in my store (at the head of its branch).
    async exists(path: string): Promise<boolean> {
        const ref = this.myStore.ref, token = this.myStore.token;
        if (!ref || !token) return false;
        const { branch } = await this.publisher.verify(ref, token);
        return (await this.publisher.branch(ref, token, branch)).tree.some((e) => e.path == path);
    }

    // Publishes files (path -> content): one commit, the index made again from the branch.
    async publish(files: Map<string, string>, message: string): Promise<{ commit: string; branch: string; index: StoreIndex }> {
        const ref = this.myStore.ref, token = this.myStore.token;
        if (!ref || !token) throw new PublishError("token", "no store");
        let index: StoreIndex = { modules: [], scenes: [] };
        const result = await this.publisher.publish(ref, token, async (branch) => {
            const at = { ...ref, ref: branch.commit };
            let before: StoreIndex | null = null;
            try { before = parseIndex(JSON.parse(await this.stores.reader.text(at, STORE_INDEX, token))); } catch { /* none */ }
            const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
            index = await buildIndex(branch.tree, before, (path) => this.stores.reader.text(at, path, token), { files, parent: branch.commit, date });
            return { files: [...[...files].map(([path, content]) => ({ path, content })), { path: STORE_INDEX, content: serializeIndex(index, date) }], message };
        });
        // the store read again, fresh (with the token), and followed
        const key = storeKey(ref);
        if (this.stores.get(key)) await this.stores.refresh(key);
        else await this.stores.follow(key);
        return { ...result, index };
    }

    async publishScene(name: string, content: string): Promise<Published> {
        const path = scenePath(name);
        const replaced = await this.exists(path);
        const { commit, branch } = await this.publish(new Map([[path, content]]), `${replaced ? "Publish again" : "Publish"} the scene ${name} (faustmodular)`);
        return { store: storeKey(this.myStore.ref!), path, commit, branch, replaced };
    }

    async publishModule(name: string, code: string): Promise<Published> {
        const path = modulePath(name);
        const replaced = await this.exists(path);
        const { commit, branch } = await this.publish(new Map([[path, code]]), `${replaced ? "Publish a new version of" : "Publish"} the module ${name} (faustmodular)`);
        return { store: storeKey(this.myStore.ref!), path, commit, branch, replaced };
    }
}
