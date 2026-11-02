/*				
    MODULECLASS.JS
    HAND-MADE JAVASCRIPT CLASS CONTAINING A FAUST MODULE AND ITS INTERFACE
*/
import type { FaustDspFactory } from "@grame/faustwasm";

import { sliderRange, valueAt } from "../model/SliderScale";
import { ModuleDisplays } from "./Displays";
import { LayoutNode, uiLayout } from "../model/UILayout";
import { ElementCodeFaustParser, FaustInterfaceControler, FaustInterfaceView, setControlerValue } from "./FaustInterface";
import { Message } from "../Messages";
import { ModuleFaust } from "./ModuleFaust";
import { ModuleView } from "./ModuleView";
import { CompileFaust, IfDSP, Utilitary } from "../Utilitary";
import { AccelerometerHandler } from "../Accelerometer";
import { faustWasmEnv } from "../Main";
import { forgeAccMetadata, updateAccInFaustCode } from "../CodeFaustParser";
import { DEPTH_METADATA, DRIVEN_METADATA, depthKey, listWidgets, widgetTarget } from "../model/Modulation";
import { MAX_CHANNELS, ModuleId } from "../model/Patch";

interface DSPCallback { (): void; }

export class ModuleClass {
    //id of the module in the patch model (set when the module is added to the scene)
    moduleId: ModuleId;

    moduleView: ModuleView;
    moduleFaust: ModuleFaust;
    moduleControles: FaustInterfaceControler[] = [];

    private deleteCallback: (module: ModuleClass) => void;
    // why the last createDSP failed (shown by the code editors)
    displays: ModuleDisplays | null = null;
    lastError: string | null = null;
    private fModuleInterfaceParams: { [label: string]: string } = {};

    compileFaust: (conpileFaust: CompileFaust) => Promise<void>;

    constructor(id: number, x: number, y: number, name: string, htmlElementModuleContainer: HTMLElement, removeModuleCallBack: (m: ModuleClass) => void, compileFaust: (compileFaust: CompileFaust) => Promise<void>) {
        this.compileFaust = compileFaust;

        this.deleteCallback = removeModuleCallBack;

        this.moduleView = new ModuleView();
        this.moduleView.createModuleView(id, x, y, name, htmlElementModuleContainer);
        this.moduleFaust = new ModuleFaust(name);
        this.addEvents();
    }

    //add all event listener to the moduleView
    addEvents() {
        // dragging of the module and of its cables is handled by the PatchView (Pointer Events)
        if (this.moduleView.closeButton != undefined) {
            this.moduleView.closeButton.addEventListener("click", () => { this.deleteModule(); });
            this.moduleView.closeButton.addEventListener("touchend", () => { this.deleteModule(); });
        }
        if (this.moduleView.miniButton != undefined) {
            this.moduleView.miniButton.addEventListener("click", () => { this.minModule(); });
            this.moduleView.miniButton.addEventListener("touchend", () => { this.minModule(); });
        }
        if (this.moduleView.maxButton != undefined) {
            this.moduleView.maxButton.addEventListener("click", () => { this.maxModule(); });
            this.moduleView.maxButton.addEventListener("touchend", () => { this.maxModule(); });
        }
        if (this.moduleView.fEditImg != undefined) {
            // the pencil edits the code in faustcode (FaustcodeLink)
            this.moduleView.fEditImg.title = Utilitary.messageResource.editInFaustcode;
            this.moduleView.fEditImg.addEventListener("click", () => { Utilitary.currentScene.editInFaustcode(this) });
        }
        if (this.moduleView.fDuplicate != undefined) {
            this.moduleView.fDuplicate.title = Utilitary.messageResource.moduleDuplicate;
            this.moduleView.fDuplicate.addEventListener("click", () => {
                var scene = Utilitary.currentScene;
                var selection = scene.patchView.getSelection();
                scene.duplicateModules(selection.indexOf(this.moduleId) >= 0 ? selection : [this.moduleId]);
            });
        }
        if (this.moduleView.fUpdate != undefined) {
            this.moduleView.fUpdate.title = Utilitary.messageResource.moduleUpdate;
            this.moduleView.fUpdate.addEventListener("click", () => { Utilitary.currentScene.updateModule(this) });
        }
    }

