/*				DOCUMENTS.TS
    The scene is the open document (Documentation/DOCUMENT-SPEC.md):

    - every new state of the scene (a step of the history, an undo, a redo) is written to the
      document's working copy, or removes it when the scene is back to the committed copy;
    - Save makes the working copy the committed copy; Revert goes back to the committed copy;
    - opening another document, a patch file or an example never replaces a document: the open
      one keeps its copies, a file becomes a new document;
    - one document per tab (decision 10).

    User modules (phase 2): the status of an instance follows from its code. A code of the library
    (library-index.json) is a library module; any other code belongs to the user module that has it
    as a version, or a user module is created for it (a file dropped, an older version of a library
    module...). A code edited in faustcode becomes a new version of the user module of the previous
    code, or the first version of a new user module if the previous code was a library module. An
    instance pinned to an older version gets an update (the latest version, or the current library
    module for an older version of it).

    The operations are serialized; the pending step of the history is recorded first.
*/

import { PatchFileV2, PATCH_FORMAT, PATCH_VERSION } from "../model/PatchFormat";
import { DocumentFormatError, DocumentV4, FaustEnvironment, documentContent, documentFromPatch, patchFromDocument } from "./DocumentFormat";
import { DocumentEntry, DocumentStore, UserModule } from "./DocumentStore";
import { sha1 } from "./Sha1";
import { FileStore, openFileStore } from "./FileStore";

// What the documents need from the scene (Scenes/SceneClass.ts).
export interface DocumentsScene {
    sceneName: string;
    documents: unknown;
    history: { flush(): Promise<void> };
    describePatch(): PatchFileV2;
    replaceScene(json: string, options: { keepIds?: boolean }): Promise<boolean>;
    showUpdate?(id: string, available: boolean): void;              // an update for this instance
    updateModuleCode?(id: string, code: string): Promise<string | null>;   // as an edit in faustcode
}

// public/faust-modules/library-index.json (scripts/build-library-index.mjs)
export interface LibraryIndex {
    modules: Record<string, string>;                                // path -> hash of its code
    history: Record<string, { path: string; until?: string }>;     // hash of a past version -> path
}

export interface DocumentsOptions {
    files?: FileStore;
    environment?: (store: DocumentStore) => Promise<FaustEnvironment>;    // of a new document
    legacyStorage?: Storage | null;                     // the localStorage of the scenes saved before 3.0
    untitled?: string;                                  // name of a new document
    notify?: (message: string) => void;
    library?: () => Promise<LibraryIndex>;              // the modules of the library
    starter?: () => string | null;                      // the patch of the first visit (documents/Starter.ts)
    libraryCode?: (path: string) => Promise<string>;    // the code of a module of the library
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
    private fLibrary = new Map<string, string>();       // hash -> path of the modules of the library
    private fLibraryPaths = new Map<string, string>();  // path -> hash
    private fLibraryHistory = new Map<string, string>(); // hash of a past version -> path
    private fUpdates = new Map<string, string>();       // instance id -> hash of its code

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
        if (options.library) {
            try {
                documents.setLibrary(await options.library());
            } catch (e) {
                console.warn("documents: index of the library unavailable", e);
            }
        }
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
        // the first visit (no document): the scene to start with, if any
        await documents.create(store.list().length == 0 ? options.starter?.() ?? undefined : undefined);
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

