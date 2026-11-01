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

interface IImageNode extends HTMLImageElement {
    state: string;
    section: string;
    folder: HTMLUListElement;
}
interface jsonObjectLibrary {
    instrument: string;
    effet: string;
    exemple: string;
    instrumentSupprStructure: string;
    effetSupprStructure: string;
    exempleSupprStructure: string;
    instruments: string[];
    effets: string[];
    exemples: string[];
    multicanal?: string[];
    modulation?: string[];
    affichage?: string[];
}

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

export class Library {
    libraryView: LibraryView;
    isLibraryTouch: boolean;
    previousTouchUrl: string;
    isSmaller: boolean = false;
    isDblTouch: boolean = false;
    documents: Documents | null = null;

    setDocuments(documents: Documents) {
        this.documents = documents;
        document.addEventListener("librarychange", () => this.fillUserModules());
        this.fillUserModules();
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

    // The modular library (Documentation/MODULAR-LIBRARY.md): families of functions, their modules,
    // and the description of the module pointed at. Which library is shown is remembered.
    private fCatalog: { families: string[]; modules: CatalogModule[] } | null = null;
    private fFamily: string | null = null;

    fillModular() {
        Utilitary.getXHR("faust-modules/modular-catalog.json", (json: string) => {
            this.fCatalog = JSON.parse(json);
            this.fFamily = this.remembered("family") ?? this.fCatalog!.families[0];
            this.renderFamilies();
        }, (errorMessage: string) => { Utilitary.errorCallBack(errorMessage) });
        this.libraryView.librarySwitch.querySelectorAll<HTMLElement>(".librarySwitchButton").forEach((b) => {
            b.addEventListener("click", () => this.showLibrary(b.dataset.library as "modular" | "classic"));
        });
        this.showLibrary(this.remembered("library") == "classic" ? "classic" : "modular");
    }

    private remembered(key: string): string | null {
        try { return localStorage.getItem("faustmodular:library:" + key); } catch { return null; }
    }

    private remember(key: string, value: string): void {
        try { localStorage.setItem("faustmodular:library:" + key, value); } catch { /* not kept */ }
    }

    showLibrary(kind: "modular" | "classic") {
        this.libraryView.modularPanel.style.display = kind == "modular" ? "" : "none";
        this.libraryView.classicPanel.style.display = kind == "classic" ? "" : "none";
        this.libraryView.librarySwitch.querySelectorAll<HTMLElement>(".librarySwitchButton").forEach((b) => b.classList.toggle("selected", b.dataset.library == kind));
        this.libraryView.libraryContent?.classList.toggle("modular", kind == "modular");
        this.remember("library", kind);
    }

    private renderFamilies() {
        var catalog = this.fCatalog!;
        var list = this.libraryView.modularFamilies;
        list.replaceChildren();
        for (var family of catalog.families) {
            var count = catalog.modules.filter((m) => m.family == family).length;
            if (count == 0) continue;
            var li = document.createElement("li");
            li.className = "modularFamily" + (family == this.fFamily ? " selected" : "");
            li.dataset.family = family;
            li.textContent = (Utilitary.messageResource as any)["family_" + family] ?? family;
            var badge = document.createElement("span");
            badge.className = "modularCount";
            badge.textContent = String(count);
            li.appendChild(badge);
            li.addEventListener("click", ((f: string) => () => { this.fFamily = f; this.remember("family", f); this.renderFamilies(); })(family));
            list.appendChild(li);
        }
        this.renderModules();
    }

    private renderModules() {
        var list = this.libraryView.modularModules;
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
        if (modules[0]) this.describe(modules[0]);
    }

    private describe(module: CatalogModule) {
        var t = Utilitary.messageResource;
        var box = this.libraryView.modularDescription;
        box.replaceChildren();
        var title = document.createElement("div");
        title.className = "modularName";
        title.textContent = module.name;
        var functions = document.createElement("div");
        functions.className = "modularFunctions";
        functions.textContent = module.functions.join(" \u00b7 ");
        box.append(title, functions);
        var ports = (label: string, names: string[]) => {
            if (names.length == 0) return;
            var line = document.createElement("div");
            line.className = "modularPorts";
            line.textContent = label + " : " + names.join(", ");
            box.appendChild(line);
        };
        ports(t.portInlets, module.inlets);
        ports(t.portOutlets, module.outlets);
        var text = document.createElement("div");
        text.className = "modularText";
        text.textContent = module.description;
        box.appendChild(text);
    }

    //get json with library infos
    fillLibrary() {
        this.fillModular();
        var url: string = "faust-modules/index.json"
        Utilitary.getXHR(url, (json: string) => { this.fillLibraryCallBack(json) }, (errorMessage: string) => { Utilitary.errorCallBack(errorMessage) });
    }

    //dispatch library info to each submenu
    fillLibraryCallBack(json: string) {
        var jsonObject: jsonObjectLibrary = JSON.parse(json);
        jsonObject.effet = "effetLibrarySelect";
        jsonObject.effetSupprStructure = "faust-modules/effects/";
        jsonObject.instrument = "instrumentLibrarySelect";
        jsonObject.instrumentSupprStructure = "faust-modules/generators/";
        jsonObject.exemple = "exempleLibrarySelect";
        jsonObject.exempleSupprStructure = "faust-modules/combined/";
        this.fillSubMenu(jsonObject.instruments, jsonObject.instrument, jsonObject.instrumentSupprStructure);
        this.fillSubMenu(jsonObject.effets, jsonObject.effet, jsonObject.effetSupprStructure);
        this.fillSubMenu(jsonObject.exemples, jsonObject.exemple, jsonObject.exempleSupprStructure);
        this.fillSubMenu(jsonObject.multicanal ?? [], "multichannelLibrarySelect", "faust-modules/multichannel/");
        this.fillSubMenu(jsonObject.modulation ?? [], "modulationLibrarySelect", "faust-modules/modulation/");
        this.fillSubMenu(jsonObject.affichage ?? [], "displayLibrarySelect", "faust-modules/display/");
    }

    //fill submenu and attach events
    fillSubMenu(options: string[], subMenuId: string, stringStructureRemoved: string) {
        var subMenu: HTMLUListElement = <HTMLUListElement>document.getElementById(subMenuId);

        for (var i = 0; i < options.length; i++) {

            var li: HTMLLIElement = document.createElement("li");
            var a: HTMLAnchorElement = document.createElement("a");
            li.appendChild(a);
            a.href = options[i];
            a.draggable = true;
            a.title = Utilitary.messageResource.hoverLibraryElement;
            a.addEventListener("click", (e) => { e.preventDefault() });

            var dblckickHandler = this.dispatchEventLibrary.bind(this, a.href)
            a.ondblclick = dblckickHandler;
            a.ontouchstart = (e) => { this.dbleTouchMenu(e) }

            a.text = this.cleanNameElement(options[i], stringStructureRemoved);
            subMenu.appendChild(li)
        }
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
    // init scroll to show scroll from perfectScroll.js
    initScroll() {
        this.libraryView.effetLibrarySelect.scrollTop += 1;
        this.libraryView.exempleLibrarySelect.scrollTop += 1;
        this.libraryView.intrumentLibrarySelect.scrollTop += 1;
        this.libraryView.multichannelLibrarySelect.scrollTop += 1;
        this.libraryView.modulationLibrarySelect.scrollTop += 1;
        this.libraryView.userLibrarySelect.scrollTop += 1;
        this.libraryView.displayLibrarySelect.scrollTop += 1;
    }

    //remove .dsp extention and uri from element to get title
    cleanNameElement(elementComplete: string, stringStructureRemoved: string): string {
        return elementComplete.replace(stringStructureRemoved, "").replace(".dsp", "");
    }
}
