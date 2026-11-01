/*				DOCUMENTSPANEL.TS
    The Documents menu (Documentation/DOCUMENT-SPEC.md, "Les surfaces"): the open document (name,
    New, Save, Save as, Revert, Duplicate, Delete), the list of the documents, and the trash.
*/

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

        const trash = document.createElement("div");
        trash.className = "documentsTrash";
        const trashTitle = document.createElement("span");
        trashTitle.className = "exportTitle";
        trashTitle.textContent = t.documentTrash;
        this.fTrash = document.createElement("ul");
        this.fTrash.className = "documentsList";
        trash.append(trashTitle, this.fTrash);

        this.element.append(current, all, trash);
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
