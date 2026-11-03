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
import { search } from "../model/LibrarySearch";

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
        document.addEventListener("librarychange", () => { if (this.fQuery.trim() != "") this.setQuery(this.fQuery); else this.renderFamilies(); });
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
    // the search: its query, its results (the catalog and My modules), the one chosen by the keys
    private fQuery = "";
    private fResults: Array<{ name: string; family: string; href: string; module?: CatalogModule }> = [];
    private fActive = 0;

    fillLibrary() {
        this.attachSearch();
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
        this.fQuery = "";
        this.libraryView.search.value = "";
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
        var searching = this.fQuery.trim() != "";
        var item = (family: string, count: number) => {
            var li = document.createElement("li");
            li.className = "libraryFamily" + (!searching && family == this.fFamily ? " selected" : "") + (searching && count == 0 ? " empty" : "");
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
                if (count > 0) item(family, searching ? this.fResults.filter((r) => r.family == family).length : count);
            }
        }
        item(USER_FAMILY, searching ? this.fResults.filter((r) => r.family == USER_FAMILY).length : this.documents?.store.listModules().length ?? 0);
        list.lastElementChild!.classList.add("userFamily");
        this.renderModules();
    }

    private renderModules() {
        var view = this.libraryView;
        if (this.fQuery.trim() != "") {
            this.renderResults();
            return;
        }
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

    /******************** SEARCH ********************/

    // Typing filters the modules of all the families (and My modules); the arrows choose one, Enter adds it,
    // Escape clears the search. A click on a family leaves the search.
    private attachSearch() {
        var input = this.libraryView.search;
        input.addEventListener("input", () => this.setQuery(input.value));
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();        // not the shortcuts of the stage (Delete, undo...)
            if (e.key == "ArrowDown" || e.key == "ArrowUp") {
                e.preventDefault();
                if (this.fResults.length == 0) return;
                this.fActive = (this.fActive + (e.key == "ArrowDown" ? 1 : -1) + this.fResults.length) % this.fResults.length;
                this.showActive();
            } else if (e.key == "Enter") {
                e.preventDefault();
                var result = this.fResults[this.fActive];
                if (result) this.dispatchEventLibrary(result.href);
            } else if (e.key == "Escape" && input.value != "") {
                e.preventDefault();
                input.value = "";
                this.setQuery("");
            }
        });
    }

    // The search field, ready to type (the Modules menu is opened).
    focusSearch() {
        var input = this.libraryView.search;
        input.focus();
        input.select();
    }

    setQuery(query: string) {
        this.fQuery = query;
        this.fActive = 0;
        this.fResults = [];
        if (query.trim() != "" && this.fCatalog) {
            var base = location.href.split("#")[0];
            var all = [
                ...this.fCatalog.modules.filter((m) => m.family).map((m) => ({
                    name: m.name, functions: m.functions, family: m.family!, familyLabel: this.familyLabel(m.family!),
                    summary: m.summary, description: m.description, href: m.path, module: m,
                })),
                ...(this.documents?.store.listModules() ?? []).map((m) => ({
                    name: m.name, family: USER_FAMILY, familyLabel: this.familyLabel(USER_FAMILY), href: base + "#user-module:" + encodeURIComponent(m.id),
                })),
            ];
            this.fResults = search(query, all.map((m) => ({ ...m, family: m.familyLabel, familyKey: m.family, key: m.family })))
                .map((m: any) => ({ name: m.name, family: m.key, href: m.href, module: m.module }));
        }
        this.renderFamilies();
    }

    private renderResults() {
        var view = this.libraryView;
        var t = Utilitary.messageResource;
        view.modules.style.display = "";
        view.userLibrarySelect.style.display = "none";
        var list = view.modules;
        list.replaceChildren();
        if (this.fResults.length == 0) {
            var none = document.createElement("li");
            none.className = "librarySearchNone";
            none.textContent = t.librarySearchNone;
            list.appendChild(none);
            this.describeSearch();
            return;
        }
        this.fResults.forEach((result, i) => {
            var li = document.createElement("li");
            li.className = "librarySearchResult";
            var a = document.createElement("a");
            a.href = result.href;
            a.draggable = true;
            a.title = t.hoverLibraryElement;
            a.text = result.name;
            a.addEventListener("click", (e) => { e.preventDefault() });
            a.ondblclick = this.dispatchEventLibrary.bind(this, a.href);
            a.ontouchstart = (e) => { this.dbleTouchMenu(e) };
            var show = () => { this.fActive = i; this.showActive(false); };
            a.addEventListener("mouseenter", show);
            a.addEventListener("focus", show);
            var family = document.createElement("span");
            family.className = "librarySearchFamily";
            family.textContent = this.familyLabel(result.family);
            li.append(a, family);
            list.appendChild(li);
        });
        list.scrollTop = 0;
        this.showActive();
    }

    // The result chosen: marked, in view, described.
    private showActive(scroll = true) {
        var items = Array.from(this.libraryView.modules.querySelectorAll(".librarySearchResult"));
        items.forEach((li, i) => li.classList.toggle("active", i == this.fActive));
        if (scroll) (items[this.fActive] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
        var result = this.fResults[this.fActive];
        if (!result) return;
        if (result.module) this.describe(result.module);
        else this.describeUserModules();
    }

    // No result: what the search looks in.
    private describeSearch() {
        var box = this.libraryView.description;
        box.replaceChildren();
        var text = document.createElement("div");
        text.className = "libraryText";
        text.textContent = Utilitary.messageResource.librarySearchHint;
        box.append(text);
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
