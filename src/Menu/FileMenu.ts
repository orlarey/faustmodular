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
        const text = await file.text();
        const documents = this.fDocuments();
        if (!documents) {
            await Utilitary.currentScene.recallScene(text);
            return;
        }
        Utilitary.showFullPageLoading();
        try {
            if (!(await documents.importPatch(text))) return;
            const current = documents.current;
            if (!current) return;
            // the scene named as its file, as in a desktop application
            const name = sceneNameOf(file.name);
            if (current.name != name) await documents.rename(name);
            if (handle) await this.handles.set(current.id, handle);
            if (documents.dirty) await documents.save();
        } finally {
            Utilitary.hideFullPageLoading();
        }
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
