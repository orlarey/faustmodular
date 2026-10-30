//LibraryView.ts : LibraryView Class which contains all the graphical parts of the library
import "../Lib/perfectScrollBar/js/perfect-scrollbar.min"

import { Utilitary } from "../Utilitary";

export class LibraryView {
    intrumentLibrarySelect: HTMLUListElement
    effetLibrarySelect: HTMLUListElement
    exempleLibrarySelect: HTMLUListElement
    multichannelLibrarySelect: HTMLUListElement
    modulationLibrarySelect: HTMLUListElement
    intrumentLibrary: HTMLElement
    effetLibrary: HTMLElement
    exempleLibrary: HTMLElement

    initLibraryView(): HTMLElement {

        var libraryContent: HTMLElement = document.createElement("div");
        libraryContent.id = "libraryContent";
        libraryContent.className = "menuContent";

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

        libraryContent.appendChild(instrumentLibraryContent)
        libraryContent.appendChild(effetLibraryContent)
        libraryContent.appendChild(exempleLibraryContent)
        libraryContent.appendChild(multichannelLibraryContent)

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
        libraryContent.appendChild(modulationLibraryContent)

        return libraryContent;
    }
}
