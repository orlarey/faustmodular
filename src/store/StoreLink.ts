/*				STORELINK.TS
    The links to a store (Documentation/STORE-SPEC.md, "Dans faustmodular"):
    ?store=<owner>/<repo>&scene=<path>[&ref=<commit>] opens a scene published, as a new document, without an account;
    ?store=<owner>/<repo> alone opens the library on that store (followed). The link is then taken off the address:
    reloading the page does not open the scene again.
*/

import { parseStoreRef, safePath, storeKey } from "./StoreFormat";

export interface StoreLink { store: string; scene?: string }

export function storeLink(search: string): StoreLink | null {
    const params = new URLSearchParams(search);
    const ref = parseStoreRef(params.get("store") ?? "");
    if (!ref) return null;
    const at = params.get("ref");
    if (at && /^[A-Za-z0-9_./-]+$/.test(at)) ref.ref = at;
    const scene = params.get("scene");
    return { store: storeKey(ref), scene: scene && safePath(scene) ? scene : undefined };
}

// The address without the link to a store.
export function withoutStoreLink(href: string): string {
    const url = new URL(href);
    for (const p of ["store", "scene", "ref"]) url.searchParams.delete(p);
    return url.pathname + (url.searchParams.toString() ? "?" + url.searchParams : "") + url.hash;
}
