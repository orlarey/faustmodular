/*				STOREINDEX.TS
    The index of a store (Documentation/STORE-SPEC.md, "L'index"), made from the files of the repository: an entry of
    the index before is kept while its file is the same (its git blob), the others are described again from their
    file. At a publication, the files published are new: a module whose code changed keeps its code before in its
    versions, with the commit that contains it. Pure but for reading the files (given).
*/

import { contentsOf, gitBlobSha, moduleEntry, nameOfPath, parseMaterial, StoreIndex, StoreMaterial, StoreModule, StoreScene } from "./StoreFormat";
import { unwrapModuleCode } from "../model/ModuleCode";
import { sha1 } from "../documents/Sha1";

export interface TreeEntry { path: string; sha?: string }

export interface IndexChanges {
    files: Map<string, string>;     // path -> content: the files published (new or replaced)
    parent: string | null;          // the commit before: it contains the versions replaced
    date: string;
}

// The SHA-1 of the codes of the modules of a scene (its file .jfaust): their code without the group faustmodular wraps
// it in, as in the local store.
export async function sceneCodes(content: string): Promise<string[]> {
    try {
        const file = JSON.parse(content);
        const codes = (file.modules ?? []).filter((m: any) => m?.kind == "faust" && typeof m.code == "string")
            .map((m: any) => unwrapModuleCode(m.code)?.code ?? m.code);
        return [...new Set(await Promise.all(codes.map((c: string) => sha1(c))))] as string[];
    } catch {
        return [];
    }
}

// The materials the players of a scene play (`declare uses "<store>:<path>"` in the code of its modules).
export function sceneUses(content: string): string[] {
    try {
        const file = JSON.parse(content);
        const uses = (file.modules ?? []).filter((m: any) => m?.kind == "faust" && typeof m.code == "string")
            .map((m: any) => /^\s*declare\s+uses\s+"([^"]+)"\s*;/m.exec(m.code)?.[1]).filter((u: unknown): u is string => typeof u == "string");
        return [...new Set<string>(uses)];
    } catch {
        return [];
    }
}

// The name of a scene in its file (sceneName), or null.
export function sceneNameIn(content: string): string | null {
    try {
        const name = JSON.parse(content)?.sceneName;
        return typeof name == "string" && name.trim() ? name.trim().slice(0, 200) : null;
    } catch {
        return null;
    }
}

// The index of the files `tree` (with their git blobs), the index before reused where the files are the same; `read`
// reads a file of the repository not described yet; `changes`: the files published, and when.
export async function buildIndex(tree: TreeEntry[], before: StoreIndex | null, read: (path: string) => Promise<string>,
    changes?: IndexChanges): Promise<StoreIndex> {
    const shas = new Map(tree.map((e) => [e.path, e.sha]));
    for (const path of changes?.files.keys() ?? []) if (!shas.has(path)) shas.set(path, undefined);
    const { modules, scenes, materials } = contentsOf([...shas.keys()]);
    const previous = new Map((before?.modules ?? []).map((m) => [m.path, m]));
    const previousScenes = new Map((before?.scenes ?? []).map((s) => [s.path, s]));
    const builtModules = await Promise.all(modules.map(async (path): Promise<StoreModule | null> => {
        const old = previous.get(path);
        const published = changes?.files.get(path);
        if (published === undefined && old && old.sha && old.sha == shas.get(path)) return old;
        let content: string;
        try { content = published ?? await read(path); } catch { return null; }
        const entry: StoreModule = { ...moduleEntry(path, content), code: await sha1(content), sha: await gitBlobSha(content) };
        entry.versions = old?.versions ?? [];
        entry.updated = old?.updated;
        if (old?.code && old.code != entry.code) {
            entry.versions = [{ code: old.code, commit: changes?.parent ?? "", date: old.updated }, ...entry.versions].filter((v) => v.commit);
        }
        if (!old || old.code != entry.code) entry.updated = changes?.date ?? entry.updated;
        if (entry.versions.length == 0) entry.versions = undefined;
        return entry;
    }));
    const builtScenes = await Promise.all(scenes.map(async (path): Promise<StoreScene> => {
        const old = previousScenes.get(path);
        const published = changes?.files.get(path);
        // at a publication, a scene named only by its file (added by hand, or by an index before 3.48.1): its name read
        const named = async (entry: StoreScene) => {
            if (!changes || entry.name != nameOfPath(path)) return entry;
            try { return { ...entry, name: sceneNameIn(await read(path)) ?? entry.name }; } catch { return entry; }
        };
        if (published === undefined && old && (old.sha === undefined || old.sha == shas.get(path))) return named({ ...old, sha: shas.get(path) ?? old.sha });
        const entry: StoreScene = { path, name: old?.name ?? nameOfPath(path), summary: old?.summary, author: old?.author, preview: old?.preview, sha: shas.get(path) };
        if (published !== undefined) {
            entry.name = sceneNameIn(published) ?? entry.name;
            entry.sha = await gitBlobSha(published);
            entry.codes = await sceneCodes(published);
            const uses = sceneUses(published);
            entry.uses = uses.length ? uses : undefined;
            entry.updated = changes!.date;
        } else {
            entry.codes = old?.codes;
            entry.uses = old?.uses;
            entry.updated = old?.updated;
            return named(entry);
        }
        return entry;
    }));
    // the materials: an entry kept while its description is the same, read again otherwise
    const previousMaterials = new Map((before?.materials ?? []).map((m) => [m.path, m]));
    const builtMaterials = await Promise.all(materials.map(async (path): Promise<StoreMaterial | null> => {
        const old = previousMaterials.get(path);
        const published = changes?.files.get(path);
        if (published === undefined && old && old.sha && old.sha == shas.get(path)) return old;
        let content: string;
        try { content = published ?? await read(path); } catch { return null; }
        try { return parseMaterial(JSON.parse(content), path, await gitBlobSha(content)); } catch { return null; }
    }));
    const kept = builtMaterials.filter((m): m is StoreMaterial => m !== null);
    // recordingOf, read the other way: the recordings of each scene; uses, read the other way: the scenes that play
    // each material (a use names a store: "<store>:<path>", matched here by its path)
    for (const scene of builtScenes) {
        const recordings = kept.filter((m) => m.recordingOf == scene.path).map((m) => m.path);
        scene.recordings = recordings.length ? recordings : undefined;
    }
    for (const m of kept) {
        const usedBy = builtScenes.filter((s) => s.uses?.some((u) => u.endsWith(":" + m.path))).map((s) => s.path);
        m.usedBy = usedBy.length ? usedBy : undefined;
    }
    const index: StoreIndex = { modules: builtModules.filter((m): m is StoreModule => m !== null), scenes: builtScenes };
    if (kept.length) index.materials = kept;
    return index;
}
