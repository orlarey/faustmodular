/*				FILEMENU.TS
    The File menu, as in a desktop application: New scene, Open a scene…, Save, Save as…, Import a Faust
    module (.dsp)…, Recent scenes ▸, Examples ▸.

    - Open and Save read and write a file of the disk (.jfaust). With the File System Access API (Chromium),
      the file opened or saved is remembered for the document (FileHandles): Save writes it again; Save as…
      chooses another one, and the scene takes the name of the file. Without it (Firefox, Safari), Open reads
      a file chosen and Save downloads the scene.
    - Opening a scene replaces the one shown: the scenes are kept by the documents (autosaved), the one left
      is in Recent scenes. A scene saved to its file is not modified any more (the dot of its name goes away).
    - The documents (documents/Documents.ts) stay underneath: the scene shown is autosaved and opened again
      at the next visit; their list, their trash, Revert... are not shown (DocumentsPanel, kept for later).
*/

import { saveAs } from "file-saver";
import { Message } from "../Messages";
import { Utilitary } from "../Utilitary";
import type { Documents } from "../documents/Documents";
import { FILE_TYPES, FileHandles, hasFileAccess, SceneFileHandle } from "../documents/FileHandles";
import { MenuItem, shortcut, showMenuBelow } from "../view/ContextMenu";
import type { Stores } from "../store/Stores";
import { scenePath as scenePathOf } from "../store/StoreFormat";
import { sceneNameIn } from "../store/StoreIndex";
import { parseStoreRef } from "../store/StoreFormat";
import type { Publishing } from "../store/Publishing";
import { shareLink } from "../store/Publishing";
import { StoreDialog, publishErrorText } from "./StoreDialog";
import { Confirm } from "../Messages";

// the examples of public/json
const EXAMPLES: Array<{ key: "exampleSmall" | "exampleBig" | "exampleMultichannel" | "exampleModulation"; file: string }> = [
    { key: "exampleSmall", file: "Small_Exemple" },
    { key: "exampleBig", file: "Big_Exemple" },
    { key: "exampleMultichannel", file: "Multichannel_Example" },
    { key: "exampleModulation", file: "Modulation_Example" },
];

export const RECENT_SCENES = 8;

// The name of a scene from the name of its file.
export function sceneNameOf(fileName: string): string {
    return fileName.replace(/\.(jfaust|json)$/i, "").trim() || "Untitled";
}

export class FileMenu {
    readonly handles = new FileHandles();
    stores: Stores | null = null;
    publishing: Publishing | null = null;
    private fDialog: StoreDialog | null = null;

    // Writing to a store: its token (the dialog); `then`, once checked.
    storeDialog(store: string, then?: () => void): void {
        if (!this.publishing) return;
        this.fDialog ??= new StoreDialog(this.publishing);
        this.fDialog.open(store, then);
    }

    // The entry to publish to the stores in read and write: none (how to get one), one (at once), several (a submenu).
    publishItem(label: string, publish: (store: string) => void, enabled = true): MenuItem {
        const t = Utilitary.messageResource;
        const writable = this.publishing?.writable() ?? [];
        if (writable.length == 0) return { label, enabled: false, title: t.storeNoWritable };
        if (writable.length == 1) return { label, enabled, title: writable[0], action: () => publish(writable[0]) };
        return {
            label: label.replace(/…$/, "") , enabled,
            items: writable.map((key) => ({ label: this.stores?.get(key)?.store?.manifest.name || key, title: key, action: () => publish(key) })),
        };
    }

