/*				FILESTORE.TS
    The files of the documents (Documentation/DOCUMENT-SPEC.md, "Le stockage"): text files under
    paths such as "documents/<uuid>/committed.json" or "codes/<sha1>.dsp".

    - OpfsStore: the Origin Private File System, under the directory "faustmodular/";
    - LocalStorageStore: a fallback for browsers without writable OPFS files on the main thread;
    - MemoryStore: tests, and the last resort (nothing persists).
*/

export interface FileStore {
    readonly kind: "opfs" | "localStorage" | "memory";
    read(path: string): Promise<string | null>;
    write(path: string, text: string): Promise<void>;
    remove(path: string): Promise<void>;
    // Names of the entries (files and directories) of a directory; [] if it does not exist.
    list(directory: string): Promise<string[]>;
}

function split(path: string): string[] {
    return path.split("/").filter((part) => part.length > 0);
}

export class MemoryStore implements FileStore {
    readonly kind: FileStore["kind"] = "memory";
    protected files = new Map<string, string>();

    async read(path: string): Promise<string | null> {
        return this.files.get(split(path).join("/")) ?? null;
    }
    async write(path: string, text: string): Promise<void> {
        this.files.set(split(path).join("/"), text);
    }
    async remove(path: string): Promise<void> {
        const key = split(path).join("/");
        this.files.delete(key);
        for (const p of [...this.files.keys()]) if (p.startsWith(key + "/")) this.files.delete(p);
    }
    async list(directory: string): Promise<string[]> {
        const prefix = split(directory).join("/") + "/";
        const names = new Set<string>();
        for (const path of this.files.keys()) {
            if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split("/")[0]);
        }
        return [...names].sort();
    }
}

// One localStorage key per file, under a prefix.
export class LocalStorageStore implements FileStore {
    readonly kind = "localStorage" as const;
    constructor(private fPrefix = "faustmodular:") { }

    async read(path: string): Promise<string | null> {
        return localStorage.getItem(this.fPrefix + split(path).join("/"));
    }
    async write(path: string, text: string): Promise<void> {
        localStorage.setItem(this.fPrefix + split(path).join("/"), text);
    }
    async remove(path: string): Promise<void> {
        const key = this.fPrefix + split(path).join("/");
        localStorage.removeItem(key);
        for (let i = localStorage.length - 1; i >= 0; i--) {
            if (localStorage.key(i)!.startsWith(key + "/")) localStorage.removeItem(localStorage.key(i)!);
        }
    }
    async list(directory: string): Promise<string[]> {
        const prefix = this.fPrefix + split(directory).join("/") + "/";
        const names = new Set<string>();
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)!;
            if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
        }
        return [...names].sort();
    }
}

export class OpfsStore implements FileStore {
    readonly kind = "opfs" as const;
    constructor(private fRoot: FileSystemDirectoryHandle) { }

    static async open(name = "faustmodular"): Promise<OpfsStore> {
        const root = await navigator.storage.getDirectory();
        return new OpfsStore(await root.getDirectoryHandle(name, { create: true }));
    }

    private async directory(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
        let dir = this.fRoot;
        for (const part of parts) {
            try {
                dir = await dir.getDirectoryHandle(part, { create });
            } catch (e) {
                if (!create && (e as DOMException).name == "NotFoundError") return null;
                throw e;
            }
        }
        return dir;
    }

    async read(path: string): Promise<string | null> {
        const parts = split(path);
        const dir = await this.directory(parts.slice(0, -1), false);
        if (!dir) return null;
        try {
            const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
            return await file.text();
        } catch (e) {
            if ((e as DOMException).name == "NotFoundError") return null;
            throw e;
        }
    }

    async write(path: string, text: string): Promise<void> {
        const parts = split(path);
        const dir = (await this.directory(parts.slice(0, -1), true))!;
        const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async remove(path: string): Promise<void> {
        const parts = split(path);
        const dir = await this.directory(parts.slice(0, -1), false);
        if (!dir) return;
        try {
            await dir.removeEntry(parts[parts.length - 1], { recursive: true });
        } catch (e) {
            if ((e as DOMException).name != "NotFoundError") throw e;
        }
    }

    async list(directory: string): Promise<string[]> {
        const dir = await this.directory(split(directory), false);
        if (!dir) return [];
        const names: string[] = [];
        for await (const [name] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
            names.push(name);
        }
        return names.sort();
    }
}

// The best store available: OPFS if its files can be written from the page, then localStorage.
export async function openFileStore(): Promise<FileStore> {
    try {
        if (typeof FileSystemFileHandle != "undefined" && "createWritable" in FileSystemFileHandle.prototype && typeof navigator.storage?.getDirectory == "function") {
            return await OpfsStore.open();
        }
    } catch (e) {
        console.warn("documents: OPFS unavailable", e);
    }
    try {
        localStorage.setItem("faustmodular:probe", "1");
        localStorage.removeItem("faustmodular:probe");
        return new LocalStorageStore();
    } catch (e) {
        console.warn("documents: localStorage unavailable", e);
    }
    return new MemoryStore();
}
