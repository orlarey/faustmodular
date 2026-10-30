/*				SCENECLASS.JS
    HAND-MADE JAVASCRIPT CLASS CONTAINING THE API OF A GENERIC SCENE

    The scene owns the patch model (model/Patch.ts), its Web Audio rendering
    (audio/AudioGraph.ts) and its graphical view (view/PatchView.ts: ports, cables and
    pointer interactions). ModuleClass objects are the views/controllers of the modules;
    each one is bound to a module of the patch by its moduleId.
*/

import type { FaustDspFactory } from "@grame/faustwasm";

import { AccelerometerHandler, Axis } from "../Accelerometer";
import { AudioGraph } from "../audio/AudioGraph";
import { faustWasmEnv } from "../Main";
import { Message } from "../Messages";
import { listWidgets, ModulationError, ModulationMode, ModulationSpec, modulatedCode, modulationSpec, WidgetDescription } from "../model/Modulation";
import { AccMapping, Connection, MAX_CHANNELS, ModuleId, Patch, PortRef, PrecompiledFactory, totalInputs } from "../model/Patch";
import { encodeFactoryCode, isPatchFileV2, parsePatchV2, serializePatch } from "../model/PatchFormat";
import { connectV1Links, isPatchFileV1, matchParamPath, readV1 } from "../model/PatchFormatV1";
import { ModuleClass } from "../Modules/ModuleClass";
import { CompileFaust, PositionModule, Utilitary } from "../Utilitary";
import { PatchView } from "../view/PatchView";
import { SceneView } from "./SceneView";

export const INPUT_ID: ModuleId = "input";
export const OUTPUT_ID: ModuleId = "output";

// What is needed to recreate a module from a patch file (v1 or v2).
interface ModuleDescription {
    id: ModuleId;
    name: string;
    code: string;
    x: number;
    y: number;
    params: Record<string, number>;
    acc: AccMapping[];
    factory?: PrecompiledFactory;           // compiled from the effective code
    numInputs?: number;                     // audio inputs, needed with modulations
    modulations?: Array<{ widget: string; spec: ModulationSpec }>;
}

export class Scene {
    isMute: boolean = false;
    //-- Patch model and its audio rendering
    patch: Patch = new Patch();
    audioGraph: AudioGraph;
    patchView: PatchView;
    //-- Audio Input/Output
    fAudioOutput: ModuleClass;
    fAudioInput: ModuleClass;
    //-- Modules contained in the scene
    private fModuleList: ModuleClass[] = [];
    //-- Graphical Scene container
    sceneView: SceneView;
    sceneName: string = "Patch";
    //used to keep loading page when loading the two input and output default modules
    isInitLoading: boolean = true;
    isOutputTouch: boolean = false;

    //callback function to compile faust code from App
    compileFaust: (compile: CompileFaust) => Promise<void>

    constructor(identifiant: string, compileFaust: (compileFaust: CompileFaust) => Promise<void>, sceneView?: SceneView) {
        this.compileFaust = compileFaust;
        this.sceneView = new SceneView();
        this.sceneView.initNormalScene(this)
        this.integrateSceneInBody();
        this.audioGraph = new AudioGraph(Utilitary.audioContext, this.patch);
        var svgCanvas = this.sceneView.fSceneContainer.querySelector("#svgCanvas") as SVGSVGElement;
        this.patchView = new PatchView(this.patch, svgCanvas, (id) => this.getModuleById(id));
        this.integrateOutput();
        this.integrateInput();
        Utilitary.hideFullPageLoading();
        this.isInitLoading = false;
        // a modulation whose last cable is removed is removed with it (once the change is complete)
        this.patch.subscribe((event) => {
            if (event.type == "connectionRemoved" && this.patch.getModule(event.connection.to.module)) {
                var modulation = this.patch.modulationAt(event.connection.to.module, event.connection.to.port);
                if (modulation) {
                    var id = event.connection.to.module;
                    queueMicrotask(() => this.pruneModulation(id, modulation!.id));
                }
            }
        });
    }

    getSceneContainer(): HTMLDivElement { return this.sceneView.fSceneContainer; }

