/*				STOREREADER.TS
    Reads a store (Documentation/STORE-SPEC.md, "Lire"), without an account: its manifest, its index and its files
    from raw.githubusercontent.com (CORS, not counted by the limit of the API); without an index, the list of the
    repository in one call of the API (git/trees, recursive) and the description of each module from its code.
*/

import { contentsOf, moduleEntry, nameOfPath, parseIndex, parseManifest, STORE_INDEX, STORE_MANIFEST, StoreIndex, StoreManifest, StoreRef } from "./StoreFormat";

export interface StoreEndpoints { raw: string; api: string }
export const GITHUB: StoreEndpoints = { raw: "https://raw.githubusercontent.com", api: "https://api.github.com" };

export interface OpenedStore {
    ref: StoreRef;
    manifest: StoreManifest;
    index: StoreIndex;
    rebuilt: boolean;           // the index made from the repository (none, or not readable)
}

// Why a store cannot be read: not found (or private), not a store, not reachable.
export class StoreError extends Error {
    constructor(readonly reason: "notFound" | "notAStore" | "network", message: string) { super(message); }
}

type Fetch = (url: string) => Promise<Response>;

export class StoreReader {
    constructor(private fFetch: Fetch = (url) => fetch(url), private fEndpoints: StoreEndpoints = GITHUB) { }

    // The address of a file of a store (its default branch: HEAD).
    rawUrl(ref: StoreRef, path: string): string {
        const encoded = path.split("/").map(encodeURIComponent).join("/");
        return `${this.fEndpoints.raw}/${ref.owner}/${ref.repo}/${ref.ref ?? "HEAD"}/${encoded}`;
    }

    // A file of a store, as text.
    async text(ref: StoreRef, path: string): Promise<string> {
        let response: Response;
        try {
            response = await this.fFetch(this.rawUrl(ref, path));
        } catch (e) {
            throw new StoreError("network", String(e));
        }
        if (response.status == 404) throw new StoreError("notFound", path);
        if (!response.ok) throw new StoreError("network", `${response.status} ${path}`);
        return response.text();
    }

    async open(ref: StoreRef): Promise<OpenedStore> {
        let manifest: StoreManifest | null = null;
        try {
            manifest = parseManifest(JSON.parse(await this.text(ref, STORE_MANIFEST)));
        } catch (e) {
            if (e instanceof StoreError) throw e;
            throw new StoreError("notAStore", STORE_MANIFEST);
        }
        if (!manifest) throw new StoreError("notAStore", STORE_MANIFEST);
        let index: StoreIndex | null = null;
        try {
            index = parseIndex(JSON.parse(await this.text(ref, STORE_INDEX)));
        } catch { /* none, or not readable: made from the repository */ }
        if (index) return { ref, manifest, index, rebuilt: false };
        return { ref, manifest, index: await this.rebuild(ref), rebuilt: true };
    }

    // The index from the repository: its files (one call of the API), the modules described from their code.
    async rebuild(ref: StoreRef): Promise<StoreIndex> {
        let response: Response;
        try {
            response = await this.fFetch(`${this.fEndpoints.api}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(ref.ref ?? "HEAD")}?recursive=1`);
        } catch (e) {
            throw new StoreError("network", String(e));
        }
        if (!response.ok) throw new StoreError(response.status == 404 ? "notFound" : "network", `${response.status} git/trees`);
        const tree = await response.json();
        const paths: string[] = (tree?.tree ?? []).filter((e: any) => e?.type == "blob").map((e: any) => e.path);
        const { modules, scenes } = contentsOf(paths);
        const described = await Promise.all(modules.map(async (path) => {
            try { return moduleEntry(path, await this.text(ref, path)); } catch { return null; }
        }));
        return {
            modules: described.filter((m): m is NonNullable<typeof m> => m !== null),
            scenes: scenes.map((path) => ({ path, name: nameOfPath(path) })),
        };
    }
}