    setLibrary(index: LibraryIndex): void {
        this.fLibrary = new Map(Object.entries(index.modules).map(([path, hash]) => [hash, path]));
        this.fLibraryPaths = new Map(Object.entries(index.modules));
        this.fLibraryHistory = new Map(Object.entries(index.history ?? {}).map(([hash, h]) => [hash, h.path]));
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
            await this.store.putCodes(codes);
            await this.resolve(document);
            if (dirty) {
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
                await this.resolve(document);
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
                const loaded = (await this.snapshot(entry.name)).document;
                await this.resolve(loaded);
                if (working) {
                    this.fCommitted = documentContent(committed);
                    this.fDirty = true;
                } else {
                    // as the scene gives it back (modules that no longer compile are not there)
                    this.fCommitted = documentContent(loaded);
                    this.fDirty = false;
                }
            }
            this.fCurrent = this.store.get(id)!;
            await this.store.setLast(id);
            this.emit();
            return true;
        });
    }

    // A new, empty document; or, from a starter patch (the first visit), a document that is replaced, as an
    // empty one, as long as it is not modified.
    async create(starter?: string): Promise<DocumentEntry> {
        await this.flush();
        return this.serialized(async () => {
            const name = this.store.uniqueName(this.fOptions.untitled ?? "Untitled");
            const empty: PatchFileV2 = { format: PATCH_FORMAT, version: PATCH_VERSION, sceneName: name, modules: [], connections: [] };
            await this.dropIfBlank();
            let started = false;
            if (starter) {
                try {
                    const patch = JSON.parse(starter) as PatchFileV2;
                    started = await this.replace(JSON.stringify({ ...patch, sceneName: name }), false);
                } catch (e) {
                    console.warn("documents: starter scene ignored", e);
                }
            }
            if (!started) await this.replace(JSON.stringify(empty), false);
            this.fFaust = this.fEnvironment;
            const entry = await this.adopt(name);
            this.fStarter = started ? entry.id : null;
            return entry;
        });
    }

    // The document of the first visit (create), replaced as an empty one while it is not modified.
    private fStarter: string | null = null;

    // The open document is blank: empty, clean (a new document nobody used). It is replaced, rather
    // than kept, by a new document or a file opened.
    private async dropIfBlank(): Promise<void> {
        const current = this.fCurrent;
        if (!current || this.fDirty) return;
        const { committed, working } = await this.store.read(current.id);
        const starter = current.id == this.fStarter;
        this.fStarter = null;
        if (working || committed.legacy !== undefined) return;
        if (!starter && (committed.instances.length > 0 || committed.connections.length > 0)) return;
        await this.store.setTrashed(current.id, true);
        await this.store.emptyTrashOf(current.id);
        this.fCurrent = null;
    }

    // The scene, as it stands, becomes a new clean document and the open one.
    private async adopt(name: string): Promise<DocumentEntry> {
        const { document, codes } = await this.snapshot(this.store.uniqueName(name));
        await this.store.putCodes(codes);
        await this.resolve(document);
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
        this.emitLibrary();
        if (typeof document != "undefined") document.dispatchEvent(new CustomEvent("documentchange"));
    }

    /******************** USER MODULES ********************/

    // "library" for a code of the library, the user module having it, or undefined.
    statusOf(hash: string): "library" | UserModule | undefined {
        if (this.fLibrary.has(hash)) return "library";
        return this.store.moduleOf(hash);
    }

    // Each instance of a library module or of a user module: a user module is created for the codes
    // that are neither (named after the instance). The instances that can be updated are shown.
    private async resolve(document: DocumentV4): Promise<void> {
        let created = false;
        for (const instance of document.instances) {
            if (this.statusOf(instance.code) !== undefined) continue;
            await this.store.createModule(instance.name, instance.code, this.fLibraryHistory.get(instance.code));
            created = true;
        }
        if (created) this.emitLibrary();
        this.fUpdates = new Map(document.instances.map((i) => [i.id, i.code]));
        for (const instance of document.instances) this.fScene.showUpdate?.(instance.id, this.updateOf(instance.code) !== null);
    }

    private emitLibrary(): void {
        if (typeof document != "undefined") document.dispatchEvent(new CustomEvent("librarychange"));
    }

    // The code an instance with this code can be updated to: the latest version of its user module,
    // or the current library module for an older version of it (null: none).
    private updateOf(hash: string): { hash?: string; path?: string } | null {
        const status = this.statusOf(hash);
        if (status === undefined || status == "library") return null;
        const latest = status.versions[status.versions.length - 1];
        if (latest != hash) return { hash: latest };
        if (status.basedOn && status.versions.length == 1 && this.fLibraryPaths.has(status.basedOn)) return { path: status.basedOn };
        return null;
    }

    // A code edited in faustcode (Scene.editModuleCode): a new version of the user module of the
    // previous code, or the first version of a new user module.
    codeEdited(previous: string, code: string, name: string): void {
        this.serialized(async () => {
            const hash = await sha1(code);
            await this.store.putCodes(new Map([[hash, code]]));
            if (this.statusOf(hash) !== undefined) return;
            const before = this.statusOf(await sha1(previous));
            if (before !== undefined && before != "library") {
                await this.store.addVersion(before.id, hash);
            } else {
                await this.store.createModule(name, hash);
            }
            this.emitLibrary();
        });
    }

    // Updates an instance to the latest version of its module (an edit: undone by Ctrl-Z).
    async updateInstance(id: string): Promise<string | null> {
        await this.flush();
        const hash = this.fUpdates.get(id);
        const target = hash ? this.updateOf(hash) : null;
        if (!target || !this.fScene.updateModuleCode) return "no update";
        const code = target.hash ? await this.store.getCode(target.hash) : await this.fOptions.libraryCode?.(target.path!);
        if (code == null) return "code not found";
        return this.fScene.updateModuleCode(id, code);
    }

    // The latest code of a user module (to add an instance of it).
    async moduleCode(id: string): Promise<{ name: string; code: string } | null> {
        const m = this.store.getModule(id);
        if (!m) return null;
        const code = await this.store.getCode(m.versions[m.versions.length - 1]);
        return code == null ? null : { name: m.name, code };
    }

    async renameModule(id: string, name: string): Promise<void> {
        await this.serialized(() => this.store.renameModule(id, name));
        this.emitLibrary();
    }

    async trashModule(id: string, trashed = true): Promise<void> {
        await this.serialized(() => this.store.setModuleTrashed(id, trashed));
        this.emitLibrary();
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