    /*********************** MUTE/UNMUTE SCENE ***************************/
    muteScene(): void {
        Utilitary.audioContext.suspend();
        this.isMute = true;
        this.getAudioOutput().moduleView.fInterfaceContainer.style.backgroundImage = "url(img/ico-speaker-mute.png)"
    }
    unmuteScene(): void {
        console.log("timeIn");
        window.setTimeout(() => { this.delayedUnmuteScene() }, 500)
    }

    delayedUnmuteScene() {//because of probable Firefox bug with audioContext.resume() when resume to close from suspend
        console.log("timeout")
        Utilitary.audioContext.resume();
        this.isMute = false;
        this.getAudioOutput().moduleView.fInterfaceContainer.style.backgroundImage = "url(img/ico-speaker.png)"
    }

    //add listner on the output module to give the user the possibility to mute/onmute the scene
    addMuteOutputListner(moduleOutput: ModuleClass) {
        moduleOutput.moduleView.fModuleContainer.ontouchstart = () => { this.dbleTouchOutput() }
        moduleOutput.moduleView.fModuleContainer.ondblclick = () => { this.dispatchEventMuteUnmute() }
    }

    //custom doubl touch event to mute
    dbleTouchOutput() {
        if (!this.isOutputTouch) {
            this.isOutputTouch = true;
            window.setTimeout(() => { this.isOutputTouch = false }, 300)
        } else {
            this.dispatchEventMuteUnmute();
            this.isOutputTouch = false;
        }
    }
    dispatchEventMuteUnmute() {
        if (!this.isMute) {
            this.muteScene()
        } else {
            this.unmuteScene()
        }
    }

    /******************** HANDLE MODULES IN SCENE ************************/
    // Faust modules only (the physical input and output modules are not in this list).
    getModules(): ModuleClass[] { return this.fModuleList; }

    // Registers a module whose DSP is created: adds it to the patch, the audio graph and the view.
    // `modulations`: those of the effective code the DSP was compiled from (recalled modules).
    addModule(module: ModuleClass, modulations: Array<{ widget: string; spec: ModulationSpec }> = []): void {
        var dsp = module.moduleFaust.getDSP();
        var state = this.patch.addModule({
            kind: "faust",
            name: module.moduleFaust.getName(),
            code: module.moduleFaust.getSource(),
            x: module.moduleView.x,
            y: module.moduleView.y,
            numInputs: dsp.getNumInputs() - modulations.length,
            numOutputs: dsp.getNumOutputs(),
            modulations,
        });
        module.moduleId = state.id;
        this.audioGraph.setNode(state.id, dsp);
        this.fModuleList.push(module);
        this.patchView.addModule(module);
    }

    removeModule(module: ModuleClass): void {
        var index = this.fModuleList.indexOf(module);
        if (index >= 0) {
            this.fModuleList.splice(index, 1);
        }
        if (module.moduleId !== undefined && this.patch.getModule(module.moduleId)) {
            this.patch.removeModule(module.moduleId);
        }
    }

    // Called once a module has a new DSP (recompilation). Returns the connections removed
    // because their ports no longer exist.
    updateModuleDSP(module: ModuleClass): Connection[] {
        var dsp = module.moduleFaust.getDSP();
        // the DSP is compiled from the effective code: its first inputs are the audio inputs
        var modulations = this.patch.getModule(module.moduleId)!.modulations.length;
        var removed = this.patch.setArity(module.moduleId, dsp.getNumInputs() - modulations, dsp.getNumOutputs());
        this.patch.updateModule(module.moduleId, { name: module.moduleFaust.getName(), code: module.moduleFaust.getSource() });
        this.audioGraph.setNode(module.moduleId, dsp);
        return removed;
    }

    // Module (Faust or physical input/output) bound to a module of the patch.
    getModuleById(id: ModuleId): ModuleClass | undefined {
        if (id == INPUT_ID) return this.fAudioInput;
        if (id == OUTPUT_ID) return this.fAudioOutput;
        return this.fModuleList.find((m) => m.moduleId == id);
    }

