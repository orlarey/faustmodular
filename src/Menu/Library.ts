/*				LIBRARY.JS
    Creates Graphical Library of Faust Modules
    Connects with faust.grame.fr to receive the json description of available modules

    Interface structure
    ===================
    DIV --> PARENT
        DIV --> libraryDiv
            DIV --> libraryTitle
            DIV --> imageNode
            DIV --> fFooter
            UL --> section 1
                LI --> subsection 1
                LI --> subsection 2
                etc
            UL --> section 2
                LI --> subsection 1
                LI --> subsection 2
                etc
    ===================

    DEPENDENCIES :
        - faust.grame.fr/www/pedagogie/index.json
*/

//--- Init graphical elements of library

import { Confirm } from "../Messages";
import { Utilitary } from "../Utilitary";
import { LibraryView } from "./LibraryView";
import type { Documents } from "../documents/Documents";

interface CatalogModule {
    path: string;
    name: string;
    functions: string[];
    family: string | null;
    summary: string;
    description: string;
    inlets: string[];
    outlets: string[];
}

interface Catalog {
    groups: Array<{ name: string; families: string[] }>;
    modules: CatalogModule[];
}

// The family of the user modules, after those of the catalog.
const USER_FAMILY = "My modules";

export class Library {
    libraryView: LibraryView;
    isLibraryTouch: boolean;
    previousTouchUrl: string;
    isSmaller: boolean = false;
    isDblTouch: boolean = false;
    documents: Documents | null = null;

    setDocuments(documents: Documents) {
        this.documents = documents;
        // the count of My modules, and their list when shown
        document.addEventListener("librarychange", () => this.renderFamilies());
        this.renderFamilies();
    }

    // "My modules": double click or drag adds the latest version; rename and delete in place.
    fillUserModules() {
        var list = this.libraryView.userLibrarySelect;
        var documents = this.documents;
        if (!documents || !list) return;
        var t = Utilitary.messageResource;
        var modules = documents.store.listModules();
        list.replaceChildren();
        if (modules.length == 0) {
            var empty = document.createElement("li");
            empty.className = "userModulesEmpty";
            empty.textContent = t.userModulesEmpty;
            list.appendChild(empty);
        }
        for (var m of modules) {
            var li = document.createElement("li");
            li.className = "userModule";
            li.dataset.id = m.id;
            var a = document.createElement("a");
            a.href = location.href.split("#")[0] + "#user-module:" + encodeURIComponent(m.id);
            a.draggable = true;
            a.title = t.hoverLibraryElement + (m.versions.length > 1 ? " \u2014 " + t.userModuleVersions.replace("{n}", String(m.versions.length)) : "");
            a.text = m.name;
            a.addEventListener("click", (e) => { e.preventDefault() });
            a.ondblclick = this.dispatchEventLibrary.bind(this, a.href);
            a.ontouchstart = (e) => { this.dbleTouchMenu(e) };
            var rename = document.createElement("span");
            rename.className = "userModuleRename";
            rename.textContent = "\u270E";
            rename.title = t.userModuleRename;
            rename.addEventListener("click", this.renameUserModule.bind(this, li, m.id, m.name));
            var remove = document.createElement("span");
            remove.className = "userModuleDelete";
            remove.textContent = "\u2715";
            remove.title = t.userModuleDelete;
            var id = m.id, name = m.name;
            remove.addEventListener("click", ((id: string, name: string) => () => {
                new Confirm(t.confirmUserModuleDelete.replace("%s", name), (close) => { close(); documents!.trashModule(id); });
            })(id, name));
            li.append(a, rename, remove);
            list.appendChild(li);
        }
    }

    private renameUserModule(li: HTMLElement, id: string, name: string) {
        var input = document.createElement("input");
        input.type = "text";
        input.className = "userModuleName";
        input.value = name;
        li.replaceChildren(input);
        input.focus();
        input.select();
        var done = false;
        var finish = (save: boolean) => {
            if (done) return;
            done = true;
            if (save && input.value.trim() && input.value.trim() != name) this.documents?.renameModule(id, input.value.trim());
            else this.fillUserModules();
        };
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key == "Enter") finish(true);
            if (e.key == "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
    }

    // The library in one view: the families of the catalog (public/faust-modules/library-catalog.json,
    // built by `npm run library-index`), grouped (modular, FaustPlayground) and then My modules; the modules
    // of the family chosen; the description of the module pointed at. The family chosen is remembered.
    private fCatalog: Catalog | null = null;
    private fFamily: string | null = null;

    fillLibrary() {
        Utilitary.getXHR("faust-modules/library-catalog.json", (json: string) => {
            this.fCatalog = JSON.parse(json);
            var families = this.fCatalog!.groups.flatMap((g) => g.families);
            var remembered = this.remembered("family");
            this.fFamily = remembered && (families.indexOf(remembered) >= 0 || remembered == USER_FAMILY) ? remembered : families[0];
            this.renderFamilies();
        }, (errorMessage: string) => { Utilitary.errorCallBack(errorMessage) });
    }

    private remembered(key: string): string | null {
        try { return localStorage.getItem("faustmodular:library:" + key); } catch { return null; }
    }

    private remember(key: string, value: string): void {
        try { localStorage.setItem("faustmodular:library:" + key, value); } catch { /* not kept */ }
    }