    /***************  PRIVATE METHODS  ******************************/

    /*******************************  PUBLIC METHODS  **********************************/
    // Removes the module; its connections are removed with it from the patch (Scene.removeModule).
    deleteModule(): void {

        this.deleteFaustInterface();

        // Then delete the visual element
        if (this.moduleView) {
            this.moduleView.fModuleContainer.parentNode!.removeChild(this.moduleView.fModuleContainer);
        }

        this.deleteDSP(this.moduleFaust.fDSP);
        (this.moduleFaust.fDSP as any) = null;
        (this.moduleFaust.factory as any) = null;
        this.deleteCallback(this);
    }
    //make module smaller
    minModule() {
        this.moduleView.fInterfaceContainer.classList.add("mini");
        this.moduleView.fTitle.classList.add("miniTitle");
        this.moduleView.miniButton.style.display = "none";
        this.moduleView.maxButton.style.display = "block";
        this.redrawCables();
    }
    //restore module size
    maxModule() {
        this.moduleView.fInterfaceContainer.classList.remove("mini");
        this.moduleView.fTitle.classList.remove("miniTitle");
        this.moduleView.maxButton.style.display = "none";
        this.moduleView.miniButton.style.display = "block";
        this.redrawCables();
    }

    //--- Create and Update are called once a source code is compiled and the factory exists
    async createDSP(factory: FaustDspFactory, callback: DSPCallback): Promise<void> {
        this.moduleFaust.factory = factory;
        this.lastError = null;
        try {
            if (factory != null) {
                const { inputs, outputs } = JSON.parse(factory.json);
                if (inputs > MAX_CHANNELS || outputs > MAX_CHANNELS) {
                    this.lastError = `${Utilitary.messageResource.errorCreateDSP} : ${inputs} inputs and ${outputs} outputs, the maximum is ${MAX_CHANNELS}`;
                    new Message(`${Utilitary.messageResource.errorCreateDSP} : ${inputs} inputs and ${outputs} outputs, the maximum is ${MAX_CHANNELS}`);
                    Utilitary.hideFullPageLoading();
                    return;
                }
                var moduleFaust = this.moduleFaust;
                const faustMonoDspGenerator = new faustWasmEnv.FaustMonoDspGenerator();
                const dsp = typeof AudioWorklet !== "undefined"
                        ? await faustMonoDspGenerator.createNode(Utilitary.audioContext, "FaustDSP", factory)
                        : await faustMonoDspGenerator.createNode(Utilitary.audioContext, "FaustDSP", factory, true, 1024);
                // To activate the AudioWorklet mode
                //faust.createDSPWorkletInstance(factory, Utilitary.audioContext, function(dsp) { moduleFaust.fDSP = dsp; callback(); });
                if (dsp != null) {
                    moduleFaust.fDSP = dsp;
                    // the names of the ports the module declares (declare inlets "..."; declare outlets "...";)
                    var meta: Array<Record<string, string>> = JSON.parse(factory.json).meta ?? [];
                    var names = (key: string) => (meta.find((m) => m[key] !== undefined)?.[key] ?? "").split(";").map((n) => n.trim()).filter(Boolean);
                    this.moduleView.setPortNames(names("inlets"), names("outlets"));
                    callback();
                } else {
                    new Message(Utilitary.messageResource.errorCreateDSP);
                    Utilitary.hideFullPageLoading();
                }
            } else {
                throw new Error("create DSP Error : null factory");
            }
        } catch (e) {
            this.lastError = Utilitary.messageResource.errorCreateDSP + " : " + e;
            new Message(this.lastError)
            Utilitary.hideFullPageLoading();
        }
    }

