/*				DOCUMENTS.TS
    The scene is the open document (Documentation/DOCUMENT-SPEC.md):

    - every new state of the scene (a step of the history, an undo, a redo) is written to the
      document's working copy, or removes it when the scene is back to the committed copy;
    - Save makes the working copy the committed copy; Revert goes back to the committed copy;
    - opening another document, a patch file or an example never replaces a document: the open
      one keeps its copies, a file becomes a new document;
    - one document per tab (decision 10).

    The operations are serialized; the pending step of the history is recorded first.
*/

import { PatchFileV2, PATCH_FORMAT, PATCH_VERSION } from "../model/PatchFormat";
import { DocumentFormatError, DocumentV4, FaustEnvironment, documentContent, documentFromPatch, patchFromDocument } from "./DocumentFormat";
import { DocumentEntry, DocumentStore } from "./DocumentStore";
import { FileStore, openFileStore } from "./FileStore";

// What the documents need from the scene (Scenes/SceneClass.ts).
export interface DocumentsScene {
    sceneName: string;
    documents: unknown;
    history: { flush(): Promise<void> };
    describePatch(): PatchFileV2;
    replaceScene(json: string, options: { keepIds?: boolean }): Promise<boolean>;
}

export interface DocumentsOptions {
    files?: FileStore;
    environment?: (store: DocumentStore) => Promise<FaustEnvironment>;    // of a new document
    legacyStorage?: Storage | null;                     // the localStorage of the scenes saved before 3.0
    untitled?: string;                                  // name of a new document
    notify?: (message: string) => void;
}

export const LEGACY_KEY = "FaustPlayground";
const DAY = 24 * 3600 * 1000;

export class Documents {
    private fCurrent: DocumentEntry | null = null;
    private fFaust: FaustEnvironment;                   // environment recorded by the open document
    private fCommitted = "";                            // content of its committed copy
    private fDirty = false;
    private fQueue: Promise<unknown> = Promise.resolve();
    private fSuspended = 0;                             // the scene is being replaced: its states are not saved

    private constructor(readonly store: DocumentStore, private fScene: DocumentsScene, private fEnvironment: FaustEnvironment, private fOptions: DocumentsOptions) {
        this.fFaust = fEnvironment;
    }

    // Opens the storage, migrates the scenes of the localStorage (once), and opens the last document.
    static async start(scene: DocumentsScene, options: DocumentsOptions = {}): Promise<Documents> {
        const store = await DocumentStore.open(options.files ?? await openFileStore());
        const environment = options.environment ? await options.environment(store).catch((e) => {
            console.warn("documents: environment of the libraries unknown", e);
            return { libfaust: "", libraries: null };
        }) : { libfaust: "", libraries: null };
        const documents = new Documents(store, scene, environment, options);
        await documents.migrate(options.legacyStorage ?? null);
        try {
            const removed = await store.collect();
            if (removed > 0) console.info(`documents: ${removed} unused codes removed`);
        } catch (e) {
            console.warn("documents: collection of the codes failed", e);
        }
        scene.documents = documents;
        const last = store.last && store.get(store.last) && store.get(store.last)!.trashed === undefined ? store.last : store.list()[0]?.id;
        if (last && await documents.open(last)) return documents;
        await documents.create();
        return documents;
    }

    get current(): DocumentEntry | null {
        return this.fCurrent ? { ...this.fCurrent } : null;
    }

    get dirty(): boolean {
        return this.fDirty;
    }

    get storage(): FileStore["kind"] {
        return this.store.files.kind;
    }

    private serialized<T>(task: () => Promise<T>): Promise<T> {
        const run = this.fQueue.then(task, task);
        this.fQueue = run.catch((e) => console.error("documents:", e));
        return run;
    }

    private emit(): void {
        if (this.fCurrent) this.fScene.sceneName = this.fCurrent.name;
        if (typeof document != "undefined") document.dispatchEvent(new CustomEvent("documentchange"));
    }

    private async snapshot(name: string, faust = this.fFaust): Promise<{ document: DocumentV4; codes: Map<string, string> }> {
        return documentFromPatch(this.fScene.describePatch(), name, faust);
    }

    // The pending step of the history recorded, and the saves written.
    async flush(): Promise<void> {
        await this.fScene.history.flush();
        await this.serialized(async () => undefined);
    }

