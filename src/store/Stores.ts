/*				STORES.TS
    The stores followed (Documentation/STORE-SPEC.md, "Dans faustmodular"): their list, kept in the browser, and
    each one as read (loading, ready, or the reason it cannot be read). The library shows their modules, the File
    menu their scenes.
*/

import { parseStoreRef, storeKey, StoreRef } from "./StoreFormat";
import { OpenedStore, StoreError, StoreReader } from "./StoreReader";

const KEY = "faustmodular:stores";

export interface StoreState {
    key: string;
    ref: StoreRef;
    status: "loading" | "ready" | "error";
    store?: OpenedStore;
    error?: StoreError["reason"];
}

export class Stores {
    private fStates = new Map<string, StoreState>();
    private fListeners: Array<() => void> = [];
    // the token of a store (the one published to): read through the API with it, fresh, private too
    tokenFor: (key: string) => string | undefined = () => undefined;

    constructor(readonly reader: StoreReader = new StoreReader(), private fStorage: Storage | null = Stores.storage()) {
        for (const key of this.saved()) {
            const ref = parseStoreRef(key);
            if (ref) this.fStates.set(key, { key, ref, status: "loading" });
        }
    }

    private static storage(): Storage | null {
        try { return localStorage; } catch { return null; }
    }

    private saved(): string[] {
        try {
            const list = JSON.parse(this.fStorage?.getItem(KEY) ?? "[]");
            return Array.isArray(list) ? list.filter((k) => typeof k == "string") : [];
        } catch {
            return [];
        }
    }

    private save(): void {
        try { this.fStorage?.setItem(KEY, JSON.stringify([...this.fStates.keys()])); } catch { /* not kept */ }
    }

    onChange(listener: () => void): void {
        this.fListeners.push(listener);
    }

    private emit(): void {
        this.fListeners.forEach((l) => l());
    }

    list(): StoreState[] {
        return [...this.fStates.values()];
    }

    get(key: string): StoreState | undefined {
        return this.fStates.get(key);
    }

    // The stores followed, read (at the start).
    loadAll(): Promise<void> {
        return Promise.all(this.list().map((s) => this.load(s.key))).then(() => undefined);
    }

    private async load(key: string): Promise<StoreState | undefined> {
        const state = this.fStates.get(key);
        if (!state) return undefined;
        state.status = "loading";
        this.emit();
        try {
            state.store = await this.reader.open(state.ref, this.tokenFor(key));
            state.status = "ready";
            state.error = undefined;
        } catch (e) {
            state.status = "error";
            state.error = e instanceof StoreError ? e.reason : "network";
        }
        this.emit();
        return state;
    }

    // Follows a store ("owner/repo", or its address on GitHub): read, then kept in the list if it is a store.
    async follow(text: string): Promise<StoreState> {
        const ref = parseStoreRef(text);
        if (!ref) throw new StoreError("notFound", text);
        const key = storeKey(ref);
        const known = this.fStates.get(key);
        if (known?.status == "ready") return known;
        this.fStates.set(key, { key, ref, status: "loading" });
        const state = (await this.load(key))!;
        if (state.status == "error" && !known) {
            this.fStates.delete(key);
            this.emit();
            throw new StoreError(state.error!, key);
        }
        this.save();
        return state;
    }

    unfollow(key: string): void {
        if (!this.fStates.delete(key)) return;
        this.save();
        this.emit();
    }

    // Read again (a publication seen).
    refresh(key: string): Promise<StoreState | undefined> {
        return this.load(key);
    }
}