    // Publishes to a store: `publish` gives what was published; the link to share it, at its commit, copied.
    async publishWith(store: string, publish: (p: Publishing) => Promise<{ store: string; path: string; commit: string }>): Promise<void> {
        const p = this.publishing;
        if (!p) return;
        const t = Utilitary.messageResource;
        Utilitary.showFullPageLoading();
        try {
            const done = await publish(p);
            const link = shareLink(location.origin + location.pathname, parseStoreRef(done.store)!, done.commit, done.path);
            let copied = false;
            try { await navigator.clipboard.writeText(link); copied = true; } catch { /* not allowed */ }
            new Message((copied ? t.storePublished : t.storePublishedLink).replace("%s", done.store).replace("%p", done.path).replace("%l", link), undefined, 8000);
        } catch (e) {
            new Message(publishErrorText(e, store), undefined, 8000);
        } finally {
            Utilitary.hideFullPageLoading();
        }
    }

    // The scene shown, to a store (asked first if it is there already: replaced, the version before in the history).
    publishScene(store: string): void {
        const t = Utilitary.messageResource;
        const current = this.fDocuments()?.current;
        if (!current || !this.publishing) return;
        const go = () => this.publishWith(store, (p) => p.publishScene(store, current.name, this.content()));
        this.publishing.exists(store, scenePathOf(current.name)).then((there) => {
            if (there) new Confirm(t.confirmScenePublishReplace.replace("%s", current.name).replace("%t", store), (close) => { close(); go(); });
            else go();
        }).catch(() => go());
    }

    constructor(private fDocuments: () => Documents | null) { }

    show(anchor: HTMLElement): void {
        const t = Utilitary.messageResource;
        const documents = this.fDocuments();
        const current = documents?.current;
        const recent = (documents?.store.list() ?? []).filter((d) => d.id != current?.id).slice(0, RECENT_SCENES);
        const items: MenuItem[] = [
            { label: t.fileNew, enabled: !!documents, action: () => { documents?.create() } },
            { label: t.fileOpen, shortcut: shortcut("mod+O"), action: () => { this.open() } },
            { label: t.fileSave, shortcut: shortcut("mod+S"), enabled: !!current, action: () => { this.save() } },
            { label: t.fileSaveAs, shortcut: shortcut("shift+mod+S"), enabled: !!current, action: () => { this.saveAs() } },
            "separator",
            { label: t.menuImportDsp, action: () => Utilitary.currentScene.importDsp(Utilitary.currentScene.positionDblTapModule()) },
            "separator",
            {
                label: t.fileRecent, enabled: recent.length > 0,
                items: recent.map((entry) => ({ label: entry.name, title: new Date(entry.modified).toLocaleString(), action: () => { documents?.open(entry.id) } })),
            },
            { label: t.documentExamples, items: EXAMPLES.map((example) => ({ label: t[example.key], action: () => this.openExample(example.file) })) },
            this.storeItem(),
            "separator",
            this.publishItem(t.publishScene, (store) => this.publishScene(store), !!current),
        ];
        showMenuBelow(anchor, items);
    }

    // A scene of the disk, in place of the one shown (a Faust file .dsp: a module of the scene).
    async open(): Promise<void> {
        if (hasFileAccess()) {
            let handles: SceneFileHandle[];
            try {
                handles = await (window as any).showOpenFilePicker({ types: [...FILE_TYPES, { description: "Faust", accept: { "text/plain": [".dsp"] } }], multiple: false });
            } catch {
                return;     // cancelled
            }
            await this.openFile(await handles[0].getFile(), handles[0]);
            return;
        }
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".jfaust,.json,.dsp";
        input.addEventListener("change", () => {
            const file = input.files?.item(0);
            if (file) this.openFile(file, null);
        });
        input.click();
    }

    async openFile(file: File, handle: SceneFileHandle | null): Promise<void> {
        if (/\.dsp$/i.test(file.name)) {
            document.dispatchEvent(new CustomEvent("fileload", { detail: file }));
            return;
        }
        await this.openText(await file.text(), sceneNameOf(file.name), handle);
    }