    /*******************************  PUBLIC METHODS  **********************************/

    integrateSceneInBody(): void {
        document.body.appendChild(this.sceneView.fSceneContainer);
    }

    /*************** ACTIONS ON AUDIO IN/OUTPUT ***************************/
    // The physical output has as many inputs as the audio device has channels.
    integrateOutput() {
        var positionOutput: PositionModule = this.positionOutputModule();
        this.fAudioOutput = new ModuleClass(Utilitary.idX++, positionOutput.x, positionOutput.y, "output", this.sceneView.inputOutputModuleContainer, (module) => { this.removeModule(module) }, this.compileFaust);
        var destination = Utilitary.audioContext.destination;
        var channels = Math.min(Math.max(destination.maxChannelCount || 2, 1), MAX_CHANNELS);
        this.patch.addModule({ id: OUTPUT_ID, kind: "output", name: "output", numInputs: channels, numOutputs: 0 });
        this.fAudioOutput.moduleId = OUTPUT_ID;
        this.audioGraph.setNode(OUTPUT_ID, destination);
        this.addMuteOutputListner(this.fAudioOutput);
        this.patchView.addModule(this.fAudioOutput);
    }

    // The physical input is stereo until the microphone is granted; it then gets the number of
    // channels of the audio track (connections to missing channels are then removed).
    integrateInput() {
        var positionInput: PositionModule = this.positionInputModule();
        this.fAudioInput = new ModuleClass(Utilitary.idX++, positionInput.x, positionInput.y, "input", this.sceneView.inputOutputModuleContainer, (module) => { this.removeModule(module) }, this.compileFaust);
        this.patch.addModule({ id: INPUT_ID, kind: "input", name: "input", numInputs: 0, numOutputs: 2 });
        this.fAudioInput.moduleId = INPUT_ID;
        this.patchView.addModule(this.fAudioInput);
        this.activateAudioInput();
    }

    getAudioOutput(): ModuleClass { return this.fAudioOutput; }
    getAudioInput(): ModuleClass { return this.fAudioInput; }

    /********************************************************************
**********************  ACTIVATE PHYSICAL IN/OUTPUT *****************
********************************************************************/

