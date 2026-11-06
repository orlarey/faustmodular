/*				STOREREADER.TS
    Reads a store (Documentation/STORE-SPEC.md, "Lire"), without an account: its manifest, its index and its files
    from raw.githubusercontent.com (CORS, not counted by the limit of the API), and the list of the repository in one
    call of the API (git/trees, recursive), with the git blob of each file: an entry of the index is kept while its
    file is the same, the others (a module added on GitHub by hand) are described from their file. Without the API
    (its limit reached), the index alone. With a token (the store one publishes to, private or just published), the
    files are read through the API, fresh.
*/

import { parseIndex, parseManifest, STORE_INDEX, STORE_MANIFEST, StoreIndex, StoreManifest, StoreRef } from "./StoreFormat";
import { buildIndex, TreeEntry } from "./StoreIndex";

export interface StoreEndpoints { raw: string; api: string }
export const GITHUB: StoreEndpoints = { raw: "https://raw.githubusercontent.com", api: "https://api.github.com" };

export interface OpenedStore {
    ref: StoreRef;
    manifest: StoreManifest;
    index: StoreIndex;
    rebuilt: boolean;           // no index in the store: made from the repository
}

// Why a store cannot be read: not found (or private), not a store, not reachable.
export class StoreError extends Error {
    constructor(readonly reason: "notFound" | "notAStore" | "network", message: string) { super(message); }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class StoreReader {
    constructor(private fFetch: Fetch = (url, init) => fetch(url, init), private fEndpoints: StoreEndpoints = GITHUB) { }

    // The address of a file of a store (its default branch: HEAD).
    rawUrl(ref: StoreRef, path: string): string {
        const encoded = path.split("/").map(encodeURIComponent).join("/");
        return `${this.fEndpoints.raw}/${ref.owner}/${ref.repo}/${ref.ref ?? "HEAD"}/${encoded}`;
    }

    private apiUrl(ref: StoreRef, rest: string): string {
        return `${this.fEndpoints.api}/repos/${ref.owner}/${ref.repo}/${rest}`;
    }

    // A call of the API: with a token, authorized.
    private api(url: string, token?: string, accept = "application/vnd.github+json"): Promise<Response> {
        const headers: Record<string, string> = { Accept: accept };
        if (token) headers.Authorization = `Bearer ${token}`;
        return this.fFetch(url, token ? { headers } : undefined);
    }

    // A file of a store, as text (with a token: through the API, fresh, a private store too).
    async text(ref: StoreRef, path: string, token?: string): Promise<string> {
        let response: Response;
        try {
            const encoded = path.split("/").map(encodeURIComponent).join("/");
            response = token
                ? await this.api(this.apiUrl(ref, `contents/${encoded}`) + (ref.ref ? `?ref=${encodeURIComponent(ref.ref)}` : ""), token, "application/vnd.github.raw")
                : await this.fFetch(this.rawUrl(ref, path));
        } catch (e) {
            throw new StoreError("network", String(e));
        }
        if (response.status == 404) throw new StoreError("notFound", path);
        if (!response.ok) throw new StoreError("network", `${response.status} ${path}`);
        return response.text();
    }

    async open(ref: StoreRef, token?: string): Promise<OpenedStore> {
        let manifest: StoreManifest | null = null;
        try {
            manifest = parseManifest(JSON.parse(await this.text(ref, STORE_MANIFEST, token)));
        } catch (e) {
            if (e instanceof StoreError) throw e;
            throw new StoreError("notAStore", STORE_MANIFEST);
        }
        if (!manifest) throw new StoreError("notAStore", STORE_MANIFEST);
        let index: StoreIndex | null = null;
        try {
            index = parseIndex(JSON.parse(await this.text(ref, STORE_INDEX, token)));
        } catch { /* none, or not readable: made from the repository */ }
        let tree: TreeEntry[];
        try {
            tree = await this.tree(ref, token);
        } catch (e) {
            // the API not reachable (its limit): the index alone
            if (index) return { ref, manifest, index, rebuilt: false };
            throw e;
        }
        return { ref, manifest, index: await buildIndex(tree, index, (path) => this.text(ref, path, token)), rebuilt: !index };
    }

    // The files of the repository, with their git blobs (one call of the API).
    async tree(ref: StoreRef, token?: string): Promise<TreeEntry[]> {
        let response: Response;
        try {
            response = await this.api(this.apiUrl(ref, `git/trees/${encodeURIComponent(ref.ref ?? "HEAD")}?recursive=1`), token);
        } catch (e) {
            throw new StoreError("network", String(e));
        }
        if (!response.ok) throw new StoreError(response.status == 404 ? "notFound" : "network", `${response.status} git/trees`);
        const tree = await response.json();
        return (tree?.tree ?? []).filter((e: any) => e?.type == "blob" && typeof e.path == "string").map((e: any) => ({ path: e.path, sha: e.sha }));
    }
}
