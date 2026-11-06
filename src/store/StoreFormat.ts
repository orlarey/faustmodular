/*				STOREFORMAT.TS
    The store (Documentation/STORE-SPEC.md): a GitHub repository with a convened layout. What it contains, read
    and checked: its reference (owner/repo), its manifest (fauststore.json), its index (index.json), the description
    of a module from its code (its declarations), the files of the repository that are modules and scenes. Pure.
*/

export const STORE_MANIFEST = "fauststore.json";
export const STORE_INDEX = "index.json";

// A store: a repository of GitHub, at a ref (a branch, a commit) or its default branch.
export interface StoreRef { owner: string; repo: string; ref: string | null }

const NAME = /^[A-Za-z0-9_.-]+$/;

// "owner/repo", "owner/repo@ref", or the address of the repository on GitHub (…/tree/<ref> included).
export function parseStoreRef(text: string): StoreRef | null {
    let t = (text ?? "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
    let ref: string | null = null;
    const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)(?:\/tree\/(.+))?$/.exec(t);
    if (url) {
        t = url[1] + "/" + url[2];
        ref = url[3] ?? null;
    } else {
        const at = t.indexOf("@");
        if (at >= 0) {
            ref = t.slice(at + 1) || null;
            t = t.slice(0, at);
        }
    }
    const [owner, repo, ...rest] = t.split("/");
    if (rest.length || !owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null;
    if (ref !== null && !/^[A-Za-z0-9_./-]+$/.test(ref)) return null;
    return { owner, repo, ref };
}

export const storeKey = (r: StoreRef) => `${r.owner}/${r.repo}` + (r.ref ? "@" + r.ref : "");

// A path of the repository, relative, without going up or into a hidden folder.
export function safePath(path: unknown): path is string {
    return typeof path == "string" && path.length > 0 && path.length < 512 && !path.startsWith("/")
        && path.split("/").every((p) => p.length > 0 && p != "." && p != ".." && !p.startsWith("."));
}

export interface StoreManifest {
    format: "fauststore";
    version: number;
    name: string;
    description?: string;
    author?: string;
    license?: string;
    language?: string;
}

const text = (v: unknown, max = 2000) => (typeof v == "string" ? v.slice(0, max) : undefined);
const texts = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s == "string").map((s) => s.slice(0, 200)) : []);

// The manifest, or null: not a store (or of a version not known).
export function parseManifest(json: unknown): StoreManifest | null {
    const m = json as any;
    if (!m || m.format != "fauststore" || typeof m.version != "number" || m.version < 1 || m.version >= 2) return null;
    return {
        format: "fauststore", version: m.version, name: text(m.name, 200) ?? "",
        description: text(m.description), author: text(m.author, 200), license: text(m.license, 100), language: text(m.language, 20),
    };
}

export interface StoreModule {
    path: string;
    name: string;
    author?: string;
    license?: string;
    summary: string;
    description: string;
    functions: string[];
    inlets: string[];
    outlets: string[];
    code?: string;              // the SHA-1 of its code
}

export interface StoreScene {
    path: string;
    name: string;
    summary?: string;
    author?: string;
    preview?: string;
}

export interface StoreIndex {
    modules: StoreModule[];
    scenes: StoreScene[];
}

// The index, checked: the entries with a safe path, their texts bounded; null if it is not one.
export function parseIndex(json: unknown): StoreIndex | null {
    const x = json as any;
    if (!x || x.format != "fauststore-index" || !Array.isArray(x.modules) || !Array.isArray(x.scenes)) return null;
    const modules: StoreModule[] = x.modules.filter((m: any) => m && safePath(m.path) && /\.dsp$/i.test(m.path)).map((m: any) => ({
        path: m.path, name: text(m.name, 200) || nameOfPath(m.path), author: text(m.author, 200), license: text(m.license, 100),
        summary: text(m.summary, 500) ?? "", description: text(m.description, 5000) ?? "",
        functions: texts(m.functions), inlets: texts(m.inlets), outlets: texts(m.outlets),
        code: typeof m.code == "string" && /^[0-9a-f]{40}$/.test(m.code) ? m.code : undefined,
    }));
    const scenes: StoreScene[] = x.scenes.filter((s: any) => s && safePath(s.path) && /\.(jfaust|json)$/i.test(s.path)).map((s: any) => ({
        path: s.path, name: text(s.name, 200) || nameOfPath(s.path), summary: text(s.summary, 500), author: text(s.author, 200),
        preview: safePath(s.preview) ? s.preview : undefined,
    }));
    return { modules, scenes };
}

// The name of a file, without its folder and its extension.
export function nameOfPath(path: string): string {
    return path.split("/").pop()!.replace(/\.[^.]*$/, "");
}

function declared(code: string, key: string): string | undefined {
    const m = new RegExp(`^\\s*declare\\s+${key}\\s+"([^"]*)"\\s*;`, "m").exec(code);
    return m ? m[1] : undefined;
}

// The description of a module from its code: its declarations (name, author, license, summary, functions, inlets,
// outlets) and its DESCRIPTION comment, as for the modules of the library.
export function moduleEntry(path: string, code: string): StoreModule {
    const list = (v: string | undefined) => (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);
    const comment = /\/\*\s*=+\s*DESCRIPTION\s*=+\s*([\s\S]*?)\*\//.exec(code);
    const description = comment ? comment[1].trim() : "";
    return {
        path, name: declared(code, "name") ?? nameOfPath(path), author: declared(code, "author"), license: declared(code, "license"),
        summary: declared(code, "summary") ?? description.split("\n")[0]?.replace(/^- /, "") ?? "",
        description,
        functions: [declared(code, "function"), declared(code, "function2")].filter((f): f is string => !!f),
        inlets: list(declared(code, "inlets")), outlets: list(declared(code, "outlets")),
    };
}

// The files of a repository that are modules and scenes (the index rebuilt from the repository).
export function contentsOf(paths: string[]): { modules: string[]; scenes: string[] } {
    const safe = paths.filter(safePath);
    return {
        modules: safe.filter((p) => p.startsWith("modules/") && /\.dsp$/i.test(p)).sort(),
        scenes: safe.filter((p) => p.startsWith("scenes/") && /\.jfaust$/i.test(p)).sort(),
    };
}
