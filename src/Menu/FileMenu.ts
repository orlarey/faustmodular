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
import { libraryShas, planFiles, planSceneModules, PlanRow } from "../store/ScenePlan";
import { showPublishDialog } from "./PublishDialog";
import { storedCode } from "../documents/DocumentFormat";
import { sha1 } from "../documents/Sha1";
import { parseStoreRef } from "../store/StoreFormat";
import type { Publishing } from "../store/Publishing";
import { shareLink } from "../store/Publishing";
import { StoreDialog, publishErrorText } from "./StoreDialog";
import { Confirm } from "../Messages";
import { encodeFlacAsync } from "../audio/Flac";
import { recallScene } from "../store/Recall";
import { faustWasmEnv } from "../Main";

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
            const material = (done as { material?: string }).material;
            // a recording: the link recalls its scene (?recording=)
            const link = shareLink(location.origin + location.pathname, parseStoreRef(done.store)!, done.commit, material ?? done.path, material ? "recording" : "scene");
            let copied = false;
            try { await navigator.clipboard.writeText(link); copied = true; } catch { /* not allowed */ }
            const modules = (done as { modules?: string[] }).modules ?? [];
            const also = modules.length ? " " + t.storePublishedModules.replace("%n", String(modules.length)).replace("%m", modules.map((m) => m.split("/")[1]).join(", ")) : "";
            const text = material ? (copied ? t.recordingPublished : t.recordingPublishedLink).replace("%m", material.split("/")[1])
                : (copied ? t.storePublished : t.storePublishedLink);
            new Message(text.replace("%s", done.store).replace("%p", done.path + also).replace("%l", link), undefined, 8000);
        } catch (e) {
            new Message(publishErrorText(e, store), undefined, 8000);
        } finally {
            Utilitary.hideFullPageLoading();
        }
    }

    // The scene shown, to a store, with its modules (store/ScenePlan.ts): the store read again first (fresh), the
    // modules of the library of faustmodular known; a dialog if there is something to decide or to know.
    async publishScene(store: string): Promise<void> {
        const current = this.fDocuments()?.current;
        if (!current || !this.publishing || !this.stores) return;
        const name = current.name, content = this.content();
        Utilitary.showFullPageLoading();
        let rows: PlanRow[] = [], replaced = false;
        try {
            const state = await this.stores.refresh(store);
            const index = state?.store?.index ?? null;
            let library = new Map<string, string>();
            try { library = libraryShas(await (await fetch("faust-modules/library-index.json")).json()); } catch { /* unknown: all published */ }
            const modules = await Promise.all(Utilitary.currentScene.getModules().map(async (m) => {
                const moduleName = m.moduleFaust.getName();
                const code = storedCode(moduleName, m.moduleFaust.getSource()).code;
                return { name: moduleName, code, sha: await sha1(code) };
            }));
            rows = planSceneModules(modules, index, library);
            replaced = !!index?.scenes.some((s) => s.path == scenePathOf(name));
        } finally {
            Utilitary.hideFullPageLoading();
        }
        const go = (chosen: PlanRow[]) => this.publishWith(store, (p) => p.publishScene(store, name, content, planFiles(chosen)));
        if (replaced || rows.some((r) => r.status == "new" || r.status == "conflict")) showPublishDialog(store, name, replaced, rows, go);
        else go(rows);
    }

    // The last recording (● of the transport) and the scene as it was recorded, with its modules, to a store: one commit,
    // the recording linked to its scene (recordingOf). The modules as for a scene (store/ScenePlan.ts).
    async publishRecording(store: string): Promise<void> {
        const rec = Utilitary.currentScene.recorder?.last;
        const recipe = rec?.recipe;
        if (!rec || !recipe || !this.publishing || !this.stores) return;
        Utilitary.showFullPageLoading();
        let rows: PlanRow[] = [], replaced = false;
        try {
            const state = await this.stores.refresh(store);
            const index = state?.store?.index ?? null;
            let library = new Map<string, string>();
            try { library = libraryShas(await (await fetch("faust-modules/library-index.json")).json()); } catch { /* unknown: all published */ }
            const modules = await Promise.all(recipe.modules.map(async (m) => ({ ...m, sha: await sha1(m.code) })));
            rows = planSceneModules(modules, index, library);
            replaced = !!index?.scenes.some((s) => s.path == scenePathOf(recipe.name));
        } finally {
            Utilitary.hideFullPageLoading();
        }
        const { format, version, kind, name, ...description } = rec.material;
        void format; void version; void kind;
        const go = (chosen: PlanRow[]) => this.publishWith(store, async (p) => {
            const flac = rec.flac ?? await encodeFlacAsync(rec.samples, rec.sampleRate);
            return p.publishRecording(store, recipe.name, recipe.content, planFiles(chosen), { name, flac, description });
        });
        if (replaced || rows.some((r) => r.status == "new" || r.status == "conflict")) showPublishDialog(store, recipe.name, replaced, rows, go);
        else go(rows);
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
            this.publishItem(t.publishRecording, (store) => this.publishRecording(store), !!Utilitary.currentScene.recorder?.last?.recipe),
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
                const recordings = (state.store!.index.materials ?? []).filter((m) => m.kind == "recording");
                const sceneItems: MenuItem[] = scenes.length == 0 ? [{ label: t.storeNoScene, enabled: false }] : scenes.map((scene) => ({
                    label: scene.name, title: scene.summary ?? scene.path, action: () => { this.openFromStore(state.key, scene.path) },
                }));
                // the recordings (Documentation/MATERIALS-SPEC.md): their scene recalled, listened to, downloaded
                const recordingItems: MenuItem[] = recordings.length == 0 ? [] : ["separator", { label: t.storeRecordings, enabled: false }, ...recordings.map((m) => ({
                    label: m.name, title: [m.recordingOf, m.date].filter(Boolean).join(" · "),
                    items: [
                        { label: t.recordingOpenScene, enabled: !!(m.recordingOf ?? m.from?.path), action: () => { this.openRecording(state.key, m.path) } },
                        { label: t.recordingListen, enabled: !!m.media, action: () => { this.listen(state.key, m.media!.path) } },
                        { label: t.recordingDownload, enabled: !!m.media, action: () => { this.download(state.key, m.media!.path) } },
                    ],
                }))];
                return {
                    label: state.store!.manifest.name || state.key, title: state.key, enabled: scenes.length + recordings.length > 0,
                    items: [...sceneItems, ...recordingItems],
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

    // The scene of a recording (`path`: its description or its media), as it was when the recording started
    // (store/Recall.ts), as a new document; said if it is not that version, or if libfaust is another one.
    async openRecording(store: string, path: string): Promise<boolean> {
        const t = Utilitary.messageResource;
        const ref = parseStoreRef(store);
        if (!ref || !this.stores) return false;
        let recalled;
        try {
            Utilitary.showFullPageLoading();
            recalled = await recallScene(this.stores.reader, ref, path, this.publishing?.tokens.get(store) ?? undefined);
        } catch {
            Utilitary.hideFullPageLoading();
            new Message(t.storeUnreadable.replace("%s", store + " : " + path));
            return false;
        }
        const opened = await this.openText(recalled.content, sceneNameIn(recalled.content) ?? sceneNameOf(recalled.scene.split("/").pop()!));
        if (!opened) return false;
        let text = (recalled.exact ? t.recordingRecalled : t.recordingRecalledOther).replace("%r", recalled.material.name).replace("%s", recalled.scene);
        const then = recalled.material.faust?.libfaust;
        let now = "";
        try { now = faustWasmEnv.faustCompiler.version(); } catch { /* unknown */ }
        if (then && now && then != now) text += " " + t.recordingOtherLibfaust.replace("%a", then).replace("%b", now);
        new Message(text, undefined, 8000);
        return true;
    }

    // A media of a store, in a new tab (the browser plays it).
    private listen(store: string, path: string): void {
        const ref = parseStoreRef(store);
        if (!ref || !this.stores) return;
        const tab = window.open("", "_blank");
        this.stores.reader.bytes(ref, path, this.publishing?.tokens.get(store) ?? undefined)
            .then((bytes) => { const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType(path) })); if (tab) tab.location.href = url; else window.open(url, "_blank"); })
            .catch(() => { tab?.close(); new Message(Utilitary.messageResource.storeUnreadable.replace("%s", store + " : " + path)); });
    }

    private download(store: string, path: string): void {
        const ref = parseStoreRef(store);
        if (!ref || !this.stores) return;
        this.stores.reader.bytes(ref, path, this.publishing?.tokens.get(store) ?? undefined)
            .then((bytes) => saveAs(new Blob([bytes as BlobPart], { type: mediaType(path) }), path.split("/").pop()!))
            .catch(() => new Message(Utilitary.messageResource.storeUnreadable.replace("%s", store + " : " + path)));
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
    content(): string {
        return JSON.stringify(Utilitary.currentScene.describePatch(), null, 1);
    }

    private openExample(file: string): void {
        Utilitary.showFullPageLoading();
        Utilitary.getXHR("json/" + file + ".json", (json: string) => { Utilitary.currentScene.recallScene(json) }, null as any);
    }
}

function mediaType(path: string): string {
    return /\.flac$/i.test(path) ? "audio/flac" : /\.wav$/i.test(path) ? "audio/wav" : /\.opus$/i.test(path) ? "audio/ogg" : "application/octet-stream";
}
