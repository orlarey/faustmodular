
/*				MODULEVIEW.JS
    HAND-MADE JAVASCRIPT CLASS CONTAINING A FAUST MODULE  INTERFACE

    Interface structure
    ===================
    DIV --> this.fModuleContainer
    H6 --> fTitle
    DIV --> fInterfaceContainer
    DIV --> fCloseButton
    DIV --> fEditImg (pencil in the title bar: edit the code in faustcode)
    ===================*/

import { HTMLInterfaceContainer } from "../Utilitary";

interface HTMLinterfaceElement extends HTMLElement {
    label: string;
}

export class ModuleView {
    fModuleContainer: HTMLElement;
    fName: string;
    fInterfaceContainer: HTMLInterfaceContainer;
    fEditImg: HTMLDivElement;
    fUpdate: HTMLDivElement;
    fTitle: HTMLElement;
    fInputPorts: HTMLElement[] = [];
    fOutputPorts: HTMLElement[] = [];
    contentModule: HTMLElement;
    miniButton: HTMLDivElement;
    maxButton: HTMLDivElement;
    closeButton: HTMLDivElement;
    x: number;
    y: number;

    createModuleView(ID: number, x: number, y: number, name: string, htmlParent: HTMLElement): void {

        //------- GRAPHICAL ELEMENTS OF MODULE
        var fModuleContainer = document.createElement("div");
        fModuleContainer.className = "moduleFaust";
        fModuleContainer.style.left = "" + x + "px";
        fModuleContainer.style.top = "" + y + "px";

        var fTitle = document.createElement("h6");
        fTitle.className = "module-title";
        fTitle.textContent = "";
        fModuleContainer.appendChild(fTitle);

        var fInterfaceContainer = <HTMLInterfaceContainer>document.createElement("div");
        fInterfaceContainer.className = "content";
        fModuleContainer.appendChild(fInterfaceContainer);
        this.fInterfaceContainer = fInterfaceContainer;
        //if modules are input or output scene module, no need for interface
        if (name == "input") {
            fModuleContainer.id = "moduleInput";
        } else if (name == "output") {
            fModuleContainer.id = "moduleOutput";
        } else {
            fModuleContainer.id = "module" + ID;

            var fCloseButton: HTMLDivElement = document.createElement("div");
            fCloseButton.draggable = false;
            fCloseButton.className = "close";
            this.closeButton = fCloseButton;

            var fMinButton: HTMLDivElement = document.createElement("div");
            fMinButton.draggable = false;
            fMinButton.className = "minus";
            this.miniButton = fMinButton;

            var fMaxButton: HTMLDivElement = document.createElement("div");
            fMaxButton.draggable = false;
            fMaxButton.className = "max";
            this.maxButton = fMaxButton;

            fModuleContainer.appendChild(fCloseButton);
            fModuleContainer.appendChild(fMinButton);
            fModuleContainer.appendChild(fMaxButton);

            // the pencil, in the title bar: edits the code in faustcode
            var fEditImg = document.createElement("div");
            fEditImg.className = "edit";
            fEditImg.draggable = false;
            this.fEditImg = fEditImg;
            fModuleContainer.appendChild(fEditImg);

            // ↑ next to it, when a newer version of the module exists (documents)
            var fUpdate = document.createElement("div");
            fUpdate.className = "update";
            fUpdate.draggable = false;
            fUpdate.textContent = "\u2191";
            fUpdate.style.display = "none";
            this.fUpdate = fUpdate;
            fModuleContainer.appendChild(fUpdate);
        }

        htmlParent.appendChild(fModuleContainer);

        this.fName = name;
        this.fModuleContainer = fModuleContainer;
        this.fInterfaceContainer = fInterfaceContainer;
        this.fEditImg = fEditImg!;
        this.fTitle = fTitle;
        this.x = x;
        this.y = y;
    }
    setUpdateAvailable(available: boolean): void {
        if (this.fUpdate) this.fUpdate.style.display = available ? "" : "none";
    }
    getModuleContainer(): HTMLElement {
        return this.fModuleContainer;
    }
    getInterfaceContainer(): HTMLInterfaceContainer {
        return this.fInterfaceContainer;
    }

