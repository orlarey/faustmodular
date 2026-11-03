/*				FILEHANDLES.TS
    The file of the disk a document was opened from or saved to (File System Access API, Chromium): its
    handle, kept in IndexedDB by the id of the document, so that Save writes it again, as a desktop
    application, after a reload too (the browser asks again for the permission to write it).
    Browsers without the API (Firefox, Safari) have no handle: Save downloads the scene.
*/

const DB = "faustmodular-files";
const STORE = "handles";

export interface SceneFileHandle {
    readonly name: string;
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
    queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
    requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}

export const FILE_TYPES = [{ description: "faustmodular", accept: { "application/json": [".jfaust", ".json"] } }];

// The API: showOpenFilePicker and showSaveFilePicker (not in a frame of another origin).
export function hasFileAccess(): boolean {
    return typeof window != "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window;
}

function database(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        try {
            const request = indexedDB.open(DB, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await database();
    if (!db) return undefined;
    return new Promise((resolve) => {
        try {
            const request = run(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
}

export class FileHandles {
    private fMemory = new Map<string, SceneFileHandle>();

    async get(document: string): Promise<SceneFileHandle | null> {
        if (this.fMemory.has(document)) return this.fMemory.get(document)!;
        const handle = await transaction("readonly", (s) => s.get(document)) as SceneFileHandle | undefined;
        if (handle) this.fMemory.set(document, handle);
        return handle ?? null;
    }

    async set(document: string, handle: SceneFileHandle): Promise<void> {
        this.fMemory.set(document, handle);
        await transaction("readwrite", (s) => s.put(handle, document));
    }

    // Writes the file, after asking for the permission if needed; false if it cannot be written.
    static async write(handle: SceneFileHandle, content: string): Promise<boolean> {
        try {
            if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) != "granted") {
                if (!handle.requestPermission || (await handle.requestPermission({ mode: "readwrite" })) != "granted") return false;
            }
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            return true;
        } catch (e) {
            console.warn("file not written", e);
            return false;
        }
    }
}
