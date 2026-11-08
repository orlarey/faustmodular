// GitHub in memory, for the tests of the store (Documentation/STORE-SPEC.md): the repository o/r and its rights
// behind a token, the branch master, commits, trees, contents, the raw files; the Git API that publishing uses.
import { gitBlobSha } from "../../src/store/StoreFormat";

// GitHub in memory: commits (their files), the branch master, a token that can write.
export function github(initial: Record<string, string>, token = "good") {
    let n = 0;
    const commits = new Map<string, { files: Map<string, string>; parents: string[]; message: string }>();
    const trees = new Map<string, Map<string, string>>();
    const blobs = new Map<string, string>();
    const binary = new Set<string>();           // the paths of media (bytes)
    const blobPaths = new Set<string>();
    const id = () => (++n).toString(16).padStart(40, "0");
    const first = id();
    commits.set(first, { files: new Map(Object.entries(initial)), parents: [], message: "init" });
    let head = first;
    const calls: string[] = [];
    let moveOnce: (() => void) | null = null;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const treeOf = async (files: Map<string, string>) => Promise.all([...files].map(async ([path, c]) => ({ path, type: "blob", sha: await gitBlobSha(c) })));
    const fetch = async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push(method + " " + url.replace("https://api.github.com/repos/o/r", ""));
        const auth = (init?.headers as any)?.Authorization;
        const raw = /^https:\/\/raw\.githubusercontent\.com\/o\/r\/([^/]+)\/(.+)$/.exec(url);
        if (raw) {
            const files = commits.get(raw[1] == "HEAD" ? head : raw[1])?.files;
            const path = decodeURIComponent(raw[2]);
            if (!files?.has(path)) return new Response("404", { status: 404 });
            // a media: its bytes (kept as a binary string)
            return new Response(binary.has(path) ? Buffer.from(files.get(path)!, "latin1") : files.get(path));
        }
        const m = /^https:\/\/api\.github\.com\/repos\/o\/r(.*)$/.exec(url);
        if (!m) return json(404, {});
        const rest = m[1];
        if (auth && auth != `Bearer ${token}`) return json(401, {});
        if (rest == "") return json(200, { default_branch: "master", private: false, permissions: { push: auth == `Bearer ${token}` } });
        if (rest.startsWith("/git/trees/HEAD")) return json(200, { tree: await treeOf(commits.get(head)!.files) });
        if (rest == "/git/ref/heads/master") return json(200, { object: { sha: head } });
        if (rest == "/commits/HEAD" && method == "GET") return json(200, { sha: head });
        // the commits that changed a file, the latest first (from the head, along the first parents)
        const log = /^\/commits\?path=([^&]+)&sha=([^&]+)/.exec(rest);
        if (log && method == "GET") {
            const path = decodeURIComponent(log[1]);
            const out: Array<{ sha: string }> = [];
            for (let c: string | undefined = log[2] == "HEAD" ? head : log[2]; c;) {
                const commit = commits.get(c)!;
                const parent = commit.parents[0];
                const before = parent ? commits.get(parent)!.files.get(path) : undefined;
                if (commit.files.get(path) !== before) out.push({ sha: c });
                c = parent;
            }
            return json(200, out);
        }
        let c = /^\/git\/commits\/(\w+)$/.exec(rest);
        if (c && method == "GET") return json(200, { sha: c[1], tree: { sha: "t" + c[1] } });
        c = /^\/git\/trees\/t(\w+)\?recursive=1$/.exec(rest);
        if (c) return json(200, { tree: await treeOf(commits.get(c[1])!.files) });
        const contents = /^\/contents\/([^?]+)(?:\?ref=(\w+))?$/.exec(rest);
        if (contents) {
            const files = commits.get(contents[2] ?? head)!.files;
            const path = contents[1].split("/").map(decodeURIComponent).join("/");
            return files.has(path) ? new Response(files.get(path)) : json(404, {});
        }
        if (!auth) return json(401, {});
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (rest == "/git/blobs" && method == "POST") {
            // a blob in base64: kept as a binary string (latin1), its git sha computed on its bytes
            const content = Buffer.from(body.content, body.encoding == "base64" ? "base64" : "utf8").toString("latin1");
            blobPaths.add(content);
            const sha = "b" + id().slice(1);
            blobs.set(sha, content);
            return json(201, { sha });
        }
        if (rest == "/git/trees" && method == "POST") {
            const base = commits.get(body.base_tree.slice(1))!.files;
            const files = new Map(base);
            for (const e of body.tree) {
                files.set(e.path, e.sha ? blobs.get(e.sha)! : e.content);
                if (e.sha) binary.add(e.path);
            }
            const sha = "x" + id().slice(1);
            trees.set(sha, files);
            return json(201, { sha });
        }
        if (rest == "/git/commits" && method == "POST") {
            const sha = id();
            commits.set(sha, { files: trees.get(body.tree)!, parents: body.parents, message: body.message });
            return json(201, { sha });
        }
        if (rest == "/git/refs/heads/master" && method == "PATCH") {
            if (moveOnce) { const move = moveOnce; moveOnce = null; move(); }
            if (commits.get(body.sha)!.parents[0] != head) return json(422, { message: "not a fast forward" });
            head = body.sha;
            return json(200, {});
        }
        return json(404, {});
    };
    return {
        fetch, calls,
        get head() { return head; },
        // a media added by hand (its bytes)
        putBytes(path: string, bytes: Uint8Array) {
            binary.add(path);
            this.put(path, Buffer.from(bytes).toString("latin1"));
        },
        // a file changed by hand (a commit on the branch)
        put(path: string, content: string) {
            const sha = id();
            commits.set(sha, { files: new Map([...commits.get(head)!.files, [path, content]]), parents: [head], message: "by hand" });
            head = sha;
        },
        files: () => commits.get(head)!.files,
        commit: (sha: string) => commits.get(sha)!,
        // someone else publishes, between the commit made and the branch moved
        moveDuringNext(path: string, content: string) {
            moveOnce = () => {
                const sha = id();
                commits.set(sha, { files: new Map([...commits.get(head)!.files, [path, content]]), parents: [head], message: "by hand" });
                head = sha;
            };
        },
    };
}