    // A new state of the scene: the working copy follows it.
    changed(): void {
        if (this.fSuspended > 0) return;
        this.serialized(async () => {
            const current = this.fCurrent;
            if (!current || this.fSuspended > 0) return;
            const { document, codes } = await this.snapshot(current.name);
            const dirty = documentContent(document) != this.fCommitted;
            if (dirty) {
                await this.store.putCodes(codes);
                await this.store.writeWorking(current.id, document);
            } else if (this.fDirty) {
                await this.store.writeWorking(current.id, null);
            }
            if (dirty != this.fDirty) {
                this.fDirty = dirty;
                this.emit();
            }
        });
    }

    // Replaces the scene, without saving its states meanwhile.
    private async replace(json: string, keepIds: boolean): Promise<boolean> {
        this.fSuspended++;
        try {
            return await this.fScene.replaceScene(json, { keepIds });
        } finally {
            this.fSuspended--;
        }
    }

    private notify(message: string): void {
        if (this.fOptions.notify) this.fOptions.notify(message); else console.warn(message);
    }

    /******************** OPERATIONS ********************/

    // Opens a document (its working copy if any). false if it cannot be read.
    async open(id: string): Promise<boolean> {
        await this.flush();
        return this.serialized(async () => {
            const entry = this.store.get(id);
            if (!entry) return false;
            let copies: { committed: DocumentV4; working: DocumentV4 | null };
            try {
                copies = await this.store.read(id);
            } catch (e) {
                this.notify(`${entry.name}: ${(e as Error).message}`);
                return false;
            }
            const { committed, working } = copies;
            if (committed.legacy !== undefined) {
                // a scene of the localStorage, converted the first time it is opened
                if (!(await this.replace(committed.legacy, false))) return false;
                this.fFaust = this.fEnvironment;
                const { document, codes } = await this.snapshot(entry.name);
                await this.store.putCodes(codes);
                await this.store.commit(id, document);
                this.fCommitted = documentContent(document);
                this.fDirty = false;
            } else {
                const shown = working ?? committed;
                const codes = await this.store.codesOf(shown);
                let file: PatchFileV2;
                try {
                    file = patchFromDocument(shown, (hash) => codes.get(hash));
                } catch (e) {
                    if (!(e instanceof DocumentFormatError)) throw e;
                    this.notify(`${entry.name}: ${e.message}`);
                    return false;
                }
                if (!(await this.replace(JSON.stringify(file), true))) return false;
                this.fFaust = shown.faust;
                if (working) {
                    this.fCommitted = documentContent(committed);
                    this.fDirty = true;
                } else {
                    // as the scene gives it back (modules that no longer compile are not there)
                    this.fCommitted = documentContent((await this.snapshot(entry.name)).document);
                    this.fDirty = false;
                }
            }
            this.fCurrent = this.store.get(id)!;
            await this.store.setLast(id);
            this.emit();
            return true;
        });
    }

    // A new, empty document.
    async create(): Promise<DocumentEntry> {
        await this.flush();
        return this.serialized(async () => {
            const name = this.store.uniqueName(this.fOptions.untitled ?? "Untitled");
            const empty: PatchFileV2 = { format: PATCH_FORMAT, version: PATCH_VERSION, sceneName: name, modules: [], connections: [] };
            await this.dropIfBlank();
            await this.replace(JSON.stringify(empty), false);
            this.fFaust = this.fEnvironment;
            return this.adopt(name);
        });
    }

    // The open document is blank: empty, clean (a new document nobody used). It is replaced, rather
    // than kept, by a new document or a file opened.
    private async dropIfBlank(): Promise<void> {
        const current = this.fCurrent;
        if (!current || this.fDirty) return;
        const { committed, working } = await this.store.read(current.id);
        if (working || committed.legacy !== undefined || committed.instances.length > 0 || committed.connections.length > 0) return;
        await this.store.setTrashed(current.id, true);
        await this.store.emptyTrashOf(current.id);
        this.fCurrent = null;
    }

    // The scene, as it stands, becomes a new clean document and the open one.
    private async adopt(name: string): Promise<DocumentEntry> {
        const { document, codes } = await this.snapshot(this.store.uniqueName(name));
        await this.store.putCodes(codes);
        const entry = await this.store.create(document.name, document);
        this.fCurrent = entry;
        this.fCommitted = documentContent(document);
        this.fDirty = false;
        await this.store.setLast(entry.id);
        this.emit();
        return { ...entry };
    }

