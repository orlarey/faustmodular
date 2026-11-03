/*				DOCUMENTSPANEL.TS
    The File menu (Documentation/DOCUMENT-SPEC.md, "Les surfaces"): the open document (name, New, Save,
    Save as, Revert, Rename), the list of the documents, the files (open a patch or a Faust file, download
    the scene, the examples), and the trash.
*/

import { saveAs } from "file-saver";
import { Confirm } from "../Messages";
import { Utilitary } from "../Utilitary";
import type { Documents } from "../documents/Documents";
import type { DocumentEntry } from "../documents/DocumentStore";

function button(label: string, className: string, action: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "button " + className;
    b.textContent = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); action(); });
    return b;
}

// the examples of public/json, opened as new documents
const EXAMPLES: Array<{ key: "exampleSmall" | "exampleBig" | "exampleMultichannel" | "exampleModulation"; file: string }> = [
    { key: "exampleSmall", file: "Small_Exemple" },
    { key: "exampleBig", file: "Big_Exemple" },
    { key: "exampleMultichannel", file: "Multichannel_Example" },
    { key: "exampleModulation", file: "Modulation_Example" },
];

function date(time: number): string {
    return new Date(time).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export class DocumentsPanel {
    readonly element: HTMLElement;
    private fDocuments: Documents | null = null;
    private fName: HTMLInputElement;
    private fActions: HTMLElement;
    private fList: HTMLElement;
    private fTrash: HTMLElement;
    private fNotice: HTMLElement;
    private fFileInput: HTMLInputElement;
    private fPrecompiled: HTMLInputElement;

    constructor() {
        const t = Utilitary.messageResource;
        this.element = document.createElement("div");
        this.element.id = "documentsContainer";
        this.element.className = "menuContent";

        const current = document.createElement("div");
        current.className = "documentsCurrent";
        const title = document.createElement("span");
        title.className = "exportTitle";
        title.textContent = t.documentCurrent;
        this.fName = document.createElement("input");
        this.fName.type = "text";
        this.fName.id = "documentName";
        this.fName.spellcheck = false;
        this.fName.addEventListener("keydown", (e) => {
            if (e.key == "Enter") this.renameCurrent();
            e.stopPropagation();
        });
        this.fActions = document.createElement("div");
        this.fActions.className = "documentsActions";
        this.fActions.append(
            button(t.documentNew, "documentNew", () => this.fDocuments?.create()),
            button(t.documentSave, "documentSave", () => this.fDocuments?.save()),
            button(t.documentSaveAs, "documentSaveAs", () => this.fDocuments?.saveAs(this.fName.value)),
            button(t.documentRevert, "documentRevert", () => this.fDocuments?.revert()),
            button(t.documentRename, "documentRename", () => this.renameCurrent()),
        );
        this.fNotice = document.createElement("p");
        this.fNotice.className = "documentsNotice";
        current.append(title, this.fName, this.fActions, this.fNotice);

        const all = document.createElement("div");
        all.className = "documentsAll";
        const listTitle = document.createElement("span");
        listTitle.className = "exportTitle";
        listTitle.textContent = t.documentList;
        this.fList = document.createElement("ul");
        this.fList.className = "documentsList";
        all.append(listTitle, this.fList);

        // the files: a patch opens as a new document, a Faust file becomes a module (App.loadFile, "fileload")
        const files = document.createElement("div");
        files.className = "documentsFiles";
        const filesTitle = document.createElement("span");
        filesTitle.className = "exportTitle";
        filesTitle.textContent = t.documentFiles;
        this.fFileInput = document.createElement("input");
        this.fFileInput.type = "file";
        this.fFileInput.id = "documentFileInput";
        this.fFileInput.accept = ".json,.jfaust,.dsp";
        this.fFileInput.style.display = "none";
        this.fFileInput.addEventListener("change", () => {
            const file = this.fFileInput.files?.item(0);
            this.fFileInput.value = "";
            if (file) document.dispatchEvent(new CustomEvent("fileload", { detail: file }));
        });
        const hint = document.createElement("p");
        hint.className = "documentsNotice documentsHint";
        hint.textContent = t.documentOpenFileHint;
        const precompiled = document.createElement("label");
        precompiled.className = "documentsPrecompiled";
        this.fPrecompiled = document.createElement("input");
        this.fPrecompiled.type = "checkbox";
        this.fPrecompiled.id = "documentPrecompiled";
        precompiled.append(this.fPrecompiled, document.createTextNode(" " + t.precompileOption));
        const fileActions = document.createElement("div");
        fileActions.className = "documentsActions";
        fileActions.append(
            button(t.documentOpenFile, "documentOpenFile", () => this.fFileInput.click()),
            button(t.documentDownload, "documentDownload", () => this.download()),
        );
        const examplesTitle = document.createElement("span");
        examplesTitle.className = "exportTitle documentsExamplesTitle";
        examplesTitle.textContent = t.documentExamples;
        const examples = document.createElement("ul");
        examples.className = "documentsList documentsExamples";
        for (const example of EXAMPLES) {
            const li = document.createElement("li");
            li.className = "documentExample";
            li.dataset.example = example.file;
            li.textContent = t[example.key];
            li.addEventListener("click", () => this.openExample(example.file));
            examples.append(li);
        }
        files.append(filesTitle, fileActions, precompiled, hint, this.fFileInput, examplesTitle, examples);

        const trash = document.createElement("div");
        trash.className = "documentsTrash";
        const trashTitle = document.createElement("span");
        trashTitle.className = "exportTitle";
        trashTitle.textContent = t.documentTrash;
        this.fTrash = document.createElement("ul");
        this.fTrash.className = "documentsList";
        trash.append(trashTitle, this.fTrash);

        this.element.append(current, all, files, trash);
        document.addEventListener("documentchange", () => this.render());
        document.addEventListener("librarychange", () => this.render());
    }

    setDocuments(documents: Documents): void {
        this.fDocuments = documents;
        this.render();
    }

    private renameCurrent(): void {
        const name = this.fName.value.trim();
        if (name && this.fDocuments) this.fDocuments.rename(name);
    }

    // the scene as a patch file (.jfaust), precompiled or not
    private download(): void {
        const scene = Utilitary.currentScene;
        const blob = new Blob([scene.saveScene(this.fPrecompiled.checked)], { type: "application/json;charset=utf-8;" });
        saveAs(blob, scene.sceneName + ".jfaust");
        scene.markSaved();
    }

    // an example opened as a new document (Scene.recallScene: Documents.importPatch)
    private openExample(file: string): void {
        Utilitary.showFullPageLoading();
        Utilitary.getXHR("json/" + file + ".json", (json: string) => { Utilitary.currentScene.recallScene(json) }, null as any);
    }

    render(): void {
        const documents = this.fDocuments;
        const t = Utilitary.messageResource;
        if (!documents) return;
        const current = documents.current;
        if (document.activeElement != this.fName) this.fName.value = current?.name ?? "";
        this.fActions.querySelector<HTMLButtonElement>(".documentSave")!.disabled = !documents.dirty;
        this.fActions.querySelector<HTMLButtonElement>(".documentRevert")!.disabled = !documents.dirty;
        this.fNotice.textContent = documents.storage == "opfs" ? "" : documents.storage == "localStorage" ? t.documentStorageLocal : t.documentStorageMemory;

        this.fList.replaceChildren(...documents.store.list().map((entry) => this.row(entry, entry.id == current?.id, [
            button(t.documentDuplicate, "documentDuplicate", () => documents.duplicate(entry.id)),
            button(t.documentDelete, "documentDelete", () => new Confirm(t.confirmDocumentDelete.replace("%s", entry.name), (close) => { close(); documents.trash(entry.id); })),
        ], () => { if (entry.id != current?.id) documents.open(entry.id); })));

        const trashed = documents.store.list(true);
        const modules = documents.store.listModules(true);
        this.fTrash.replaceChildren(...trashed.map((entry) => this.row(entry, false, [
            button(t.documentRestore, "documentRestore", () => documents.restore(entry.id)),
        ])), ...modules.map((m) => {
            const row = this.row({ id: m.id, name: m.name, created: m.created, modified: m.modified, trashed: m.trashed }, false, [
                button(t.documentRestore, "documentRestore moduleRestore", () => documents.trashModule(m.id, false)),
            ]);
            row.classList.add("moduleRow");
            row.querySelector(".documentRowName")!.textContent = `${m.name} (${t.titleUserModules})`;
            return row;
        }));
        if (trashed.length + modules.length > 0) {
            const empty = document.createElement("li");
            empty.append(button(t.documentEmptyTrash, "documentEmptyTrash", () => new Confirm(t.confirmEmptyTrash, (close) => { close(); documents.emptyTrash(); })));
            this.fTrash.append(empty);
        }
    }

    private row(entry: DocumentEntry, isCurrent: boolean, actions: HTMLElement[], open?: () => void): HTMLElement {
        const li = document.createElement("li");
        li.className = "documentRow" + (isCurrent ? " current" : "");
        li.dataset.id = entry.id;
        const name = document.createElement("span");
        name.className = "documentRowName";
        name.textContent = entry.name + (isCurrent && this.fDocuments?.dirty ? " ●" : "");
        const when = document.createElement("span");
        when.className = "documentRowDate";
        when.textContent = date(entry.trashed ?? entry.modified);
        li.append(name, when, ...actions);
        if (open) {
            li.classList.add("openable");
            li.addEventListener("click", open);
        }
        return li;
    }
}
