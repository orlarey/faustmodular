/*				RECALL.TS
    Recalling the scene of a recording (Documentation/MATERIALS-SPEC.md, "Rappeler la scène d'un enregistrement"): the
    scene as it was when the recording started, found by the SHA-1 of its content (from.sha1 of the description of
    the material), even if the scene was published again since:

        1. the scene at the head of the branch, if it is the one;
        2. the scene at the commit that added the description (the scene and its recording are published in one
           commit, 3.52.0);
        3. the versions of the scene before, until one is the one.

    Not found (a recording added by hand, a history rewritten): the scene as it is, said so. Pure but for the reading.
*/

import { parseMaterial, StoreMaterial, StoreRef } from "./StoreFormat";
import { StoreError, StoreReader } from "./StoreReader";
import { sha1 } from "../documents/Sha1";

export interface Recalled {
    material: StoreMaterial;
    scene: string;              // its path
    content: string;            // the file of the scene
    commit: string | null;      // where it was found (null: the head of the branch)
    exact: boolean;             // its SHA-1 is the one of the recording
    how: "head" | "recording" | "history" | "current";
}

// The description of a material from the address of its description or of its media (same folder, same name).
export function descriptionPath(path: string): string {
    return /\.json$/i.test(path) ? path : path.replace(/\.[^./]+$/, ".json");
}

export async function recallScene(reader: StoreReader, ref: StoreRef, path: string, token?: string, versions = 20): Promise<Recalled> {
    const description = descriptionPath(path);
    let material: StoreMaterial | null;
    try {
        material = parseMaterial(JSON.parse(await reader.text(ref, description, token)), description);
    } catch (e) {
        if (e instanceof StoreError) throw e;
        throw new StoreError("notAStore", description);
    }
    const scene = material?.recordingOf ?? material?.from?.path;
    if (!material || !scene) throw new StoreError("notAStore", description);
    const want = material.from?.sha1;
    const at = (commit: string | null) => (commit ? { ...ref, ref: commit } : ref);
    const read = async (commit: string | null): Promise<string | null> => {
        try { return await reader.text(at(commit), scene, token); } catch { return null; }
    };
    const head = await read(null);
    if (head !== null && want && await sha1(head) == want) return { material, scene, content: head, commit: null, exact: true, how: "head" };
    if (want) {
        // the commit of the recording: the oldest that changed its description
        try {
            const commits = await reader.commitsOf(ref, description, token);
            const commit = commits[commits.length - 1];
            if (commit) {
                const content = await read(commit);
                if (content !== null && await sha1(content) == want) return { material, scene, content, commit, exact: true, how: "recording" };
            }
        } catch { /* the API not reachable: below */ }
        // the versions of the scene, the latest first
        try {
            for (const commit of (await reader.commitsOf(ref, scene, token)).slice(0, versions)) {
                const content = await read(commit);
                if (content !== null && await sha1(content) == want) return { material, scene, content, commit, exact: true, how: "history" };
            }
        } catch { /* the API not reachable: below */ }
    }
    if (head === null) throw new StoreError("notFound", scene);
    return { material, scene, content: head, commit: null, exact: false, how: "current" };
}
