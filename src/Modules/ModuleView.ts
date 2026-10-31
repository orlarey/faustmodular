
/*				MODULEVIEW.JS
    HAND-MADE JAVASCRIPT CLASS CONTAINING A FAUST MODULE  INTERFACE

    Interface structure
    ===================
    DIV --> this.fModuleContainer
    H6 --> fTitle
    DIV --> fInterfaceContainer
    DIV --> fCloseButton
    DIV --> fFooter
    DIV --> fEditImg (edit in faustcode), fEditInline (integrated editor)
    ===================*/

import { HTMLInterfaceContainer } from "../Utilitary";

interface HTMLfEdit extends HTMLDivElement {
    area: HTMLTextAreaElement;
}
interface HTMLinterfaceElement extends HTMLElement {
    label: string;
}

export class ModuleView {
    fModuleContainer: HTMLElement;
    fName: string;
    fInterfaceContainer: HTMLInterfaceContainer;
    fEditImg: HTMLfEdit;
    fTitle: HTMLElement;
    fInputPorts: HTMLElement[] = [];
    fOutputPorts: HTMLElement[] = [];
    contentModule: HTMLElement;
    textArea: HTMLTextAreaElement;
    editError: HTMLElement;         // compilation errors of the integrated editor
    fEditInline: HTMLDivElement;    // opens (and validates) the integrated editor
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
            var textArea: HTMLTextAreaElement = document.createElement("textarea");
            textArea.rows = 15;
            textArea.cols = 60;
            textArea.className = "textArea"
            textArea.value = "";
            textArea.style.display = "none";
            textArea.spellcheck = false;
            this.textArea = textArea;
            fModuleContainer.appendChild(textArea);

            var editError = document.createElement("pre");
            editError.className = "edit-error";
            editError.style.display = "none";
            this.editError = editError;
            fModuleContainer.appendChild(editError);

            var fFooter: HTMLElement = document.createElement("footer");
            fFooter.id = "moduleFooter";
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

            var fEditImg = <HTMLfEdit>document.createElement("div");
            fEditImg.className = "edit"
            fEditImg.draggable = false;
            this.fEditImg = fEditImg;

            fFooter.appendChild(fEditImg);

            var fEditInline = document.createElement("div");
            fEditInline.className = "edit-inline";
            fEditInline.draggable = false;
            fEditInline.textContent = "</>";
            this.fEditInline = fEditInline;
            fFooter.appendChild(fEditInline);
            fModuleContainer.appendChild(fFooter);
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
    getModuleContainer(): HTMLElement {
        return this.fModuleContainer;
    }
    getInterfaceContainer(): HTMLInterfaceContainer {
        return this.fInterfaceContainer;
    }

    /******************** PORTS ********************/
    // One port per channel, on the bottom edge as on a modular synthesizer: inputs (green) in a row
    // from the left, outputs (red) in a row ending on the right. The left edge is kept for the
    // modulation ports (PatchView). Each port carries data-module, data-dir ("in" | "out") and
    // data-port (0-based) for hit testing.

    setPorts(moduleId: string, numInputs: number, numOutputs: number): void {
        this.clearPorts();
        this.fInputPorts = this.createPorts(moduleId, "in", numInputs);
        this.fOutputPorts = this.createPorts(moduleId, "out", numOutputs);
        // wide enough for both rows, and room under the content for the half of the ports inside
        var rows = [numInputs, numOutputs].filter((n) => n > 0);
        var width = rows.reduce((sum, n) => sum + n * ModuleView.portLayout(n).pitch, 0) + ModuleView.PORT_INSET * 2 + (rows.length > 1 ? ModuleView.PORT_GAP : 0);
        var size = Math.max(0, ...rows.map((n) => ModuleView.portLayout(n).size));
        this.fModuleContainer.style.minWidth = rows.length > 0 ? width + "px" : "";
        this.fModuleContainer.style.paddingBottom = size > 0 ? (size / 2 + 2) + "px" : "";
    }

    clearPorts(): void {
        this.fInputPorts.concat(this.fOutputPorts).forEach((port) => port.remove());
        this.fInputPorts = [];
        this.fOutputPorts = [];
    }

    getPort(dir: "in" | "out", index: number): HTMLElement | undefined {
        return (dir == "in" ? this.fInputPorts : this.fOutputPorts)[index];
    }

    // Distance of the rows from the corners, and between the input and output rows (px).
    static PORT_INSET = 10;
    static PORT_GAP = 16;

    // Port size and spacing shrink when there are many ports.
    static portLayout(count: number): { size: number; pitch: number } {
        if (count <= 4) return { size: 30, pitch: 36 };
        if (count <= 8) return { size: 24, pitch: 28 };
        return { size: 18, pitch: 20 };
    }

    private createPorts(moduleId: string, dir: "in" | "out", count: number): HTMLElement[] {
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
            // astride the bottom edge; inputs numbered from the left, outputs ending on the right
            port.style.bottom = (-layout.size / 2) + "px";
            var offset = ModuleView.PORT_INSET + (layout.pitch - layout.size) / 2;
            if (dir == "in") {
                port.style.left = (offset + i * layout.pitch) + "px";
            } else {
                port.style.right = (offset + (count - 1 - i) * layout.pitch) + "px";
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
