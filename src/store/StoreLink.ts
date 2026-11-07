/*				STORELINK.TS
    The links to a store (Documentation/STORE-SPEC.md, "Dans faustmodular"):
    ?store=<owner>/<repo>&scene=<path>[&ref=<commit>] opens a scene published, as a new document, without an account;
    ?scene=<the address of the file on GitHub> is the same, the store, the ref and the path taken from it;
    ?store=<owner>/<repo> alone opens the library on that store (followed). The link is then taken off the address:
    reloading the page does not open the scene again. faustcode reads the same links with ?file= in place of ?scene=
    (a module, or any .dsp of GitHub): storeLink(search, "file").
*/

import { parseFileUrl, parseStoreRef, safePath, storeKey } from "./StoreFormat";

export interface StoreLink { store: string; scene?: string }

// `param`: the parameter that names the file ("scene" in faustmodular, "file" in faustcode).
export function storeLink(search: string, param: string = "scene"): StoreLink | null {
    const params = new URLSearchParams(search);
    const scene = params.get(param);
    // ?scene=<the address of the file on GitHub> (STORE-SPEC.md, "Partager une scène par son adresse")
    const file = !params.get("store") && scene ? parseFileUrl(scene) : null;
    if (file) return { store: storeKey(file.ref), scene: file.path };
    const ref = parseStoreRef(params.get("store") ?? "");
    if (!ref) return null;
    const at = params.get("ref");
    if (at && /^[A-Za-z0-9_./-]+$/.test(at)) ref.ref = at;
    return { store: storeKey(ref), scene: scene && safePath(scene) ? scene : undefined };
}

// The address without the link to a store.
export function withoutStoreLink(href: string, param: string = "scene"): string {
    const url = new URL(href);
    for (const p of ["store", param, "ref"]) url.searchParams.delete(p);
    return url.pathname + (url.searchParams.toString() ? "?" + url.searchParams : "") + url.hash;
}
