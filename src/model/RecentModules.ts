/*				RECENTMODULES.TS
    The modules added last, offered first by the quick add (view/QuickAdd.ts) before anything is typed: their
    keys, the newest first, at most RECENT_MAX, remembered by the browser (localStorage), as a convenience.
    A module of the library or of a store is known by its address, made absolute (the Modules menu gives it
    relative or absolute); a user module ("My modules") by its id, whatever the address of the page.
*/

export const RECENT_KEY = "faustmodular:recent-modules";
export const RECENT_MAX = 8;

type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;

// The key of a module added from an address (App.uploadUrl).
export function recentKey(url: string, base: string): string {
    const user = /#user-module:(.+)$/.exec(url);
    if (user) return "#user-module:" + user[1];
    try {
        return new URL(url, base).href;
    } catch {
        return url;
    }
}

// The keys remembered, the newest first.
export function recentModules(storage: Store): string[] {
    try {
        const list = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
        return Array.isArray(list) ? list.filter((k): k is string => typeof k == "string").slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

// A module added: first of the list, once.
export function recordRecent(storage: Store, key: string): void {
    try {
        const list = [key, ...recentModules(storage).filter((k) => k != key)].slice(0, RECENT_MAX);
        storage?.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
        /* not kept */
    }
}