    /******************** PORTS ********************/
    // One port per channel, astride the side edges in a zone at the bottom of the module, under the
    // last widget: inputs on the left edge, outputs on the right edge, numbered from the top. The
    // left edge above the zone is kept for the modulation ports (PatchView). Each port carries
    // data-module, data-dir ("in" | "out") and data-port (0-based) for hit testing.

    // The physical input and output modules have no widgets: their ports are centered vertically,
    // and the module grows only when they need more room than its icon.
    setPorts(moduleId: string, numInputs: number, numOutputs: number): void {
        this.clearPorts();
        var column = Math.max(ModuleView.columnHeight(numInputs), ModuleView.columnHeight(numOutputs));
        var zone = column > 0 ? column + 2 * ModuleView.PORT_INSET : 0;
        var centered = this.fName == "input" || this.fName == "output";
        this.fInputPorts = this.createPorts(moduleId, "in", numInputs, zone, centered);
        this.fOutputPorts = this.createPorts(moduleId, "out", numOutputs, zone, centered);
        if (centered) {
            this.fModuleContainer.style.height = zone > ModuleView.PHYSICAL_HEIGHT ? zone + "px" : "";
        } else {
            this.fModuleContainer.style.paddingBottom = zone > 0 ? zone + "px" : "";
        }
        this.fModuleContainer.style.minWidth = "";
    }

    // Height of the physical input and output modules (css: #moduleInput, #moduleOutput).
    static PHYSICAL_HEIGHT = 88;

    clearPorts(): void {
        this.fInputPorts.concat(this.fOutputPorts).forEach((port) => port.remove());
        this.fInputPorts = [];
        this.fOutputPorts = [];
    }

    getPort(dir: "in" | "out", index: number): HTMLElement | undefined {
        return (dir == "in" ? this.fInputPorts : this.fOutputPorts)[index];
    }

    // Margin above and below the columns of ports (px).
    static PORT_INSET = 8;

    private static columnHeight(count: number): number {
        return count > 0 ? count * ModuleView.portLayout(count).pitch : 0;
    }

    // Port size and spacing shrink when there are many ports.
    static portLayout(count: number): { size: number; pitch: number } {
        if (count <= 4) return { size: 30, pitch: 36 };
        if (count <= 8) return { size: 24, pitch: 28 };
        return { size: 18, pitch: 20 };
    }

    private createPorts(moduleId: string, dir: "in" | "out", count: number, zone: number, centered: boolean): HTMLElement[] {
        var layout = ModuleView.portLayout(count);
        var ports: HTMLElement[] = [];
        for (var i = 0; i < count; i++) {
            var port = document.createElement("div");
            port.className = "port " + (dir == "in" ? "port-input" : "port-output");
            port.draggable = false;
            port.dataset.module = moduleId;
            port.dataset.dir = dir;
            port.dataset.port = String(i);
            port.title = (dir == "in" ? "input " : "output ") + (i + 1);
            port.style.width = port.style.height = layout.size + "px";
            // astride the left (inputs) or right (outputs) edge, from the top of the zone down, or
            // centered on the module (physical input and output)
            if (centered) {
                port.style.top = `calc(50% + ${(i - (count - 1) / 2) * layout.pitch - layout.size / 2}px)`;
            } else {
                var center = zone - ModuleView.PORT_INSET - (i + 0.5) * layout.pitch;     // from the bottom
                port.style.bottom = (center - layout.size / 2) + "px";
            }
            if (dir == "in") {
                port.style.left = (-layout.size / 2) + "px";
            } else {
                port.style.right = (-layout.size / 2) + "px";
            }
            var dot = document.createElement("span");
            dot.draggable = false;
            if (count > 1) {
                dot.textContent = String(i + 1);
            }
            port.appendChild(dot);
            this.fModuleContainer.appendChild(port);
            ports.push(port);
        }
        return ports;
    }
}
