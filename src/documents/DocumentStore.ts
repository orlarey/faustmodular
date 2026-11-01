/*				DOCUMENTSTORE.TS
    The documents and the store of codes (Documentation/DOCUMENT-SPEC.md, "Le stockage"):

        index.json                      documents: id, name, dates, trash; migration state
        documents/<id>/committed.json   committed copy (what Save wrote)
        documents/<id>/working.json     working copy (absent when the document is clean)
        codes/<sha1>.dsp                codes, shared by all the documents
        libraries/<sha1>.lib            files of the Faust libraries
        environments/<sha1>.json        environments: name of a .lib file -> hash
        modules/<id>.json               user modules: name, versions (hashes of codes), trash

    A code is written before the documents that reference it, and the index last. All the
    operations are serialized, so that two writes of the index never overlap.
*/

import { DocumentFormatError, DocumentV4, parseDocument } from "./DocumentFormat";
import { FileStore } from "./FileStore";
import { normalizeText, sha1 } from "./Sha1";

export interface DocumentEntry {
    id: string;
    name: string;
    created: number;
    modified: number;           // last write of a copy
    trashed?: number;           // in the trash since
}

// A module of the user (Documentation/DOCUMENT-SPEC.md, "La bibliothèque de modules"): a name given
// to a code and to the sequence of its versions. Its instances are pinned to a version (a hash).
export interface UserModule {
    id: string;
    name: string;
    category?: string;
    versions: string[];         // hashes of codes, oldest first
    created: number;
    modified: number;
    trashed?: number;
    basedOn?: string;           // path of the library module it is an older version of
}

export interface MigrationState {
    done: number;               // date of the migration of the localStorage scenes
    starts: number;             // successful starts since
    cleared?: boolean;          // the old key has been removed
}

interface Index {
    version: 1;
    documents: DocumentEntry[];
    last?: string;              // the document opened last
    migration?: MigrationState;
}

const INDEX = "index.json";
const committedPath = (id: string) => `documents/${id}/committed.json`;
const workingPath = (id: string) => `documents/${id}/working.json`;