    // A patch file (file, example, Google Drive) opened: it becomes a new document.
    async importPatch(json: string): Promise<boolean> {
        await this.flush();
        return this.serialized(async () => {
            if (!(await this.replace(json, false))) return false;
            await this.dropIfBlank();
            this.fFaust = this.fEnvironment;
            await this.adopt(this.fScene.sceneName || this.fOptions.untitled || "Untitled");
            return true;
        });
    }

    // The working copy becomes the committed copy.
    async save(): Promise<void> {
        await this.flush();
        await this.serialized(async () => {
            const current = this.fCurrent;
            if (!current) return;
            const { document, codes } = await this.snapshot(current.name);
            await this.store.putCodes(codes);
            await this.store.commit(current.id, document);
            this.fCommitted = documentContent(document);
            this.fDirty = false;
            this.emit();
        });
    }

    // The scene becomes a new document; the original goes back to its committed copy.
    async saveAs(name: string): Promise<DocumentEntry | null> {
        await this.flush();
        return this.serialized(async () => {
            const original = this.fCurrent;
            if (original) await this.store.writeWorking(original.id, null);
            return this.adopt(name);
        });
    }

    // Back to the committed copy: the working copy is dropped.
    async revert(): Promise<void> {
        await this.flush();
        const current = this.fCurrent;
        if (!current || !this.fDirty) return;
        await this.serialized(() => this.store.writeWorking(current.id, null));
        await this.open(current.id);
    }

    async rename(name: string, id = this.fCurrent?.id): Promise<string | null> {
        if (!id) return null;
        await this.flush();
        return this.serialized(async () => {
            const given = await this.store.rename(id, name);
            if (this.fCurrent?.id == id) {
                this.fCurrent = this.store.get(id)!;
                this.emit();
            } else if (typeof document != "undefined") {
                document.dispatchEvent(new CustomEvent("documentchange"));
            }
            return given;
        });
    }

    // A copy of a document (as it stands), not opened.
    async duplicate(id: string): Promise<DocumentEntry> {
        await this.flush();
        const entry = await this.serialized(() => this.store.duplicate(id));
        if (typeof document != "undefined") document.dispatchEvent(new CustomEvent("documentchange"));
        return entry;
    }

    // To the trash. The open document is replaced by the most recent other one (or a new one).
    async trash(id: string): Promise<void> {
        await this.flush();
        await this.serialized(() => this.store.setTrashed(id, true));
        if (this.fCurrent?.id == id) {
            this.fCurrent = null;
            const next = this.store.list()[0];
            if (!next || !(await this.open(next.id))) await this.create();
        } else if (typeof document != "undefined") {
            document.dispatchEvent(new CustomEvent("documentchange"));
        }
    }

    async restore(id: string): Promise<void> {
        await this.serialized(() => this.store.setTrashed(id, false));
        if (typeof document != "undefined") document.dispatchEvent(new CustomEvent("documentchange"));
    }

    async emptyTrash(): Promise<void> {
        await this.serialized(async () => {
            await this.store.emptyTrash();
            await this.store.collect();
        });
        if (typeof document != "undefined") document.dispatchEvent(new CustomEvent("documentchange"));
    }

    /******************** MIGRATION ********************/

    // The scenes saved in the localStorage (key "FaustPlayground": [[name, json], ...]) become
    // documents, converted when first opened. The key is kept, then removed after 7 days and 2 starts.
    private async migrate(storage: Storage | null): Promise<void> {
        if (!storage) return;
        const state = this.store.migration;
        if (!state) {
            let scenes: Array<[string, string]> = [];
            try {
                const value = JSON.parse(storage.getItem(LEGACY_KEY) ?? "[]");
                if (Array.isArray(value)) scenes = value.filter((s) => Array.isArray(s) && typeof s[0] == "string" && typeof s[1] == "string");
            } catch (e) {
                console.warn("documents: scenes of the localStorage unreadable", e);
            }
            for (const [name, json] of scenes) {
                await this.store.create(name, { format: "faustmodular-document", version: 4, name, legacy: json } as DocumentV4);
            }
            await this.store.setMigration({ done: Date.now(), starts: 0 });
            if (scenes.length > 0) console.info(`documents: ${scenes.length} scenes of the localStorage migrated`);
            return;
        }
        const starts = state.starts + 1;
        const clear = !state.cleared && starts >= 2 && Date.now() - state.done >= 7 * DAY;
        if (clear) storage.removeItem(LEGACY_KEY);
        await this.store.setMigration({ ...state, starts, cleared: state.cleared || clear });
    }
}