    //--- Replace the DSP of the module
    // Used after a code edition (`source`: new name and base code) and when its widget modulations
    // change (same code). The current DSP and interface stay until the new DSP exists; parameter
    // values are kept. The connections whose ports still exist are kept (Scene.updateModuleDSP),
    // the others are removed and reported.
    async replaceDSP(factory: FaustDspFactory, source?: { name: string; code: string }): Promise<boolean> {
        var toDelete: IfDSP = this.moduleFaust.fDSP;
        var previousFactory = this.moduleFaust.factory;
        this.saveInterfaceParams();
        var created = false;
        await this.createDSP(factory, () => { created = true; });
        if (!created) {
            this.moduleFaust.factory = previousFactory;
            return false;
        }
        if (source) {
            this.moduleFaust.fName = source.name;
            this.moduleFaust.fSource = source.code;
        }
        this.deleteFaustInterface();
        this.setFaustInterfaceControles();
        this.createFaustInterface();
        this.recallInterfaceParams();

        // the previous DSP is destroyed after the crossfade with the new one (AudioGraph)
        var removed = Utilitary.currentScene.updateModuleDSP(this, () => this.deleteDSP(toDelete));
        if (removed.length > 0) {
            var dsp = this.moduleFaust.getDSP();
            new Message(Utilitary.messageResource.connectionsRemovedByArity
                .replace("{name}", this.moduleFaust.getName())
                .replace("{inputs}", String(dsp.getNumInputs()))
                .replace("{outputs}", String(dsp.getNumOutputs()))
                .replace("{count}", String(removed.length)));
        }
        return true;
    }

    // Redraws the cables of the module (its size or ports changed).
    private redrawCables(): void {
        if (this.moduleId !== undefined) {
            Utilitary.currentScene.patchView.redrawModule(this.moduleId);
        }
    }

    private deleteDSP(todelete: IfDSP): void {
        if (todelete)
            todelete.destroy();
            // faust.deleteDSPInstance(todelete);
    }
    /******************** EDIT SOURCE & RECOMPILE *************************/
    // The code is edited in faustcode (the pencil, FaustcodeLink, Scene.editModuleCode).

    // Replaces the code of the module (code dropped on it): `code` is a complete module code.
    update(name: string, code: string): Promise<boolean> {
        // compiled with the widget modulations of the module, if any (Scene.compileModuleCode)
        return Utilitary.currentScene.compileModuleCode(this, name, code)
            .then((factory) => factory ? this.replaceDSP(factory, { name, code }) : false)
            .then((done) => { Utilitary.hideFullPageLoading(); return done; });
    }

    /***************** CREATE/DELETE the DSP Interface ********************/

    // Fill fInterfaceContainer with the DSP's Interface (--> see FaustInterface.js)
    setFaustInterfaceControles(): void {

        this.moduleView.fTitle.textContent = this.moduleFaust.fName;
        var moduleFaustInterface = new FaustInterfaceControler(
            (faustInterface) => { this.interfaceSliderCallback(faustInterface) },
            (adress, value) => { this.moduleFaust.fDSP.setParamValue(adress, +value) }
        );
        this.moduleControles = moduleFaustInterface.parseFaustJsonUI(JSON.parse(this.moduleFaust.fDSP.getJSON()).ui, this);
    }

