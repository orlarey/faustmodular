/*				SCENEPLAN.TS
    Publishing a scene publishes its modules too (Documentation/STORE-SPEC.md, "Les scènes"), as files of the store
    (modules/<Name>/<Name>.dsp): faustcode can open them, the library of the store shows them. For each module of the
    scene (its code, without the group faustmodular wraps it in, identified by its SHA-1):

    - a module of the library shipped with faustmodular (its code in library-index.json, now or before): nothing, it is
      public already;
    - in the store with the same code: nothing; an older version of the module of the store: nothing (publishing it
      would take the module back);
    - not in the store: published;
    - in the store under the same name with another code (or another module of the scene with that name): a choice, a
      new version of it, the module under another name (Name-2), or not published.

    The scene itself keeps the codes of its modules: it sounds the same whatever is chosen. Pure.
*/

import { modulePath, StoreIndex } from "./StoreFormat";

export type ModuleStatus = "library" | "same" | "older" | "new" | "conflict";
export type ModuleChoice = "publish" | "version" | "other" | "skip";

export interface SceneModule { name: string; code: string; sha: string }

export interface PlanRow extends SceneModule {
    status: ModuleStatus;
    path: string;                   // its path in the store
    other?: string;                 // a free path, under another name (a conflict)
    library?: string;               // its path in the library of faustmodular
    choice: ModuleChoice;           // what is proposed
    inScene?: boolean;              // the conflict is with another module of the scene
}

// The library of faustmodular: SHA-1 of a code -> its path (library-index.json: now, and before).
export function libraryShas(index: { modules?: Record<string, string>; history?: Record<string, { path: string }> }): Map<string, string> {
    const shas = new Map<string, string>();
    for (const [path, sha] of Object.entries(index?.modules ?? {})) shas.set(sha, path);
    for (const [sha, entry] of Object.entries(index?.history ?? {})) if (!shas.has(sha)) shas.set(sha, entry.path);
    return shas;
}

export function planSceneModules(modules: SceneModule[], index: StoreIndex | null, library: Map<string, string>): PlanRow[] {
    const inStore = new Map((index?.modules ?? []).map((m) => [m.path, m]));
    const taken = new Map<string, string>();        // path -> SHA-1, of this plan
    const free = (name: string) => {
        for (let n = 2; ; n++) {
            const path = modulePath(`${name}-${n}`);
            if (!inStore.has(path) && !taken.has(path)) return path;
        }
    };
    const rows: PlanRow[] = [];
    const seen = new Set<string>();
    for (const m of modules) {
        if (seen.has(m.sha)) continue;
        seen.add(m.sha);
        const path = modulePath(m.name);
        if (library.has(m.sha)) {
            rows.push({ ...m, path, status: "library", library: library.get(m.sha), choice: "skip" });
            continue;
        }
        const entry = inStore.get(path);
        const mine = taken.get(path);
        if (mine !== undefined) {
            // another module of the scene has this name: under another name
            const other = free(m.name);
            taken.set(other, m.sha);
            rows.push({ ...m, path, status: "conflict", other, choice: "other", inScene: true });
        } else if (!entry) {
            taken.set(path, m.sha);
            rows.push({ ...m, path, status: "new", choice: "publish" });
        } else if (entry.code == m.sha) {
            // the path is the one of this module: another module of the scene with this name will not replace it
            taken.set(path, m.sha);
            rows.push({ ...m, path, status: "same", choice: "skip" });
        } else if (entry.versions?.some((v) => v.code == m.sha)) {
            taken.set(path, m.sha);
            rows.push({ ...m, path, status: "older", choice: "skip" });
        } else {
            // most often, the module published before and changed since: a new version
            const other = free(m.name);
            taken.set(path, m.sha);
            rows.push({ ...m, path, status: "conflict", other, choice: "version" });
        }
    }
    return rows;
}

// The files to publish with the scene, as chosen: path -> code.
export function planFiles(rows: PlanRow[]): Map<string, string> {
    const files = new Map<string, string>();
    for (const r of rows) {
        if (r.choice == "publish" || r.choice == "version") files.set(r.path, r.code);
        else if (r.choice == "other" && r.other) files.set(r.other, r.code);
    }
    return files;
}
