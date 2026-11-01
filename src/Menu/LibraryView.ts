//LibraryView.ts : LibraryView Class which contains all the graphical parts of the library
import "../Lib/perfectScrollBar/js/perfect-scrollbar.min"

import { Utilitary } from "../Utilitary";

export class LibraryView {
    intrumentLibrarySelect: HTMLUListElement
    effetLibrarySelect: HTMLUListElement
    exempleLibrarySelect: HTMLUListElement
    multichannelLibrarySelect: HTMLUListElement
    modulationLibrarySelect: HTMLUListElement
    userLibrarySelect: HTMLUListElement
    // the modular library: a family of functions, its modules, the description of a module
    librarySwitch: HTMLElement;
    libraryContent: HTMLElement;
    modularPanel: HTMLElement;
    classicPanel: HTMLElement;
    modularFamilies: HTMLUListElement;
    modularModules: HTMLUListElement;
    modularDescription: HTMLElement;
    displayLibrarySelect: HTMLUListElement
    intrumentLibrary: HTMLElement
    effetLibrary: HTMLElement
    exempleLibrary: HTMLElement

    initLibraryView(): HTMLElement {

        var libraryContent: HTMLElement = document.createElement("div");
        libraryContent.id = "libraryContent";
        libraryContent.className = "menuContent";

        // which library: modular (by families of functions) or FaustPlayground (the columns below)
        var librarySwitch = document.createElement("div");
        librarySwitch.id = "librarySwitch";
        for (var [kind, label] of [["modular", Utilitary.messageResource.libraryModular], ["classic", Utilitary.messageResource.libraryClassic]]) {
            var pill = document.createElement("button");
            pill.type = "button";
            pill.className = "button librarySwitchButton";
            pill.dataset.library = kind;
            pill.textContent = label;
            librarySwitch.appendChild(pill);
        }
        this.librarySwitch = librarySwitch;

        var modularPanel = document.createElement("div");
        modularPanel.id = "modularPanel";
        modularPanel.className = "libraryPanel";
        var column = (id: string, title: string, list: HTMLElement) => {
            var content = document.createElement("div");
            content.id = id;
            content.className = "submenuLibraryContent modularColumn";
            var t = document.createElement("span");
            t.className = "libraryTitles";
            t.textContent = title;
            content.append(t, list);
            modularPanel.appendChild(content);
            return content;
        };
        this.modularFamilies = document.createElement("ul");
        this.modularFamilies.className = "librarySelects modularFamilies";
        this.modularModules = document.createElement("ul");
        this.modularModules.id = "modularModules";
        this.modularModules.className = "librarySelects";
        this.modularDescription = document.createElement("div");
        this.modularDescription.className = "modularDescription";
        column("modularFamiliesContent", Utilitary.messageResource.titleFamilies, this.modularFamilies);
        column("modularModulesContent", Utilitary.messageResource.titleModules, this.modularModules);
        column("modularDescriptionContent", Utilitary.messageResource.titleDescription, this.modularDescription);
        this.modularPanel = modularPanel;

        var classicPanel = document.createElement("div");
        classicPanel.id = "classicPanel";
        classicPanel.className = "libraryPanel";
        this.classicPanel = classicPanel;

        /////////////////Instruments

        var instrumentLibraryContent: HTMLElement = document.createElement("div");
        instrumentLibraryContent.id = "instrumentLibraryContent";
        instrumentLibraryContent.className = "submenuLibraryContent";
        this.intrumentLibrary = instrumentLibraryContent;

        var instrumentLibraryTitle: HTMLSpanElement = document.createElement("span");
        instrumentLibraryTitle.id = "instrumentLibraryTitle";
        instrumentLibraryTitle.className = "libraryTitles";
        instrumentLibraryTitle.appendChild(document.createTextNode(Utilitary.messageResource.titleInstruments));

        var intrumentLibrarySelect: HTMLUListElement = document.createElement("ul");
        intrumentLibrarySelect.id = "instrumentLibrarySelect";
        intrumentLibrarySelect.className = "librarySelects";
        Ps.initialize(intrumentLibrarySelect, { suppressScrollX: true, theme: 'my-theme-name' })
        this.intrumentLibrarySelect = intrumentLibrarySelect;

        instrumentLibraryContent.appendChild(instrumentLibraryTitle);
        instrumentLibraryContent.appendChild(intrumentLibrarySelect);

        ///////////////Effects

        var effetLibraryContent: HTMLElement = document.createElement("div");
        effetLibraryContent.id = "effetLibraryContent";
        effetLibraryContent.className = "submenuLibraryContent";
        this.effetLibrary = effetLibraryContent;

        var effetLibraryTitle: HTMLSpanElement = document.createElement("span");
        effetLibraryTitle.id = "effetLibraryTitle";
        effetLibraryTitle.className = "libraryTitles";
        effetLibraryTitle.appendChild(document.createTextNode(Utilitary.messageResource.titleEffects));

        var effetLibrarySelect: HTMLUListElement = document.createElement("ul");
        effetLibrarySelect.id = "effetLibrarySelect";
        effetLibrarySelect.className = "librarySelects";
        Ps.initialize(effetLibrarySelect, { suppressScrollX: true, theme: 'my-theme-name' })
        this.effetLibrarySelect = effetLibrarySelect;

        effetLibraryContent.appendChild(effetLibraryTitle);
        effetLibraryContent.appendChild(effetLibrarySelect);

        /////////////Exemple

        var exempleLibraryContent: HTMLElement = document.createElement("div");
        exempleLibraryContent.id = "exempleLibraryContent";
        exempleLibraryContent.className = "submenuLibraryContent";
        this.exempleLibrary = exempleLibraryContent;

        var exempleLibraryTitle: HTMLSpanElement = document.createElement("span");
        exempleLibraryTitle.id = "exempleLibraryTitle";
        exempleLibraryTitle.className = "libraryTitles";
        exempleLibraryTitle.appendChild(document.createTextNode(Utilitary.messageResource.titleExemples));

        var exempleLibrarySelect: HTMLUListElement = document.createElement("ul");
        exempleLibrarySelect.id = "exempleLibrarySelect";
        exempleLibrarySelect.className = "librarySelects";
        Ps.initialize(exempleLibrarySelect, { suppressScrollX: true, theme: 'my-theme-name' });
        this.exempleLibrarySelect = exempleLibrarySelect;

        exempleLibraryContent.appendChild(exempleLibraryTitle);
        exempleLibraryContent.appendChild(exempleLibrarySelect);

        /////////////Multichannel modules

        var multichannelLibraryContent: HTMLElement = document.createElement("div");
        multichannelLibraryContent.id = "multichannelLibraryContent";
        multichannelLibraryContent.className = "submenuLibraryContent";

        var multichannelLibraryTitle: HTMLSpanElement = document.createElement("span");
        multichannelLibraryTitle.id = "multichannelLibraryTitle";
        multichannelLibraryTitle.className = "libraryTitles";
        multichannelLibraryTitle.appendChild(document.createTextNode(Utilitary.messageResource.titleMultichannel));

        var multichannelLibrarySelect: HTMLUListElement = document.createElement("ul");
        multichannelLibrarySelect.id = "multichannelLibrarySelect";
        multichannelLibrarySelect.className = "librarySelects";
        Ps.initialize(multichannelLibrarySelect, { suppressScrollX: true, theme: 'my-theme-name' });
        this.multichannelLibrarySelect = multichannelLibrarySelect;

        multichannelLibraryContent.appendChild(multichannelLibraryTitle);
        multichannelLibraryContent.appendChild(multichannelLibrarySelect);

        classicPanel.appendChild(instrumentLibraryContent)
        classicPanel.appendChild(effetLibraryContent)
        classicPanel.appendChild(exempleLibraryContent)
        classicPanel.appendChild(multichannelLibraryContent)

        /////////////Modulation sources (LFO, envelopes...)

        var modulationLibraryContent: HTMLElement = document.createElement("div");
        modulationLibraryContent.id = "modulationLibraryContent";
        modulationLibraryContent.className = "submenuLibraryContent";

        var modulationLibraryTitle: HTMLSpanElement = document.createElement("span");
        modulationLibraryTitle.id = "modulationLibraryTitle";
        modulationLibraryTitle.className = "libraryTitles";
        modulationLibraryTitle.appendChild(document.createTextNode(Utilitary.messageResource.titleModulation));

        var modulationLibrarySelect: HTMLUListElement = document.createElement("ul");
        modulationLibrarySelect.id = "modulationLibrarySelect";
        modulationLibrarySelect.className = "librarySelects";
        Ps.initialize(modulationLibrarySelect, { suppressScrollX: true, theme: 'my-theme-name' });
        this.modulationLibrarySelect = modulationLibrarySelect;

        modulationLibraryContent.appendChild(modulationLibraryTitle);
        modulationLibraryContent.appendChild(modulationLibrarySelect);
        classicPanel.appendChild(modulationLibraryContent)

        /////////////Displays: level meters, value, oscilloscope, spectrum

        var displayLibraryContent: HTMLElement = document.createElement("div");
        displayLibraryContent.id = "displayLibraryContent";
        displayLibraryContent.className = "submenuLibraryContent";

        var displayLibraryTitle: HTMLSpanElement = document.createElement("span");
        displayLibraryTitle.id = "displayLibraryTitle";
        displayLibraryTitle.className = "libraryTitles";
        displayLibraryTitle.appendChild(document.createTextNode(Utilitary.messageResource.titleDisplay));

        var displayLibrarySelect: HTMLUListElement = document.createElement("ul");
        displayLibrarySelect.id = "displayLibrarySelect";
        displayLibrarySelect.className = "librarySelects";
        Ps.initialize(displayLibrarySelect, { suppressScrollX: true, theme: 'my-theme-name' });
        this.displayLibrarySelect = displayLibrarySelect;

        displayLibraryContent.appendChild(displayLibraryTitle);
        displayLibraryContent.appendChild(displayLibrarySelect);
        classicPanel.appendChild(displayLibraryContent)

        /////////////My modules: the user modules (documents)

        var userLibraryContent: HTMLElement = document.createElement("div");
        userLibraryContent.id = "userLibraryContent";
        userLibraryContent.className = "submenuLibraryContent";

        var userLibraryTitle: HTMLSpanElement = document.createElement("span");
        userLibraryTitle.id = "userLibraryTitle";
        userLibraryTitle.className = "libraryTitles";
        userLibraryTitle.appendChild(document.createTextNode(Utilitary.messageResource.titleUserModules));

        var userLibrarySelect: HTMLUListElement = document.createElement("ul");
        userLibrarySelect.id = "userLibrarySelect";
        userLibrarySelect.className = "librarySelects";
        Ps.initialize(userLibrarySelect, { suppressScrollX: true, theme: 'my-theme-name' });
        this.userLibrarySelect = userLibrarySelect;

        userLibraryContent.appendChild(userLibraryTitle);
        userLibraryContent.appendChild(userLibrarySelect);

        // the user modules: next to either library
        var panels = document.createElement("div");
        panels.id = "libraryPanels";
        panels.append(modularPanel, classicPanel, userLibraryContent);
        libraryContent.append(librarySwitch, panels);
        this.libraryContent = libraryContent;

        return libraryContent;
    }
}