    // Create FaustInterfaceControler, set its callback and add its AccelerometerSlider. The widgets are
    // laid out in the groups of the code, shown as sections (model/UILayout.ts).
    createFaustInterface() {
        var elements = new Map<string, HTMLElement>();
        for (var i = 0; i < this.moduleControles.length; i++) {
            var faustInterfaceControler = this.moduleControles[i];
            faustInterfaceControler.setParams();
            faustInterfaceControler.faustInterfaceView = new FaustInterfaceView(faustInterfaceControler.itemParam.type)
            var element = faustInterfaceControler.createFaustInterfaceElement()!;
            // widgets are drop targets of modulation cables (PatchView), designated by their address
            element.dataset.widget = faustInterfaceControler.itemParam.address;
            element.classList.add("widget");
            if ((faustInterfaceControler.itemParam.meta ?? []).some((m: any) => DEPTH_METADATA in m)) {
                // depth of a widget modulation: shown as a compact control next to the widget
                element.classList.add("modulation-depth");
                if (faustInterfaceControler.faustInterfaceView.label) {
                    faustInterfaceControler.faustInterfaceView.label.textContent = Utilitary.messageResource.modulationDepth;
                }
            }
            elements.set(faustInterfaceControler.itemParam.address, element);
            faustInterfaceControler.interfaceCallback = this.interfaceSliderCallback.bind(this);
            faustInterfaceControler.updateFaustCodeCallback = this.updateCodeFaust.bind(this);
            faustInterfaceControler.setEventListener();
            faustInterfaceControler.createAccelerometer();
        }
        // the sections and the widgets, in the order of the code; a place for each bargraph
        var container = this.moduleView.getInterfaceContainer();
        var bars = new Map<string, HTMLElement>();
        var build = (nodes: LayoutNode[], parent: HTMLElement) => {
            for (var node of nodes) {
                if (node.kind == "group") {
                    var section = document.createElement("div");
                    section.className = "ui-group ui-" + node.type + (node.label ? " ui-section ui-level-" + Math.min(node.level, 3) : "");
                    if (node.label) {
                        var heading = document.createElement("div");
                        heading.className = "ui-group-label";
                        heading.textContent = node.label;
                        if (node.tooltip) heading.title = node.tooltip;
                        section.appendChild(heading);
                    }
                    build(node.children, section);
                    parent.appendChild(section);
                } else if (node.item.type == "hbargraph" || node.item.type == "vbargraph") {
                    var place = document.createElement("div");
                    place.className = "display-place";
                    bars.set(node.item.address!, place);
                    parent.appendChild(place);
                } else {
                    var widget = elements.get(node.item.address!);
                    if (!widget) continue;
                    elements.delete(node.item.address!);
                    if (node.hidden) widget.classList.add("ui-hidden");
                    if (node.tooltip) widget.title = node.tooltip;
                    parent.appendChild(widget);
                }
            }
        };
        build(uiLayout(JSON.parse(this.moduleFaust.getDSP().getJSON()).ui, this.moduleFaust.getName()), container);
        elements.forEach((widget) => container.appendChild(widget));     // none expected
        // bargraphs, oscilloscope or spectrum (Displays.ts)
        this.displays?.dispose();
        // the buttons and checkboxes a modulation may drive: their key (Modulation.depthKey), and the
        // hidden bargraphs that report the value they are driven to ([driven:<key>])
        var ui = JSON.parse(this.moduleFaust.getDSP().getJSON()).ui;
        var widgets = listWidgets(ui);
        var switches = new Map<string, FaustInterfaceControler>();
        for (var c of this.moduleControles) {
            if (c.itemParam.type != "button" && c.itemParam.type != "checkbox") continue;
            try { switches.set(depthKey({ target: widgetTarget(widgets, c.itemParam.address) } as any), c); } catch { /* ambiguous */ }
        }
        var driven = new Map<string, FaustInterfaceControler>();
        for (var w of widgets) {
            var key = w.meta[DRIVEN_METADATA];
            if (key !== undefined && switches.has(key)) driven.set(w.address, switches.get(key)!);
        }
        this.displays = new ModuleDisplays(container, this.moduleFaust.getDSP() as any, Utilitary.audioContext, {
            place: (address) => bars.get(address),
            // a button or a checkbox driven by a modulation: lit while the signal holds it at 1
            output: (address, value) => driven.get(address)?.faustInterfaceView.setLit(value >= 0.5),
            // the values of the interface (those of the DSP of an AudioWorklet node lag behind)
            param: (address) => {
                var controler = this.moduleControles.find((c) => c.itemParam.address == address);
                return controler ? parseFloat(controler.value) : undefined;
            },
            // a widget set by the display (its size): as by the interface, saved and undone
            setParam: (address, value) => {
                var controler = this.moduleControles.find((c) => c.itemParam.address == address);
                if (!controler) return;
                setControlerValue(controler, value, (a, v) => this.moduleFaust.getDSP().setParamValue(a, v));
                Utilitary.currentScene.markModified();
            },
        });
    }

    // Delete all FaustInterfaceControler
    private deleteFaustInterface(): void {
        this.displays?.dispose();
        this.displays = null;
        this.deleteAccelerometerRef();

        while (this.moduleView.fInterfaceContainer.childNodes.length != 0) {
            this.moduleView.fInterfaceContainer.removeChild(this.moduleView.fInterfaceContainer.childNodes[0]);
        }
    }