    // A scene from its text, as a new document named `name`.
    async openText(text: string, name: string, handle: SceneFileHandle | null = null): Promise<boolean> {
        const documents = this.fDocuments();
        if (!documents) {
            await Utilitary.currentScene.recallScene(text);
            return true;
        }
        Utilitary.showFullPageLoading();
        try {
            if (!(await documents.importPatch(text))) return false;
            const current = documents.current;
            if (!current) return false;
            // the scene named as its file, as in a desktop application
            if (current.name != name) await documents.rename(name);
            if (handle) await this.handles.set(current.id, handle);
            if (documents.dirty) await documents.save();
            return true;
        } finally {
            Utilitary.hideFullPageLoading();
        }
    }

    // Open from a store ▸ a submenu per store followed, its scenes (Documentation/STORE-SPEC.md).
    private storeItem(): MenuItem {
        const t = Utilitary.messageResource;
        const ready = (this.stores?.list() ?? []).filter((s) => s.status == "ready");
        if (ready.length == 0) return { label: t.fileOpenFromStore, enabled: false, title: t.fileNoStore };
        return {
            label: t.fileOpenFromStore,
            items: ready.map((state) => {
                const scenes = state.store!.index.scenes;
                return {
                    label: state.store!.manifest.name || state.key, title: state.key, enabled: scenes.length > 0,
                    items: scenes.length == 0 ? [{ label: t.storeNoScene, enabled: false }] : scenes.map((scene) => ({
                        label: scene.name, title: scene.summary ?? scene.path, action: () => { this.openFromStore(state.key, scene.path) },
                    })),
                };
            }),
        };
    }

    // A scene of a store (`store`: owner/repo, or owner/repo@ref), as a new document.
    async openFromStore(store: string, path: string): Promise<boolean> {
        const t = Utilitary.messageResource;
        const ref = parseStoreRef(store);
        if (!ref || !this.stores) return false;
        let text: string;
        try {
            Utilitary.showFullPageLoading();
            text = await this.stores.reader.text(ref, path);
        } catch {
            Utilitary.hideFullPageLoading();
            new Message(t.storeUnreadable.replace("%s", store + " : " + path));
            return false;
        }
        // named as in its file (its name, not the name of its file in the store)
        return this.openText(text, sceneNameIn(text) ?? sceneNameOf(path.split("/").pop()!));
    }

    // The scene written to its file (or downloaded), then not modified any more.
    async save(): Promise<void> {
        const documents = this.fDocuments();
        const current = documents?.current;
        if (!documents || !current) return;
        const handle = await this.handles.get(current.id);
        if (handle && await FileHandles.write(handle, this.content())) {
            await documents.save();
            return;
        }
        await this.saveAs();
    }

    // The scene written to a file chosen (or downloaded): it takes the name of the file.
    async saveAs(): Promise<void> {
        const documents = this.fDocuments();
        const current = documents?.current;
        if (!documents || !current) return;
        if (!hasFileAccess()) {
            saveAs(new Blob([this.content()], { type: "application/json;charset=utf-8;" }), current.name + ".jfaust");
            await documents.save();
            return;
        }
        let handle: SceneFileHandle;
        try {
            handle = await (window as any).showSaveFilePicker({ suggestedName: current.name + ".jfaust", types: FILE_TYPES });
        } catch {
            return;     // cancelled
        }
        const name = sceneNameOf(handle.name);
        if (name != current.name) await documents.rename(name);
        if (!(await FileHandles.write(handle, this.content()))) {
            new Message(Utilitary.messageResource.fileSaveFailed.replace("{file}", handle.name));
            return;
        }
        await this.handles.set(current.id, handle);
        await documents.save();
    }

    // The scene as a patch file, as the documents keep it (the model is not changed).
    private content(): string {
        return JSON.stringify(Utilitary.currentScene.describePatch(), null, 1);
    }

    private openExample(file: string): void {
        Utilitary.showFullPageLoading();
        Utilitary.getXHR("json/" + file + ".json", (json: string) => { Utilitary.currentScene.recallScene(json) }, null as any);
    }
}