function newId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class DocumentStore {
    private fIndex: Index = { version: 1, documents: [] };
    private fCodes = new Set<string>();         // hashes known to be stored
    private fModules = new Map<string, UserModule>();
    private fQueue: Promise<unknown> = Promise.resolve();

    private constructor(readonly files: FileStore) { }

    static async open(files: FileStore): Promise<DocumentStore> {
        const store = new DocumentStore(files);
        const text = await files.read(INDEX);
        if (text) {
            try {
                const index = JSON.parse(text);
                if (Array.isArray(index?.documents)) store.fIndex = { version: 1, documents: index.documents, last: index.last, migration: index.migration };
            } catch (e) {
                console.error("documents: index.json unreadable, rebuilt from the documents", e);
                await store.rebuildIndex();
            }
        } else if ((await files.list("documents")).length > 0) {
            await store.rebuildIndex();     // documents without an index
        }
        for (const name of await files.list("codes")) store.fCodes.add(name.replace(/\.dsp$/, ""));
        for (const name of await files.list("modules")) {
            try {
                const m = JSON.parse((await files.read(`modules/${name}`)) ?? "");
                if (typeof m?.id == "string" && typeof m.name == "string" && Array.isArray(m.versions)) store.fModules.set(m.id, m);
            } catch (e) {
                console.error(`documents: user module ${name} unreadable`, e);
            }
        }
        return store;
    }

    // An index lost: the documents found on disk are listed again.
    private async rebuildIndex(): Promise<void> {
        const documents: DocumentEntry[] = [];
        for (const id of await this.files.list("documents")) {
            const text = await this.files.read(committedPath(id));
            if (!text) continue;
            try {
                const d = parseDocument(JSON.parse(text));
                documents.push({ id, name: d.name, created: Date.now(), modified: Date.now() });
            } catch { /* not a document */ }
        }
        this.fIndex = { version: 1, documents };
    }

    private serialized<T>(task: () => Promise<T>): Promise<T> {
        const run = this.fQueue.then(task, task);
        this.fQueue = run.catch(() => undefined);
        return run;
    }

    private writeIndex(): Promise<void> {
        return this.files.write(INDEX, JSON.stringify(this.fIndex));
    }

    /******************** DOCUMENTS ********************/

    // The documents, most recently modified first (trash excluded unless asked).
    list(trashed = false): DocumentEntry[] {
        return this.fIndex.documents.filter((d) => (d.trashed !== undefined) == trashed).sort((a, b) => b.modified - a.modified).map((d) => ({ ...d }));
    }

    get(id: string): DocumentEntry | undefined {
        const entry = this.fIndex.documents.find((d) => d.id == id);
        return entry ? { ...entry } : undefined;
    }

    get last(): string | undefined {
        return this.fIndex.last;
    }

    // A name not used by another document (trash included): "Name", "Name 2", "Name 3"...
    uniqueName(name: string, except?: string): string {
        const base = name.trim() || "Untitled";
        const used = new Set(this.fIndex.documents.filter((d) => d.id != except).map((d) => d.name));
        if (!used.has(base)) return base;
        const stem = base.replace(/ \d+$/, "");
        let n = 2;
        while (used.has(`${stem} ${n}`)) n++;
        return `${stem} ${n}`;
    }

    // A new document whose committed copy is `document` (its codes must be stored before).
    create(name: string, document: DocumentV4): Promise<DocumentEntry> {
        return this.serialized(async () => {
            const now = Date.now();
            const entry: DocumentEntry = { id: newId(), name: this.uniqueName(name), created: now, modified: now };
            await this.files.write(committedPath(entry.id), JSON.stringify({ ...document, name: entry.name }));
            this.fIndex.documents.push(entry);
            await this.writeIndex();
            return { ...entry };
        });
    }

    async read(id: string): Promise<{ committed: DocumentV4; working: DocumentV4 | null }> {
        const committedText = await this.files.read(committedPath(id));
        if (!committedText) throw new DocumentFormatError(`document ${id} not found`);
        const committed = parseDocument(JSON.parse(committedText));
        const workingText = await this.files.read(workingPath(id));
        let working: DocumentV4 | null = null;
        if (workingText) {
            try {
                working = parseDocument(JSON.parse(workingText));
            } catch (e) {
                console.error(`documents: working copy of ${id} unreadable, the committed copy is used`, e);
            }
        }
        return { committed, working };
    }

    // Writes the working copy (null: removes it, the document is clean).
    writeWorking(id: string, document: DocumentV4 | null): Promise<void> {
        return this.serialized(async () => {
            const entry = this.fIndex.documents.find((d) => d.id == id);
            if (!entry) return;
            if (document) {
                await this.files.write(workingPath(id), JSON.stringify({ ...document, name: entry.name }));
            } else {
                await this.files.remove(workingPath(id));
            }
            entry.modified = Date.now();
            await this.writeIndex();
        });
    }

    // The committed copy becomes `document`; the working copy is removed.
    commit(id: string, document: DocumentV4): Promise<void> {
        return this.serialized(async () => {
            const entry = this.fIndex.documents.find((d) => d.id == id);
            if (!entry) return;
            await this.files.write(committedPath(id), JSON.stringify({ ...document, name: entry.name }));
            await this.files.remove(workingPath(id));
            entry.modified = Date.now();
            await this.writeIndex();
        });
    }

    rename(id: string, name: string): Promise<string> {
        return this.serialized(async () => {
            const entry = this.fIndex.documents.find((d) => d.id == id);
            if (!entry) return name;
            entry.name = this.uniqueName(name, id);
            for (const path of [committedPath(id), workingPath(id)]) {
                const text = await this.files.read(path);
                if (text) await this.files.write(path, JSON.stringify({ ...JSON.parse(text), name: entry.name }));
            }
            await this.writeIndex();
            return entry.name;
        });
    }

    // A copy of the document as it stands (working copy if any), clean, named "Name 2".
    async duplicate(id: string): Promise<DocumentEntry> {
        const { committed, working } = await this.read(id);
        const entry = this.get(id)!;
        return this.create(entry.name, working ?? committed);
    }

    setTrashed(id: string, trashed: boolean): Promise<void> {
        return this.serialized(async () => {
            const entry = this.fIndex.documents.find((d) => d.id == id);
            if (!entry) return;
            if (trashed) entry.trashed = Date.now(); else delete entry.trashed;
            if (trashed && this.fIndex.last == id) delete this.fIndex.last;
            await this.writeIndex();
        });
    }

    // Removes the documents of the trash for good.
    emptyTrash(): Promise<void> {
        return this.serialized(async () => {
            for (const entry of this.fIndex.documents.filter((d) => d.trashed !== undefined)) {
                await this.files.remove(`documents/${entry.id}`);
            }
            this.fIndex.documents = this.fIndex.documents.filter((d) => d.trashed === undefined);
            await this.writeIndex();
            for (const m of [...this.fModules.values()].filter((m) => m.trashed !== undefined)) {
                await this.files.remove(`modules/${m.id}.json`);
                this.fModules.delete(m.id);
            }
        });
    }

    // Removes one document of the trash for good.
    emptyTrashOf(id: string): Promise<void> {
        return this.serialized(async () => {
            const entry = this.fIndex.documents.find((d) => d.id == id && d.trashed !== undefined);
            if (!entry) return;
            await this.files.remove(`documents/${id}`);
            this.fIndex.documents = this.fIndex.documents.filter((d) => d !== entry);
            await this.writeIndex();
        });
    }

    setLast(id: string): Promise<void> {
        return this.serialized(async () => {
            this.fIndex.last = id;
            await this.writeIndex();
        });
    }

    /******************** CODES AND LIBRARIES ********************/

    async putCodes(codes: Map<string, string>): Promise<void> {
        for (const [hash, code] of codes) {
            if (this.fCodes.has(hash)) continue;
            await this.files.write(`codes/${hash}.dsp`, normalizeText(code));
            this.fCodes.add(hash);
        }
    }

    getCode(hash: string): Promise<string | null> {
        return this.files.read(`codes/${hash}.dsp`);
    }

    // The codes of the documents, as a map hash -> code (a code missing from the store is absent).
    async codesOf(...documents: Array<DocumentV4 | null>): Promise<Map<string, string>> {
        const codes = new Map<string, string>();
        for (const d of documents) {
            for (const i of d?.instances ?? []) {
                if (codes.has(i.code)) continue;
                const code = await this.getCode(i.code);
                if (code !== null) codes.set(i.code, code);
            }
        }
        return codes;
    }

    // An environment of libraries: stored once (the files first), identified by the hash of its manifest.
    async putEnvironment(files: Map<string, string>): Promise<string> {
        const manifest: Record<string, string> = {};
        const hashes = new Map<string, string>();
        for (const name of [...files.keys()].sort()) {
            const hash = await sha1(files.get(name)!);
            manifest[name] = hash;
            hashes.set(hash, files.get(name)!);
        }
        const text = JSON.stringify(manifest);
        const id = await sha1(text);
        if ((await this.files.read(`environments/${id}.json`)) === null) {
            const present = new Set((await this.files.list("libraries")).map((n) => n.replace(/\.lib$/, "")));
            for (const [hash, content] of hashes) {
                if (!present.has(hash)) await this.files.write(`libraries/${hash}.lib`, normalizeText(content));
            }
            await this.files.write(`environments/${id}.json`, text);
        }
        return id;
    }

    // Removes the codes no document (committed or working copy) and no user module references, trash
    // included.
    collect(): Promise<number> {
        return this.serialized(async () => {
            const live = new Set<string>();
            for (const m of this.fModules.values()) m.versions.forEach((v) => live.add(v));
            for (const entry of this.fIndex.documents) {
                for (const path of [committedPath(entry.id), workingPath(entry.id)]) {
                    const text = await this.files.read(path);
                    if (!text) continue;
                    try {
                        const d = parseDocument(JSON.parse(text));
                        if (d.legacy) return 0;     // codes still inside an unconverted file: keep everything
                        d.instances.forEach((i) => live.add(i.code));
                    } catch {
                        return 0;                   // a document that cannot be read: collect nothing
                    }
                }
            }
            let removed = 0;
            for (const name of await this.files.list("codes")) {
                const hash = name.replace(/\.dsp$/, "");
                if (!live.has(hash)) {
                    await this.files.remove(`codes/${name}`);
                    this.fCodes.delete(hash);
                    removed++;
                }
            }
            return removed;
        });
    }

    /******************** USER MODULES ********************/

    // The user modules, most recently modified first (trash excluded unless asked).
    listModules(trashed = false): UserModule[] {
        return [...this.fModules.values()].filter((m) => (m.trashed !== undefined) == trashed).sort((a, b) => b.modified - a.modified).map((m) => ({ ...m, versions: [...m.versions] }));
    }

    getModule(id: string): UserModule | undefined {
        const m = this.fModules.get(id);
        return m ? { ...m, versions: [...m.versions] } : undefined;
    }

    // The user module having this version (the most recently modified one, the trash included: a
    // module deleted still names its codes until the trash is emptied).
    moduleOf(hash: string): UserModule | undefined {
        const all = [...this.fModules.values()].filter((m) => m.versions.includes(hash));
        all.sort((a, b) => Number(a.trashed !== undefined) - Number(b.trashed !== undefined) || b.modified - a.modified);
        return all[0] ? this.getModule(all[0].id) : undefined;
    }

    private writeModule(m: UserModule): Promise<void> {
        return this.files.write(`modules/${m.id}.json`, JSON.stringify(m));
    }

    // A new user module whose first version is `hash` (the code must be stored before).
    createModule(name: string, hash: string, basedOn?: string): Promise<UserModule> {
        return this.serialized(async () => {
            const now = Date.now();
            const m: UserModule = { id: newId(), name: name.trim() || "Module", versions: [hash], created: now, modified: now };
            if (basedOn) m.basedOn = basedOn;
            await this.writeModule(m);
            this.fModules.set(m.id, m);
            return { ...m, versions: [...m.versions] };
        });
    }

    addVersion(id: string, hash: string): Promise<void> {
        return this.serialized(async () => {
            const m = this.fModules.get(id);
            if (!m || m.versions[m.versions.length - 1] == hash) return;
            m.versions = [...m.versions.filter((v) => v != hash), hash];
            m.modified = Date.now();
            delete m.basedOn;           // edited by the user: no longer an old version of a library module
            await this.writeModule(m);
        });
    }

    renameModule(id: string, name: string): Promise<void> {
        return this.serialized(async () => {
            const m = this.fModules.get(id);
            if (!m || !name.trim()) return;
            m.name = name.trim();
            m.modified = Date.now();
            await this.writeModule(m);
        });
    }

    setModuleTrashed(id: string, trashed: boolean): Promise<void> {
        return this.serialized(async () => {
            const m = this.fModules.get(id);
            if (!m) return;
            if (trashed) m.trashed = Date.now(); else delete m.trashed;
            await this.writeModule(m);
        });
    }

    /******************** MIGRATION ********************/

    get migration(): MigrationState | undefined {
        return this.fIndex.migration ? { ...this.fIndex.migration } : undefined;
    }

    setMigration(state: MigrationState): Promise<void> {
        return this.serialized(async () => {
            this.fIndex.migration = { ...state };
            await this.writeIndex();
        });
    }
}