    // Remove AccelerometerSlider ref from AccelerometerHandler
    private deleteAccelerometerRef() {
        for (var i = 0; i < this.moduleControles.length; i++) {
            if (this.moduleControles[i].accelerometerSlider != null && this.moduleControles[i].accelerometerSlider != undefined) {
                var index = AccelerometerHandler.faustInterfaceControler.indexOf(this.moduleControles[i]);
                AccelerometerHandler.faustInterfaceControler.splice(index, 1);
                delete (this.moduleControles[i] as any).accelerometerSlider;
            }
        }
        this.moduleControles = [];
    }

    // set DSP value to all FaustInterfaceControlers
    setDSPValue() {
        for (var i = 0; i < this.moduleControles.length; i++) {
            this.moduleFaust.fDSP.setParamValue(this.moduleControles[i].itemParam.address, +this.moduleControles[i].value)
        }
    }

    // set DSP value to specific FaustInterfaceControlers
    setDSPValueCallback(address: string, value: string) {
        this.moduleFaust.fDSP.setParamValue(address, +value)
    }

    // Updates Faust Code with new accelerometer metadata
    updateCodeFaust(details: ElementCodeFaustParser) {
        var m = forgeAccMetadata(details.newAccValue, details.isEnabled);
        var s = updateAccInFaustCode(this.moduleFaust.fSource, details.sliderName, m);
        this.moduleFaust.fSource = s;
    }

    //---- Generic callback for Faust Interface
    //---- Called every time an element of the UI changes value
    interfaceSliderCallback(faustControler: FaustInterfaceControler): any {
        var val: string
        if (faustControler.faustInterfaceView.slider) {
            var input: HTMLInputElement = faustControler.faustInterfaceView.slider;
            // linear or logarithmic ([scale:log]) scale: model/SliderScale.ts
            val = valueAt(faustControler.range ?? sliderRange(faustControler.itemParam), parseFloat(input.value)).toFixed(parseFloat(faustControler.precision));
        } else if (faustControler.faustInterfaceView.checkbox) {
            val = faustControler.faustInterfaceView.checkbox.checked ? "1" : "0";
            faustControler.faustInterfaceView.setLit(val == "1");
        } else if (faustControler.faustInterfaceView.button) {
            var input: HTMLInputElement = faustControler.faustInterfaceView.button;
            if (faustControler.value == undefined || faustControler.value == "0") {
                faustControler.value = val = "1"
            } else {
                faustControler.value = val = "0"
            }
            faustControler.faustInterfaceView.setLit(val == "1");      // lit while held down
        }
        var text: string = faustControler.itemParam.address;
        faustControler.value = val!;

        var output: HTMLElement = faustControler.faustInterfaceView.output;

        //---- update the value text
        if (output)
            output.textContent = "" + val! + " " + faustControler.unit;

        // 	Search for DSP then update the value of its parameter.
        this.moduleFaust.fDSP.setParamValue(text, +val!);
        // a slider or a checkbox is a state of the scene (a button, pressed and released, is not)
        if (faustControler.faustInterfaceView.slider || faustControler.faustInterfaceView.checkbox) Utilitary.currentScene?.markModified();
    }
    interfaceButtonCallback(faustControler: FaustInterfaceControler, val?: number): any {

        var text: string = faustControler.itemParam.address;
        faustControler.value = val!.toString();

        var output: HTMLElement = faustControler.faustInterfaceView.output;

        //---- update the value text
        if (output)
            output.textContent = "" + val + " " + faustControler.unit;

        // 	Search for DSP then update the value of its parameter.
        this.moduleFaust.fDSP.setParamValue(text, val!);
    }

    // Save graphical parameters of a Faust Node
    saveInterfaceParams(): void {

        var controls = this.moduleControles;
        for (var j = 0; j < controls.length; j++) {
            var text: string = controls[j].itemParam.address;
            this.fModuleInterfaceParams[text] = controls[j].value;
        }
    }
    recallInterfaceParams(): void {

        for (var key in this.fModuleInterfaceParams)
            this.moduleFaust.fDSP.setParamValue(key, +this.fModuleInterfaceParams[key]);
    }
    getInterfaceParams(): { [label: string]: string } {
        return this.fModuleInterfaceParams;
    }
    setInterfaceParams(parameters: { [label: string]: string }): void {
        this.fModuleInterfaceParams = parameters;
    }
    addInterfaceParam(path: string, value: number): void {
        this.fModuleInterfaceParams[path] = value.toString();
    }
}