    // Chooses a family (My modules included).
    selectFamily(family: string) {
        this.fFamily = family;
        this.remember("family", family);
        this.renderFamilies();
    }

    private familyLabel(family: string): string {
        return family == USER_FAMILY ? Utilitary.messageResource.titleUserModules : (Utilitary.messageResource as any)["family_" + family] ?? family;
    }

    private renderFamilies() {
        var catalog = this.fCatalog;
        if (!catalog) return;
        var t = Utilitary.messageResource;
        var list = this.libraryView.families;
        list.replaceChildren();
        var item = (family: string, count: number) => {
            var li = document.createElement("li");
            li.className = "libraryFamily" + (family == this.fFamily ? " selected" : "");
            li.dataset.family = family;
            li.textContent = this.familyLabel(family);
            var badge = document.createElement("span");
            badge.className = "libraryCount";
            badge.textContent = String(count);
            li.appendChild(badge);
            li.addEventListener("click", () => this.selectFamily(family));
            list.appendChild(li);
        };
        var heading = (text: string) => {
            var li = document.createElement("li");
            li.className = "libraryGroup";
            li.textContent = text;
            list.appendChild(li);
        };
        var groupLabels: Record<string, string> = { Modular: t.libraryModular, FaustPlayground: t.libraryClassic, "Faust libraries": t.libraryFaust };
        for (var group of catalog.groups) {
            heading(groupLabels[group.name] ?? group.name);
            for (var family of group.families) {
                var count = catalog.modules.filter((m) => m.family == family).length;
                if (count > 0) item(family, count);
            }
        }
        item(USER_FAMILY, this.documents?.store.listModules().length ?? 0);
        list.lastElementChild!.classList.add("userFamily");
        this.renderModules();
    }

    private renderModules() {
        var view = this.libraryView;
        var user = this.fFamily == USER_FAMILY;
        view.modules.style.display = user ? "none" : "";
        view.userLibrarySelect.style.display = user ? "" : "none";
        if (user) {
            this.fillUserModules();
            this.describeUserModules();
            return;
        }
        var list = view.modules;
        list.replaceChildren();
        var modules = this.fCatalog!.modules.filter((m) => m.family == this.fFamily);
        for (var module of modules) {
            var li = document.createElement("li");
            var a = document.createElement("a");
            a.href = module.path;
            a.draggable = true;
            a.title = Utilitary.messageResource.hoverLibraryElement;
            a.text = module.name;
            a.addEventListener("click", (e) => { e.preventDefault() });
            a.ondblclick = this.dispatchEventLibrary.bind(this, a.href);
            a.ontouchstart = (e) => { this.dbleTouchMenu(e) };
            var show = ((m: CatalogModule) => () => this.describe(m))(module);
            a.addEventListener("mouseenter", show);
            a.addEventListener("focus", show);
            li.appendChild(a);
            list.appendChild(li);
        }
        list.scrollTop = 0;
        if (modules[0]) this.describe(modules[0]);
    }

    private describe(module: CatalogModule) {
        var t = Utilitary.messageResource;
        var box = this.libraryView.description;
        box.replaceChildren();
        var title = document.createElement("div");
        title.className = "libraryName";
        title.textContent = module.name;
        box.appendChild(title);
        if (module.functions.length > 0) {
            var functions = document.createElement("div");
            functions.className = "libraryFunctions";
            functions.textContent = module.functions.join(" \u00b7 ");
            box.appendChild(functions);
        }
        var ports = (label: string, names: string[]) => {
            if (names.length == 0) return;
            var line = document.createElement("div");
            line.className = "libraryPorts";
            line.textContent = label + " : " + names.join(", ");
            box.appendChild(line);
        };
        ports(t.portInlets, module.inlets);
        ports(t.portOutlets, module.outlets);
        var text = document.createElement("div");
        text.className = "libraryText";
        text.textContent = module.description;
        box.appendChild(text);
    }

    // My modules: what they are, in place of a description.
    private describeUserModules() {
        var box = this.libraryView.description;
        box.replaceChildren();
        var title = document.createElement("div");
        title.className = "libraryName";
        title.textContent = Utilitary.messageResource.titleUserModules;
        var text = document.createElement("div");
        text.className = "libraryText";
        text.textContent = Utilitary.messageResource.userModulesDescription;
        box.append(title, text);
    }

    //custom doube touch event handler
    dbleTouchMenu(touchEvent: TouchEvent) {
        var anchor: HTMLAnchorElement = <HTMLAnchorElement>touchEvent.target;
        if (!this.isLibraryTouch) {
            this.isLibraryTouch = true;
            this.previousTouchUrl = anchor.href;
            window.setTimeout(() => { this.isLibraryTouch = false; this.previousTouchUrl = "" }, 300)
        } else if (anchor.href == this.previousTouchUrl) {
            Utilitary.showFullPageLoading();
            this.dispatchEventLibrary(anchor.href);
            this.isLibraryTouch = false;
        } else {
            this.isLibraryTouch = false;
        }
    }
    //dispatch custom double touch
    dispatchEventLibrary(url: string) {
        var event: CustomEvent = new CustomEvent("dbltouchlib", { 'detail': url })
        document.dispatchEvent(event);
    }
    // scrollbars (perfect-scrollbar) shown at once
    initScroll() {
        for (var list of [this.libraryView.families, this.libraryView.modules, this.libraryView.userLibrarySelect]) list.scrollTop += 1;
    }
}
