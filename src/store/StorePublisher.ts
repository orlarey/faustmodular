/*				STOREPUBLISHER.TS
    Publishes to a store (Documentation/STORE-SPEC.md, "Publier"), with a token limited to its repository (Contents:
    read and write): one commit, through the Git API of GitHub. The branch (its commit, its tree, the files with their
    git blobs); the files to write, made from them (the index made again); a tree on the tree of the branch; a commit;
    the branch moved to it, without forcing: if someone published meanwhile, it starts again on the new commit.
*/

import { StoreError, Fetch, GITHUB, StoreEndpoints } from "./StoreReader";
import { StoreRef } from "./StoreFormat";
import { TreeEntry } from "./StoreIndex";

export interface Branch { name: string; commit: string; tree: TreeEntry[] }
// A file published: text (inline in the tree), or bytes (a media: a blob of the API first, in base64).
export type PublishedFile = { path: string; content: string } | { path: string; bytes: Uint8Array };
export interface Publication { files: PublishedFile[]; message: string }

function base64(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

// Why one cannot publish: no token or not valid, no right to write, the repository empty, GitHub not reachable.
export class PublishError extends Error {
    constructor(readonly reason: "token" | "rights" | "empty" | "notFound" | "network" | "conflict", message: string) { super(message); }
}

export class StorePublisher {
    constructor(private fFetch: Fetch = (url, init) => fetch(url, init), private fEndpoints: StoreEndpoints = GITHUB) { }

    private async call(ref: StoreRef, token: string, rest: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
        let response: Response;
        try {
            response = await this.fFetch(`${this.fEndpoints.api}/repos/${ref.owner}/${ref.repo}${rest}`, {
                method: init.method ?? "GET",
                headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
                body: init.body ? JSON.stringify(init.body) : undefined,
            });
        } catch (e) {
            throw new PublishError("network", String(e));
        }
        if (response.status == 401) throw new PublishError("token", rest);
        if (response.status == 403) throw new PublishError("rights", rest);
        if (response.status == 404) throw new PublishError("notFound", rest);
        if (response.status == 409) throw new PublishError("empty", rest);
        if (response.status == 422) throw new PublishError("conflict", rest);
        if (!response.ok) throw new PublishError("network", `${response.status} ${rest}`);
        return response.json();
    }

    // The token checked: the repository readable and writable with it; its default branch.
    async verify(ref: StoreRef, token: string): Promise<{ branch: string; private: boolean }> {
        const repo = await this.call(ref, token, "");
        if (!repo?.permissions?.push) throw new PublishError("rights", "push");
        return { branch: ref.ref ?? repo.default_branch, private: !!repo.private };
    }

    async branch(ref: StoreRef, token: string, name: string): Promise<Branch> {
        const head = await this.call(ref, token, `/git/ref/heads/${encodeURIComponent(name)}`);
        const commit = await this.call(ref, token, `/git/commits/${head.object.sha}`);
        const tree = await this.call(ref, token, `/git/trees/${commit.tree.sha}?recursive=1`);
        return {
            name, commit: head.object.sha,
            tree: (tree.tree ?? []).filter((e: any) => e.type == "blob").map((e: any) => ({ path: e.path, sha: e.sha })),
        };
    }

    // One commit: the files made by `make` from the branch, on its tree; again (3 times at most) if the branch moved.
    async publish(ref: StoreRef, token: string, make: (branch: Branch) => Promise<Publication>): Promise<{ commit: string; branch: string }> {
        const { branch: name } = await this.verify(ref, token);
        for (let attempt = 0; attempt < 3; attempt++) {
            const branch = await this.branch(ref, token, name);
            const { files, message } = await make(branch);
            const base = (await this.call(ref, token, `/git/commits/${branch.commit}`)).tree.sha;
            const entries = await Promise.all(files.map(async (f) => {
                if ("content" in f) return { path: f.path, mode: "100644", type: "blob", content: f.content };
                const blob = await this.call(ref, token, "/git/blobs", { method: "POST", body: { content: base64(f.bytes), encoding: "base64" } });
                return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
            }));
            const tree = await this.call(ref, token, "/git/trees", { method: "POST", body: { base_tree: base, tree: entries } });
            const commit = await this.call(ref, token, "/git/commits", { method: "POST", body: { message, tree: tree.sha, parents: [branch.commit] } });
            try {
                await this.call(ref, token, `/git/refs/heads/${encodeURIComponent(name)}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
                return { commit: commit.sha, branch: name };
            } catch (e) {
                if (!(e instanceof PublishError) || e.reason != "conflict") throw e;
                // the branch moved: made again on its new commit
            }
        }
        throw new PublishError("conflict", "the branch keeps moving");
    }
}

export { StoreError };
