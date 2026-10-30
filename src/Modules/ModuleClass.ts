/*				
    MODULECLASS.JS
    HAND-MADE JAVASCRIPT CLASS CONTAINING A FAUST MODULE AND ITS INTERFACE
*/
import type { FaustDspFactory } from "@grame/faustwasm";

import { ElementCodeFaustParser, FaustInterfaceControler, FaustInterfaceView } from "./FaustInterface";
import { Message } from "../Messages";
import { ModuleFaust } from "./ModuleFaust";
import { ModuleView } from "./ModuleView";
import { CompileFaust, IfDSP, Utilitary } from "../Utilitary";
import { AccelerometerHandler } from "../Accelerometer";
import { faustWasmEnv } from "../Main";
import { forgeAccMetadata, updateAccInFaustCode } from "../CodeFaustParser";
import { MAX_CHANNELS, ModuleId } from "../model/Patch";

interface DSPCallback { (): void; }

export class ModuleClass {
    //id of the module in the patch model (set when the module is added to the scene)
    moduleId: ModuleId;

    moduleView: ModuleView;
    moduleFaust: ModuleFaust;
    moduleControles: FaustInterfaceControler[] = [];

    private deleteCallback: (module: ModuleClass) => void;
    private fModuleInterfaceParams: { [label: string]: string } = {};

    eventOpenEditHandler: () => void;
    eventCloseEditHandler: (event: Event) => void;
    compileFaust: (conpileFaust: CompileFaust) => Promise<void>;

    constructor(id: number, x: number, y: number, name: string, htmlElementModuleContainer: HTMLElement, removeModuleCallBack: (m: ModuleClass) => void, compileFaust: (compileFaust: CompileFaust) => Promise<void>) {
        this.eventCloseEditHandler = (event: Event) => { this.recompileSource(event as MouseEvent, this) }
        this.eventOpenEditHandler = () => { this.edit() }
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
        if (this.moduleView.textArea != undefined) {
            this.moduleView.textArea.addEventListener("touchstart", (e) => { e.stopPropagation() });
            this.moduleView.textArea.addEventListener("touchend", (e) => { e.stopPropagation() });
            this.moduleView.textArea.addEventListener("touchmove", (e) => { e.stopPropagation() });
            this.moduleView.textArea.addEventListener("mousedown", (e) => { e.stopPropagation() });
        }
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
            this.moduleView.fEditImg.addEventListener("click", this.eventOpenEditHandler);
            this.moduleView.fEditImg.addEventListener("touchend", this.eventOpenEditHandler);
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
        try {
            if (factory != null) {
                const { inputs, outputs } = JSON.parse(factory.json);
                if (inputs > MAX_CHANNELS || outputs > MAX_CHANNELS) {
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
                    callback();
                } else {
                    new Message(Utilitary.messageResource.errorCreateDSP);
                    Utilitary.hideFullPageLoading();
                }
            } else {
                throw new Error("create DSP Error : null factory");
            }
        } catch (e) {
            new Message(Utilitary.messageResource.errorCreateDSP + " : " + e)
            Utilitary.hideFullPageLoading();
        }
    }

