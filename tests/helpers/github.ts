// GitHub in memory, for the tests of the store (Documentation/STORE-SPEC.md): the repository o/r and its rights
// behind a token, the branch master, commits, trees, contents, the raw files; the Git API that publishing uses.
import { gitBlobSha } from "../../src/store/StoreFormat";

// GitHub in memory: commits (their files), the branch master, a token that can write.
export function github(initial: Record<string, string>, token = "good") {
    let n = 0;
    const commits = new Map<string, { files: Map<string, string>; parents: string[]; message: string }>();
    const trees = new Map<string, Map<string, string>>();
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
            return files?.has(path) ? new Response(files.get(path)) : new Response("404", { status: 404 });
        }
        const m = /^https:\/\/api\.github\.com\/repos\/o\/r(.*)$/.exec(url);
        if (!m) return json(404, {});
        const rest = m[1];
        if (auth && auth != `Bearer ${token}`) return json(401, {});
        if (rest == "") return json(200, { default_branch: "master", private: false, permissions: { push: auth == `Bearer ${token}` } });
        if (rest.startsWith("/git/trees/HEAD")) return json(200, { tree: await treeOf(commits.get(head)!.files) });
        if (rest == "/git/ref/heads/master") return json(200, { object: { sha: head } });
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
        if (rest == "/git/trees" && method == "POST") {
            const base = commits.get(body.base_tree.slice(1))!.files;
            const files = new Map(base);
            for (const e of body.tree) files.set(e.path, e.content);
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

