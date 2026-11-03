//LibraryView.ts : LibraryView Class which contains all the graphical parts of the library
import "../Lib/perfectScrollBar/js/perfect-scrollbar.min"

import { Utilitary } from "../Utilitary";

// The library in one view (Library.ts): the families, grouped (modular, FaustPlayground, My modules); the
// modules of the family chosen; the description of the module pointed at.
export class LibraryView {
    libraryContent: HTMLElement;
    families: HTMLUListElement;
    modules: HTMLUListElement;
    // My modules (the user modules of the documents), shown in place of the modules of the catalog
    userLibrarySelect: HTMLUListElement;
    description: HTMLElement;
    // the search of the modules (Library.search), above their list
    search: HTMLInputElement;

    initLibraryView(): HTMLElement {
        var libraryContent: HTMLElement = document.createElement("div");
        libraryContent.id = "libraryContent";
        libraryContent.className = "menuContent";

        var panel = document.createElement("div");
        panel.id = "libraryPanel";
        panel.className = "libraryPanel";
        var column = (id: string, title: string, ...content: HTMLElement[]) => {
            var box = document.createElement("div");
            box.id = id;
            box.className = "submenuLibraryContent libraryColumn";
            var t = document.createElement("span");
            t.className = "libraryTitles";
            t.textContent = title;
            box.append(t, ...content);
            panel.appendChild(box);
            return box;
        };

        this.families = document.createElement("ul");
        this.families.id = "libraryFamilies";
        this.families.className = "librarySelects libraryFamilies";
        this.modules = document.createElement("ul");
        this.modules.id = "libraryModules";
        this.modules.className = "librarySelects";
        this.userLibrarySelect = document.createElement("ul");
        this.userLibrarySelect.id = "userLibrarySelect";
        this.userLibrarySelect.className = "librarySelects";
        this.userLibrarySelect.style.display = "none";
        this.description = document.createElement("div");
        this.description.id = "libraryDescription";
        this.description.className = "libraryDescription";
        for (var list of [this.families, this.modules, this.userLibrarySelect]) {
            Ps.initialize(list, { suppressScrollX: true, theme: 'my-theme-name' });
        }

        this.search = document.createElement("input");
        this.search.type = "search";
        this.search.id = "librarySearch";
        this.search.className = "librarySearch";
        this.search.placeholder = Utilitary.messageResource.librarySearch;
        this.search.setAttribute("aria-label", Utilitary.messageResource.librarySearch);
        this.search.autocomplete = "off";
        this.search.spellcheck = false;

        column("libraryFamiliesContent", Utilitary.messageResource.titleFamilies, this.families);
        column("libraryModulesContent", Utilitary.messageResource.titleModules, this.search, this.modules, this.userLibrarySelect);
        column("libraryDescriptionContent", Utilitary.messageResource.titleDescription, this.description);

        libraryContent.appendChild(panel);
        this.libraryContent = libraryContent;
        return libraryContent;
    }
}