    activateAudioInput(): void {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } as any })
            // 'as any' is needed here because of a typo in lib.d.ts (echoCancellation is written echoCancelation)
            .then(
                (mediaStream) => {
                    this.getDevice(mediaStream);
                    console.log("audio track has settings:", mediaStream.getAudioTracks()[0].getSettings());
                }
            ).catch(
                (err) => {
                    console.error(err);
                    this.fAudioInput.moduleView.fInterfaceContainer.style.backgroundImage = "url(img/ico-micro-mute.png)"
                    this.fAudioInput.moduleView.fInterfaceContainer.title = Utilitary.messageResource.errorGettingAudioInput;
                    new Message(Utilitary.messageResource.errorGettingAudioInput);
                }
            );
    }

    private getDevice(device: MediaStream): void {
        // The logo container historically moved to the body here; kept for an identical layout.
        var logo = document.getElementById("input");
        if (logo) document.body.appendChild(logo);

        var source = Utilitary.audioContext.createMediaStreamSource(device);
        var settings = device.getAudioTracks()[0]?.getSettings();
        var channels = Math.min(Math.max(settings?.channelCount || 2, 1), MAX_CHANNELS);
        var removed = this.patch.setArity(INPUT_ID, 0, channels);
        this.audioGraph.setNode(INPUT_ID, source);
        if (removed.length > 0) {
            new Message(Utilitary.messageResource.connectionsRemovedByArity
                .replace("{name}", "input").replace("{inputs}", "0").replace("{outputs}", String(channels)).replace("{count}", String(removed.length)));
        }
    }

    /*********************** SAVE/RECALL SCENE ***************************/

    // Copies into the patch model what lives in the modules: position, name, code, parameter
    // values, accelerometer mappings and (if isPrecompiled) the compiled factory.
    updatePatchFromModules(isPrecompiled: boolean): void {
        for (var module of this.fModuleList) {
            var dsp = module.moduleFaust.getDSP();
            var params: Record<string, number> = {};
            for (var path of dsp.getParams() ?? []) {
                params[path] = dsp.getParamValue(path);
            }
            var acc: AccMapping[] = module.moduleControles.map((controler) => {
                var slider = controler.accelerometerSlider;
                return { address: slider.address, axis: slider.axis, curve: slider.curve, amin: slider.amin, amid: slider.amid, amax: slider.amax, enabled: slider.isEnabled };
            });
            // exact coordinates (style.left/top are read back rounded to 3 decimals)
            this.patch.updateModule(module.moduleId, {
                name: module.moduleFaust.getName(),
                code: module.moduleFaust.getSource(),
                x: module.moduleView.x,
                y: module.moduleView.y,
                params,
                acc,
                factory: isPrecompiled ? this.exportFactory(module.moduleFaust.factory) : undefined,
            });
        }
    }

    private exportFactory(factory: FaustDspFactory): PrecompiledFactory {
        const { code, json, poly, shaKey } = factory;
        return { code: encodeFactoryCode(code), json: JSON.parse(json), poly, shaKey };
    }

    // Saves the scene as a version 2 patch file (JSON string).
    // isPrecompiled is used to save or not the compiled wasm code
    saveScene(isPrecompiled: boolean): string {
        this.updatePatchFromModules(isPrecompiled);
        return JSON.stringify(serializePatch(this.patch, this.sceneName, isPrecompiled));
    }

    // Adds the content of a patch file (version 1 or 2) to the scene.
    async recallScene(json: string | null): Promise<void> {
        if (json == null) {
            Utilitary.hideFullPageLoading();
            new Message(Utilitary.messageResource.errorLoading);
            return;
        }
        var warnings: string[] = [];
        try {
            var data: unknown = JSON.parse(json);
            if (isPatchFileV2(data)) {
                warnings = await this.recallV2(data);
            } else if (isPatchFileV1(data)) {
                warnings = await this.recallV1(data);
            } else {
                throw new Error("unknown patch format");
            }
        } catch (e) {
            console.error(e);
            new Message(Utilitary.messageResource.errorJsonCorrupted + " : " + e);
        }
        if (warnings.length > 0) {
            warnings.forEach((w) => console.warn(w));
            new Message(warnings.join("\n"));
        }
        document.dispatchEvent(new CustomEvent("updatename"));
        Utilitary.hideFullPageLoading();
    }

    private async recallV2(data: unknown): Promise<string[]> {
        var { patch: file, sceneName } = parsePatchV2(data);
        this.sceneName = sceneName;
        var warnings: string[] = [];
        var ids = await this.recallModules(file.getModules().filter((m) => m.kind == "faust"), warnings);
        for (var c of file.getConnections()) {
            var from = ids.get(c.from.module);
            var to = ids.get(c.to.module);
            if (from === undefined || to === undefined) {
                warnings.push(`connection ${c.from.module}:${c.from.port} -> ${c.to.module}:${c.to.port}: unknown module, connection dropped`);
                continue;
            }
            try {
                this.patch.connect({ module: from, port: c.from.port }, { module: to, port: c.to.port });
            } catch (e) {
                warnings.push(`connection ${c.from.module}:${c.from.port} -> ${c.to.module}:${c.to.port}: ${(e as Error).message}, connection dropped`);
            }
        }
        return warnings;
    }

    private async recallV1(data: unknown): Promise<string[]> {
        var draft = readV1(data);
        if (draft.sceneName) {
            this.sceneName = draft.sceneName;
        }
        var warnings = [...draft.warnings];
        var ids = await this.recallModules(draft.modules, warnings);
        warnings.push(...connectV1Links(this.patch, draft.links, (id) => ids.get(id)));
        return warnings;
    }

    // Creates the modules (in sequence) and returns the map: id in the file -> id in the patch.
    private async recallModules(descriptions: ModuleDescription[], warnings: string[]): Promise<Map<ModuleId, ModuleId>> {
        var ids = new Map<ModuleId, ModuleId>([[INPUT_ID, INPUT_ID], [OUTPUT_ID, OUTPUT_ID]]);
        for (var description of descriptions) {
            var module = await this.createModule(description);
            if (module) {
                ids.set(description.id, module.moduleId);
            } else {
                warnings.push(`module ${description.id} (${description.name}) could not be created`);
            }
        }
        return ids;
    }

    private async importFactory(factory: PrecompiledFactory): Promise<FaustDspFactory | null> {
        const { code, json, poly, shaKey } = factory;
        const [factories] = await faustWasmEnv.faustwasm.FaustCompiler.importDSPFactories(JSON.stringify({ [shaKey]: { code, json, poly } }));
        return factories.get(shaKey) ?? null;
    }

    private async compile(name: string, code: string, x: number, y: number, mute: boolean = true): Promise<FaustDspFactory | null> {
        var result: FaustDspFactory | null = null;
        await this.compileFaust({ name, sourceCode: code, x, y, mute, callback: (factory) => { result = factory } });
        return result;
    }

    /*********************** WIDGET MODULATIONS ***************************/
    // See model/Modulation.ts and Documentation/widget-modulation/PLAN.md.

    private fRecompilations = new Map<ModuleId, Promise<boolean>>();

    // Widgets of the current DSP of a module.
    widgetsOf(module: ModuleClass): WidgetDescription[] {
        return listWidgets(JSON.parse(module.moduleFaust.getDSP().getJSON()).ui);
    }

    // Connects an output to a widget of a module. The first cable creates the modulation (the module
    // is recompiled with it); the next ones are added to it (one modulation, and type, per widget).
    async modulate(from: PortRef, moduleId: ModuleId, widget: string, mode: ModulationMode): Promise<boolean> {
        var module = this.getModuleById(moduleId);
        var state = this.patch.getModule(moduleId);
        if (!module || !state) return false;
        var existing = state.modulations.find((m) => m.widget == widget);
        if (existing) {
            var to = { module: moduleId, port: this.patch.modulationPort(moduleId, existing.id) };
            if (!this.patch.findConnection(from, to)) this.patch.connect(from, to);
            return true;
        }
        var spec: ModulationSpec;
        try {
            var widgets = this.widgetsOf(module);
            var description = widgets.find((w) => w.address == widget);
            if (!description) throw new ModulationError(`no widget ${widget}`);
            spec = modulationSpec(description, widgets, mode);
        } catch (e) {
            new Message(Utilitary.messageResource.modulationFailed.replace("{reason}", (e as Error).message));
            return false;
        }
        var modulation = this.patch.addModulation(moduleId, widget, spec);
        this.patch.connect(from, { module: moduleId, port: this.patch.modulationPort(moduleId, modulation.id) });
        var done = await this.recompileModulations(module);
        if (!done && this.patch.getModule(moduleId)?.modulations.some((m) => m.id == modulation.id)) {
            this.patch.removeModulation(moduleId, modulation.id);
        }
        return done;
    }

    // Recompiles a module from its base code and its current modulations, after the pending
    // recompilations of the same module. The scene keeps playing meanwhile.
    recompileModulations(module: ModuleClass): Promise<boolean> {
        var id = module.moduleId;
        var task = async (): Promise<boolean> => {
            var state = this.patch.getModule(id);
            if (!state) return false;
            var code = modulatedCode(module.moduleFaust.getSource(), state.numInputs, state.modulations.map((m) => m.spec));
            var container = module.moduleView.getModuleContainer();
            container.classList.add("compiling");
            var factory = await this.compile(state.name, code, state.x, state.y, false);
            container.classList.remove("compiling");
            if (!factory || !this.patch.getModule(id)) return false;
            var inputs = JSON.parse(factory.json).inputs;
            if (inputs != totalInputs(state)) {
                new Message(Utilitary.messageResource.modulationFailed.replace("{reason}", `${inputs} inputs instead of ${totalInputs(state)}`));
                return false;
            }
            return module.replaceDSP(factory);
        };
        var next = (this.fRecompilations.get(id) ?? Promise.resolve(true)).then(task, task);
        this.fRecompilations.set(id, next);
        return next;
    }

    // Removes a modulation that has no cable any more, and recompiles its module.
    private pruneModulation(moduleId: ModuleId, modulationId: string): void {
        var state = this.patch.getModule(moduleId);
        if (!state || !state.modulations.some((m) => m.id == modulationId)) return;
        var port = this.patch.modulationPort(moduleId, modulationId);
        if (this.patch.connectionsTo(moduleId).some((c) => c.to.port == port)) return;
        this.patch.removeModulation(moduleId, modulationId);
        var module = this.getModuleById(moduleId);
        if (module) this.recompileModulations(module);
    }

    // Compiles the new code of an edited module with its modulations: the modulations of widgets that
    // no longer exist are removed (and reported), the others follow the new code.
    async compileModuleCode(module: ModuleClass, name: string, code: string): Promise<FaustDspFactory | null> {
        var state = module.moduleId !== undefined ? this.patch.getModule(module.moduleId) : undefined;
        var base = await this.compile(name, code, module.moduleView.x, module.moduleView.y);
        if (!base || !state || state.modulations.length == 0) return base;
        var json = JSON.parse(base.json);
        var widgets = listWidgets(json.ui);
        var dropped: string[] = [];
        for (var modulation of state.modulations.slice()) {
            var widget = widgets.find((w) => w.address == modulation.widget);
            try {
                if (!widget) throw new ModulationError(`no widget ${modulation.widget}`);
                this.patch.setModulationSpec(state.id, modulation.id, modulationSpec(widget, widgets, modulation.spec.mode));
            } catch (e) {
                dropped.push(widget ? widget.label : modulation.widget);
                this.patch.removeModulation(state.id, modulation.id);
            }
        }
        if (dropped.length > 0) {
            new Message(Utilitary.messageResource.modulationsRemoved.replace("{widgets}", dropped.join(", ")));
        }
        if (state.modulations.length == 0) return base;
        var factory = await this.compile(name, modulatedCode(code, json.inputs, state.modulations.map((m) => m.spec)), module.moduleView.x, module.moduleView.y);
        if (factory && JSON.parse(factory.json).inputs != json.inputs + state.modulations.length) {
            new Message(Utilitary.messageResource.modulationFailed.replace("{reason}", "unexpected number of inputs"));
            return null;
        }
        return factory;
    }

    // Creates a module from its description: precompiled factory if any, otherwise compilation.
    private async createModule(description: ModuleDescription): Promise<ModuleClass | null> {
        var factory: FaustDspFactory | null = null;
        try {
            factory = description.factory ? await this.importFactory(description.factory) : null;
        } catch (e) {
            console.warn(`module ${description.id}: precompiled factory unusable, recompiling`, e);
        }
        var modulations = description.modulations ?? [];
        if (!factory) {
            var code = modulations.length > 0
                ? modulatedCode(description.code, description.numInputs ?? 0, modulations.map((m) => m.spec))
                : description.code;
            factory = await this.compile(description.name, code, description.x, description.y);
        }
        if (!factory) {
            return null;
        }
        var module: ModuleClass = new ModuleClass(Utilitary.idX++, description.x, description.y, description.name, document.getElementById("modules")!, (module) => { this.removeModule(module) }, this.compileFaust);
        module.moduleFaust.setSource(description.code);
        var created = false;
        await module.createDSP(factory, () => { created = true });
        if (!created) {
            module.deleteModule();
            return null;
        }
        var known: string[] = module.moduleFaust.getDSP().getParams() ?? [];
        for (var path in description.params) {
            var current = matchParamPath(path, known);
            if (current !== undefined) {
                module.addInterfaceParam(current, description.params[path]);
            } else {
                console.warn(`module ${description.id} (${description.name}): unknown parameter ${path} ignored`);
            }
        }
        module.recallInterfaceParams();
        module.setFaustInterfaceControles();
        module.createFaustInterface();
        this.addModule(module, modulations.map((m) => ({ widget: m.widget, spec: m.spec })));
        this.recallAccValues(description.acc, module);
        return module;
    }

    //recall of the accelerometer mapping parameters for each FaustInterfaceControler of the Module
    recallAccValues(mappings: AccMapping[], module: ModuleClass) {
        for (var controle of mappings) {
            for (var moduleControle of module.moduleControles) {
                if (moduleControle.itemParam.address == controle.address) {
                    var group = moduleControle.faustInterfaceView.group;
                    var slider = moduleControle.faustInterfaceView.slider;
                    var acc = moduleControle.accelerometerSlider;
                    moduleControle.accelerometerSlider.acc = controle.axis + " " + controle.curve + " " + controle.amin + " " + controle.amid + " " + controle.amax;
                    moduleControle.acc = controle.axis + " " + controle.curve + " " + controle.amin + " " + controle.amid + " " + controle.amax;
                    acc.amax = controle.amax;
                    acc.amid = controle.amid;
                    acc.amin = controle.amin;
                    acc.axis = controle.axis;
                    acc.curve = controle.curve;
                    acc.isEnabled = controle.enabled;
                    AccelerometerHandler.curveSplitter(acc);

                    group.className = "control-group";
                    group.classList.add(Axis[controle.axis]);
                    if (!controle.enabled) {
                        group.classList.add("disabledAcc");
                        slider.classList.add("allowed");
                        slider.classList.remove("not-allowed");
                        slider.disabled = false;
                    } else {
                        if (acc.isActive) {
                            slider.classList.add("not-allowed");
                            slider.classList.remove("allowed");
                            slider.disabled = true;
                        } else {
                            slider.classList.add("allowed");
                            slider.classList.remove("not-allowed");
                            slider.disabled = false;
                        }
                    }
                }
            }
        }
    }

    //use to replace all éèàù ' from string and replace it with eeau__
    static cleanName(newName: string): string {
        newName = Utilitary.replaceAll(newName, "é", "e");
        newName = Utilitary.replaceAll(newName, "è", "e");
        newName = Utilitary.replaceAll(newName, "à", "a");
        newName = Utilitary.replaceAll(newName, "ù", "u");
        newName = Utilitary.replaceAll(newName, " ", "_");
        newName = Utilitary.replaceAll(newName, "'", "_");
        return newName;
    }
    //check if string start only with letter (no accent)
    //and contains only letter (no accent) underscore and number for a lenght between 1 and 50 char
    static isNameValid(newName: string): boolean {
        var pattern: RegExp = new RegExp("^[a-zA-Z_][a-zA-Z_0-9]{1,50}$");
        if (pattern.test(newName)) {
            return true
        } else {
            return false
        }
    }

    //rename scene if format is correct and return true otherwise return false
    static rename(input: HTMLInputElement, spanRule: HTMLSpanElement, spanDynamic: HTMLSpanElement): boolean {
        var newName = input.value;
        newName = Scene.cleanName(newName);
        if (Scene.isNameValid(newName)) {
            Utilitary.currentScene.sceneName = newName;
            spanDynamic.textContent = Utilitary.currentScene.sceneName;
            spanRule.style.opacity = "0.6";
            input.style.boxShadow = "0 0 0 green inset";
            input.style.border = "none";
            input.value = Utilitary.currentScene.sceneName;
            var event: CustomEvent = new CustomEvent("updatename")
            document.dispatchEvent(event);
            return true;
        } else {
            spanRule.style.opacity = "1";
            input.style.boxShadow = "0 0 6px yellow inset";
            input.style.border = "3px solid red";
            new Message(Utilitary.messageResource.invalidSceneName);
            return false;
        }
    }

    /***************** SET POSITION OF INPUT OUTPUT MODULE ***************/
    positionInputModule(): PositionModule {
        var position: PositionModule = new PositionModule();
        position.x = 10;
        position.y = window.innerHeight / 2;
        return position
    }
    positionOutputModule(): PositionModule {
        var position: PositionModule = new PositionModule();
        position.x = window.innerWidth - 98;
        position.y = window.innerHeight / 2;
        return position
    }
    positionDblTapModule(): PositionModule {
        var position: PositionModule = new PositionModule();
        position.x = window.innerWidth / 2;
        position.y = window.innerHeight / 2;
        return position
    }
}