    //--- Update DSP in module
    // The connections whose ports still exist are kept (Scene.updateModuleDSP); the others are
    // removed and reported.
    private updateDSP(factory: FaustDspFactory, module: ModuleClass): void {

        var toDelete: IfDSP = module.moduleFaust.fDSP;

        module.deleteFaustInterface();

        module.createDSP(factory, function () {
            module.moduleFaust.fName = module.moduleFaust.fTempName;
            module.moduleFaust.fSource = module.moduleFaust.fTempSource
            module.setFaustInterfaceControles()
            module.createFaustInterface();

            var removed = Utilitary.currentScene.updateModuleDSP(module);
            module.deleteDSP(toDelete);
            if (removed.length > 0) {
                var dsp = module.moduleFaust.getDSP();
                new Message(Utilitary.messageResource.connectionsRemovedByArity
                    .replace("{name}", module.moduleFaust.getName())
                    .replace("{inputs}", String(dsp.getNumInputs()))
                    .replace("{outputs}", String(dsp.getNumOutputs()))
                    .replace("{count}", String(removed.length)));
            }
            Utilitary.hideFullPageLoading();
        });
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
    edit(): void {

        this.saveInterfaceParams();

        var event: CustomEvent = new CustomEvent("codeeditevent")
        document.dispatchEvent(event);

        this.deleteFaustInterface();

        this.moduleView.textArea.style.display = "block";
        this.moduleView.textArea.value = this.moduleFaust.fSource;
        this.redrawCables();
        this.moduleView.fEditImg.style.backgroundImage = "url(" + Utilitary.baseImg + "enter.png)";
        this.moduleView.fEditImg.addEventListener("click", this.eventCloseEditHandler);
        this.moduleView.fEditImg.addEventListener("touchend", this.eventCloseEditHandler);
        this.moduleView.fEditImg.removeEventListener("click", this.eventOpenEditHandler);
        this.moduleView.fEditImg.removeEventListener("touchend", this.eventOpenEditHandler);
    }

    //---- Update ModuleClass with new name/code source
    update(name: string, code: string): void {

        var event: CustomEvent = new CustomEvent("codeeditevent")
        document.dispatchEvent(event);
        this.moduleFaust.fTempName = name;
        this.moduleFaust.fTempSource = code;
        var module: ModuleClass = this;
        this.compileFaust({ name: name, sourceCode: code, x: this.moduleView.x, y: this.moduleView.y, callback: (factory) => { module.updateDSP(factory, module) } });
    }

    //---- React to recompilation triggered by click on icon
    private recompileSource(event: MouseEvent, module: ModuleClass): void {
        Utilitary.showFullPageLoading();
        var dsp_code: string = this.moduleView.textArea.value;
        this.moduleView.textArea.style.display = "none";
        this.redrawCables();
        module.update(this.moduleView.fTitle.textContent!, dsp_code);
        module.recallInterfaceParams();

        module.moduleView.fEditImg.style.backgroundImage = "url(" + Utilitary.baseImg + "edit.png)";
        module.moduleView.fEditImg.addEventListener("click", this.eventOpenEditHandler);
        module.moduleView.fEditImg.addEventListener("touchend", this.eventOpenEditHandler);
        module.moduleView.fEditImg.removeEventListener("click", this.eventCloseEditHandler);
        module.moduleView.fEditImg.removeEventListener("touchend", this.eventCloseEditHandler);
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

    // Create FaustInterfaceControler, set its callback and add its AccelerometerSlider
    createFaustInterface() {
        for (var i = 0; i < this.moduleControles.length; i++) {
            var faustInterfaceControler = this.moduleControles[i];
            faustInterfaceControler.setParams();
            faustInterfaceControler.faustInterfaceView = new FaustInterfaceView(faustInterfaceControler.itemParam.type)
            this.moduleView.getInterfaceContainer().appendChild(faustInterfaceControler.createFaustInterfaceElement()!);
            faustInterfaceControler.interfaceCallback = this.interfaceSliderCallback.bind(this);
            faustInterfaceControler.updateFaustCodeCallback = this.updateCodeFaust.bind(this);
            faustInterfaceControler.setEventListener();
            faustInterfaceControler.createAccelerometer();
        }
    }

    // Delete all FaustInterfaceControler
    private deleteFaustInterface(): void {
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
            val = Number((parseFloat(input.value) * parseFloat(faustControler.itemParam.step)) + parseFloat(faustControler.itemParam.min)).toFixed(parseFloat(faustControler.precision));
        } else if (faustControler.faustInterfaceView.button) {
            var input: HTMLInputElement = faustControler.faustInterfaceView.button;
            if (faustControler.value == undefined || faustControler.value == "0") {
                faustControler.value = val = "1"
            } else {
                faustControler.value = val = "0"
            }
        }
        var text: string = faustControler.itemParam.address;
        faustControler.value = val!;

        var output: HTMLElement = faustControler.faustInterfaceView.output;

        //---- update the value text
        if (output)
            output.textContent = "" + val! + " " + faustControler.unit;

        // 	Search for DSP then update the value of its parameter.
        this.moduleFaust.fDSP.setParamValue(text, +val!);
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
    private saveInterfaceParams(): void {

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
