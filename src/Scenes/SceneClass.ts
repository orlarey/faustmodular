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
import { Confirm, Message } from "../Messages";
import { allowedModes, defaultDepthAt, depthWidget, hasDepth, isDepthAddress, isModulable, listWidgets, ModulationError, ModulationMode, ModulationSpec, modulatedCode, modulationSpec, WidgetDescription } from "../model/Modulation";
import { AccMapping, Connection, MAX_CHANNELS, ModuleId, Patch, PortRef, PrecompiledFactory, totalInputs } from "../model/Patch";
import { encodeFactoryCode, isPatchFileV2, ModuleFileV2, PATCH_FORMAT, PATCH_VERSION, PATCH_VERSION_MODULATIONS, PatchFileV2, parsePatchV2, serializePatch } from "../model/PatchFormat";
import { connectV1Links, isPatchFileV1, matchParamPath, readV1 } from "../model/PatchFormatV1";
import { ModuleClass } from "../Modules/ModuleClass";
import { setControlerValue } from "../Modules/FaustInterface";
import { CompileFaust, PositionModule, Utilitary } from "../Utilitary";
import { PatchView } from "../view/PatchView";
import { FaustcodeLink, faustcodeUrl } from "../FaustcodeLink";
import { rewrapModuleCode, unwrapModuleCode, userCode, userError } from "../model/ModuleCode";
import { History } from "./History";
import { storedCode } from "../documents/DocumentFormat";
import { SceneView } from "./SceneView";

export const INPUT_ID: ModuleId = "input";
export const OUTPUT_ID: ModuleId = "output";

// What is needed to recreate a module from a patch file (v1 or v2).
// A state of the scene for undo and redo (History): what the user can change.
interface SceneSnapshot {
    modules: Array<{
        id: ModuleId; name: string; code: string; x: number; y: number; numInputs: number;
        params: Record<string, number>;
        modulations: Array<{ widget: string; spec: ModulationSpec }>;
    }>;
    io: Array<{ id: ModuleId; x: number; y: number }>;        // physical input and output modules
    connections: string[];                                      // "from:port>to:port", sorted
}

// The documents of the scene (documents/Documents.ts), once the storage is open.
export interface SceneDocuments {
    readonly dirty: boolean;
    changed(): void;                                // a new state of the scene (history)
    importPatch(json: string): Promise<boolean>;    // a patch file opened: a new document
    flush(): Promise<void>;                         // pending saves written
    codeEdited(previous: string, code: string, name: string): void;   // stored codes (DocumentFormat.storedCode)
    updateInstance(id: string): Promise<string | null>;
    moduleCode(id: string): Promise<{ name: string; code: string } | null>;
}

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
    history: History;
    faustcodeLink: FaustcodeLink<ModuleClass>;
    //-- Audio Input/Output
    fAudioOutput: ModuleClass;
    fAudioInput: ModuleClass;
    //-- Modules contained in the scene
    private fModuleList: ModuleClass[] = [];
    // Changes since the scene was opened or saved: opening another patch asks before losing them.
    private fModified = false;
    private fRecalling = 0;
    //-- Graphical Scene container
    sceneView: SceneView;
    sceneName: string = "Patch";
    // Set by the documents once the storage is open: the scene is then the open document.
    documents: SceneDocuments | null = null;
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
        this.patch.subscribe(() => this.markModified());     // modules, connections, positions, code, modulations
        var svgCanvas = this.sceneView.fSceneContainer.querySelector("#svgCanvas") as SVGSVGElement;
        this.faustcodeLink = new FaustcodeLink<ModuleClass>(faustcodeUrl(), {
            isAlive: (module) => this.fModuleList.includes(module),
            nameOf: (module) => module.moduleFaust.getName(),
            codeOf: (module) => userCode(module.moduleFaust.getSource()),
            apply: (module, code) => this.editModuleCode(module, code),
            notify: (message) => { new Message(message) },
            libfaust: () => faustWasmEnv.faustCompiler.version(),
        });
        this.patchView = new PatchView(this.patch, svgCanvas, (id) => this.getModuleById(id), {
            allowedModes: (moduleId, widget) => this.allowedModesOf(moduleId, widget),
            modulate: (from, moduleId, widget, mode) => this.modulate(from, moduleId, widget, mode),
            getDepth: (moduleId, modulation) => this.getDepth(moduleId, modulation),
            setDepth: (moduleId, modulation, depth) => this.setDepth(moduleId, modulation, depth),
        });
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
        // selection rectangle on the empty stage, undo and redo
        this.patchView.attachStage(this.sceneView.fSceneContainer);
        // zoom (Ctrl/Cmd + wheel, pinch) around the pointer; the wheel alone moves the stage
        this.sceneView.fSceneContainer.addEventListener("wheel", (e) => {
            var target = e.target as HTMLElement;
            if (target.closest?.("#menuContainer, #dialogue, select, textarea")) return;
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
            } else {
                this.setView(this.fView.zoom, this.fView.x - e.deltaX, this.fView.y - e.deltaY);
            }
        }, { passive: false });
        this.setView(1, 0, 0);
        this.history = new History({
            capture: () => this.captureSnapshot(),
            restore: (state) => this.restoreSnapshot(state),
            changed: () => document.dispatchEvent(new CustomEvent("historychange")),
            settled: () => this.documents?.changed(),
        });
        this.history.reset();
        document.addEventListener("keydown", (e) => {
            var target = e.target as HTMLElement | null;
            if (target?.closest?.("input[type=text], input:not([type]), textarea, [contenteditable=true]")) return;
            var key = e.key.toLowerCase();
            if ((e.ctrlKey || e.metaKey) && key == "z") {
                e.preventDefault();
                if (e.shiftKey) this.redo(); else this.undo();
            } else if ((e.ctrlKey || e.metaKey) && key == "y") {
                e.preventDefault();
                this.redo();
            }
        });
    }

    /*********************** ZOOM ***************************/
    // The stage (cables, modules) is shown at stage·zoom + (x, y): a view of the scene, not a change of
    // it (no history, not saved with the document).

    static ZOOM_MIN = 0.2;
    static ZOOM_MAX = 3;
    private fView = { zoom: 1, x: 0, y: 0 };

    get view(): { zoom: number; x: number; y: number } {
        return { ...this.fView };
    }

    setView(zoom: number, x: number, y: number): void {
        zoom = Math.min(Scene.ZOOM_MAX, Math.max(Scene.ZOOM_MIN, zoom));
        this.fView = { zoom, x, y };
        var stage = this.sceneView.fStage;
        stage.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
        // the stage covers the window whatever the zoom
        stage.style.width = (100 / zoom) + "%";
        stage.style.height = (100 / zoom) + "%";
        // the grid of the background follows
        document.body.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`;
        document.body.style.backgroundPosition = `${x}px ${y}px`;
        this.patchView.zoom = zoom;
        this.patchView.redrawAll();
        document.dispatchEvent(new CustomEvent("viewchange"));
    }

    // Zooms by a factor, the point under (clientX, clientY) staying in place.
    zoomAt(clientX: number, clientY: number, factor: number): void {
        var { zoom, x, y } = this.fView;
        var next = Math.min(Scene.ZOOM_MAX, Math.max(Scene.ZOOM_MIN, zoom * factor));
        var origin = this.sceneView.fSceneContainer.getBoundingClientRect();
        var px = clientX - origin.left, py = clientY - origin.top;
        this.setView(next, px - (px - x) * next / zoom, py - (py - y) * next / zoom);
    }

    // Zooms around the center of the window.
    zoomBy(factor: number): void {
        this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);
    }

    // Shows all the modules (at most at 100%).
    fit(): void {
        var boxes = [...this.fModuleList, this.fAudioInput, this.fAudioOutput].filter(Boolean).map((m) => {
            var c = m.moduleView.getModuleContainer();
            return { x: m.moduleView.x, y: m.moduleView.y, w: c.offsetWidth, h: c.offsetHeight };
        });
        if (boxes.length == 0) { this.setView(1, 0, 0); return; }
        var left = Math.min(...boxes.map((b) => b.x)), top = Math.min(...boxes.map((b) => b.y));
        var right = Math.max(...boxes.map((b) => b.x + b.w)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
        var header = 50, margin = 30;
        var width = window.innerWidth - 2 * margin, height = window.innerHeight - header - 2 * margin;
        var zoom = Math.min(1, width / Math.max(1, right - left), height / Math.max(1, bottom - top));
        zoom = Math.max(Scene.ZOOM_MIN, zoom);
        this.setView(zoom, margin + (width - (right - left) * zoom) / 2 - left * zoom, header + margin + (height - (bottom - top) * zoom) / 2 - top * zoom);
    }

    // A point of the window in the coordinates of the stage (where to put a module dropped there).
    toStage(clientX: number, clientY: number): { x: number; y: number } {
        var origin = this.sceneView.fSceneContainer.getBoundingClientRect();
        return { x: (clientX - origin.left - this.fView.x) / this.fView.zoom, y: (clientY - origin.top - this.fView.y) / this.fView.zoom };
    }

    /*********************** UNDO / REDO ***************************/
    // See History. A state lists the Faust modules (code, position, parameter values, modulations),
    // the positions of the physical modules and the connections.

    undo(): Promise<void> { return this.history.undo(); }
    redo(): Promise<void> { return this.history.redo(); }

    async captureSnapshot(): Promise<string> {
        await Promise.all(Array.from(this.fRecompilations.values()));
        var snapshot: SceneSnapshot = { modules: [], io: [], connections: [] };
        for (var state of this.patch.getModules()) {
            if (state.kind != "faust") {
                snapshot.io.push({ id: state.id, x: state.x, y: state.y });
                continue;
            }
            var module = this.getModuleById(state.id);
            var params: Record<string, number> = {};
            module?.moduleControles.forEach((c) => {
                var value = parseFloat(c.value);
                if (!isNaN(value)) params[c.itemParam.address] = value;
            });
            var remembered = module?.getInterfaceParams() ?? {};
            for (var address in remembered) {
                var depth = parseFloat(remembered[address]);
                if (!(address in params) && isDepthAddress(address) && !isNaN(depth) && depth != defaultDepthAt(address)) params[address] = depth;
            }
            snapshot.modules.push({
                id: state.id, name: state.name, code: state.code, x: state.x, y: state.y, numInputs: state.numInputs, params,
                modulations: state.modulations.map((m) => ({ widget: m.widget, spec: m.spec })),
            });
        }
        // in the order of the ids: a module created again (undo of a removal) is not at the same place in the patch
        snapshot.modules.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        snapshot.connections = this.patch.getConnections().map((c) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`).sort();
        return JSON.stringify(snapshot);
    }

    // Brings the scene to a state: only what differs is changed (a parameter value does not
    // recompile anything; a module is recompiled when its code or its modulations differ).
    async restoreSnapshot(json: string): Promise<void> {
        var target: SceneSnapshot = JSON.parse(json);
        await Promise.all(Array.from(this.fRecompilations.values()));
        var wanted = new Set(target.modules.map((m) => m.id));
        for (var module of this.fModuleList.slice()) {
            if (!wanted.has(module.moduleId)) module.deleteModule();
        }
        for (var t of target.modules) {
            var existing = this.getModuleById(t.id);
            if (!existing) {
                await this.createModule({ id: t.id, name: t.name, code: t.code, x: t.x, y: t.y, params: t.params, acc: [], numInputs: t.numInputs, modulations: t.modulations }, true);
                continue;
            }
            var state = this.patch.getModule(t.id)!;
            var sameModulations = JSON.stringify(state.modulations.map((m) => ({ widget: m.widget, spec: m.spec }))) == JSON.stringify(t.modulations);
            if (!sameModulations) {
                state.modulations.slice().forEach((m) => this.patch.removeModulation(t.id, m.id));
                t.modulations.forEach((m) => this.patch.addModulation(t.id, m.widget, m.spec));
            }
            if (state.code != t.code) {
                var factory = await this.compileModuleCode(existing, t.name, t.code, undefined, false);
                if (factory) await existing.replaceDSP(factory, { name: t.name, code: t.code });
            } else if (!sameModulations) {
                await this.recompileModulations(existing);
            }
            this.restoreParams(existing, t.params);
            this.moveModule(existing, t.x, t.y);
            this.patchView.refreshModule(t.id);
        }
        for (var io of target.io) {
            var physical = io.id == INPUT_ID ? this.fAudioInput : io.id == OUTPUT_ID ? this.fAudioOutput : undefined;
            if (physical) this.moveModule(physical, io.x, io.y);
        }
        var key = (c: Connection) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`;
        var wantedConnections = new Set(target.connections);
        this.patch.getConnections().filter((c) => !wantedConnections.has(key(c))).forEach((c) => this.patch.disconnect(c.id));
        var present = new Set(this.patch.getConnections().map(key));
        for (var k of target.connections) {
            if (present.has(k)) continue;
            var [from, to] = k.split(">").map((end) => { var i = end.lastIndexOf(":"); return { module: end.slice(0, i), port: Number(end.slice(i + 1)) }; });
            try {
                this.patch.connect(from, to);
            } catch (e) {
                console.warn(`undo/redo: connection ${k} not restored`, e);
            }
        }
    }

    // Parameter values through the interface (what the user sees, and saves).
    private restoreParams(module: ModuleClass, params: Record<string, number>): void {
        for (var address in params) {
            var value = params[address];
            var controler = module.moduleControles.find((c) => c.itemParam.address == address);
            if (!controler || parseFloat(controler.value) == value) continue;
            var slider = controler.faustInterfaceView.slider;
            if (slider) {
                // the value as it is (with a logarithmic scale, the position is not exact)
                setControlerValue(controler, value, (a, v) => module.moduleFaust.getDSP().setParamValue(a, v));
            } else {
                controler.value = String(value);
                module.moduleFaust.getDSP().setParamValue(address, value);
            }
        }
    }

    private moveModule(module: ModuleClass, x: number, y: number): void {
        var view = module.moduleView;
        if (view.x == x && view.y == y) return;
        view.x = x;
        view.y = y;
        view.getModuleContainer().style.left = x + "px";
        view.getModuleContainer().style.top = y + "px";
        this.patch.updateModule(module.moduleId, { x, y });
        this.patchView.redrawModule(module.moduleId);
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
    addModule(module: ModuleClass, modulations: Array<{ widget: string; spec: ModulationSpec }> = [], id?: ModuleId): void {
        var dsp = module.moduleFaust.getDSP();
        var state = this.patch.addModule({
            id,
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
        this.faustcodeLink.forget(module);
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
        // its position in the model too: the history and the documents record it
        this.patch.addModule({ id: OUTPUT_ID, kind: "output", name: "output", numInputs: channels, numOutputs: 0, x: positionOutput.x, y: positionOutput.y });
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
        this.patch.addModule({ id: INPUT_ID, kind: "input", name: "input", numInputs: 0, numOutputs: 2, x: positionInput.x, y: positionInput.y });
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
            // values of the interface (what the user sees): getParamValue reads the AudioParam of an
            // AudioWorklet node, which may lag behind (e.g. a value set while the context is suspended)
            var params = this.moduleParams(module);
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

    // The parameter values of a module, as its interface shows them, and the depths it remembers
    // for widgets no longer modulated (model/Modulation.ts, isDepthAddress), unless it is the default
    // one (a modulation made and undone leaves the module as it was).
    private moduleParams(module: ModuleClass): Record<string, number> {
        var dsp = module.moduleFaust.getDSP();
        var shown = new Map<string, number>();
        module.moduleControles.forEach((c) => {
            var value = parseFloat(c.value);
            if (!isNaN(value)) shown.set(c.itemParam.address, value);
        });
        var params: Record<string, number> = {};
        for (var path of dsp.getParams() ?? []) {
            params[path] = shown.get(path) ?? dsp.getParamValue(path);
        }
        var remembered = module.getInterfaceParams();
        for (var address in remembered) {
            var value = parseFloat(remembered[address]);
            if (!(address in params) && isDepthAddress(address) && !isNaN(value) && value != defaultDepthAt(address)) params[address] = value;
        }
        return params;
    }

    // The scene as a patch file, without changing the patch model (the documents save it at every
    // step of the history): the values shown by the interface, the code of the modules, and the
    // positions of the model (those the history records).
    describePatch(): PatchFileV2 {
        var modules: ModuleFileV2[] = [];
        for (var state of this.patch.getModules()) {
            var base = { id: state.id, kind: state.kind, inputs: state.numInputs, outputs: state.numOutputs };
            if (state.kind != "faust") {
                modules.push({ ...base, name: state.name, code: "", x: state.x, y: state.y, params: {}, acc: [] });
                continue;
            }
            var module = this.getModuleById(state.id);
            if (!module) continue;
            var params = this.moduleParams(module);
            var acc: AccMapping[] = module.moduleControles.map((controler) => {
                var slider = controler.accelerometerSlider;
                return { address: slider.address, axis: slider.axis, curve: slider.curve, amin: slider.amin, amid: slider.amid, amax: slider.amax, enabled: slider.isEnabled };
            });
            var file: ModuleFileV2 = { ...base, name: module.moduleFaust.getName(), code: module.moduleFaust.getSource(), x: state.x, y: state.y, params, acc };
            if (state.modulations.length > 0) file.modulations = state.modulations.map((m) => ({ widget: m.widget, ...m.spec }));
            modules.push(file);
        }
        return {
            format: PATCH_FORMAT,
            version: modules.some((m) => m.modulations) ? PATCH_VERSION_MODULATIONS : PATCH_VERSION,
            sceneName: this.sceneName,
            modules,
            connections: this.patch.getConnections().map((c) => ({ from: { ...c.from }, to: { ...c.to } })),
        };
    }

    // Saves the scene as a version 2 patch file (JSON string).
    // isPrecompiled is used to save or not the compiled wasm code
    saveScene(isPrecompiled: boolean): string {
        this.updatePatchFromModules(isPrecompiled);
        return JSON.stringify(serializePatch(this.patch, this.sceneName, isPrecompiled));
    }

    // A change the patch model does not see (a parameter value).
    markModified(): void {
        if (this.fRecalling == 0) {
            this.fModified = true;
            this.history?.touch();
        }
    }

    markSaved(): void {
        this.fModified = false;
    }

    // Work that opening another patch would lose (an empty scene has none). With documents: the
    // open document differs from its committed copy (nothing is lost, it has a working copy).
    hasUnsavedChanges(): boolean {
        if (this.documents) return this.documents.dirty;
        return this.fModified && (this.fModuleList.length > 0 || this.patch.getConnections().length > 0);
    }

    private confirmReplace(): Promise<boolean> {
        return new Promise((resolve) => {
            new Confirm(Utilitary.messageResource.confirmReplaceScene, (close) => { close(); resolve(true); }, () => resolve(false));
        });
    }

    // Removes every module and connection: an empty scene (the physical input and output stay).
    clearScene(): void {
        var modules = this.getModules();
        while (modules.length != 0) {
            modules[0].deleteModule();      // removes it from the list and from the patch
        }
        // connections left between the physical input and output
        this.patch.getConnections().forEach((c) => this.patch.disconnect(c.id));
        this.sceneName = "Patch";
    }

    // Opens a patch file (version 1, 2 or 3). With documents, it becomes a new document (the open
    // one keeps its copies); otherwise it replaces the scene, after confirmation if it was modified.
    async recallScene(json: string | null): Promise<void> {
        if (json != null && this.documents) {
            await this.documents.importPatch(json);
            return;
        }
        await this.replaceScene(json, { confirm: true });
    }

    // Replaces the scene by a patch file. A file that cannot be read leaves the scene as it is
    // (false). keepIds: the modules keep the ids of the file (documents).
    async replaceScene(json: string | null, options: { confirm?: boolean; keepIds?: boolean } = {}): Promise<boolean> {
        if (json == null) {
            Utilitary.hideFullPageLoading();
            new Message(Utilitary.messageResource.errorLoading);
            return false;
        }
        var replaced = false;
        var warnings: string[] = [];
        try {
            var data: unknown = JSON.parse(json);
            // the file is read whole before the scene is cleared
            var recall: () => Promise<string[]>;
            if (isPatchFileV2(data)) {
                var v2 = parsePatchV2(data);
                recall = () => this.recallV2(v2, options.keepIds ?? false);
            } else if (isPatchFileV1(data)) {
                var v1 = readV1(data);
                recall = () => this.recallV1(v1);
            } else {
                throw new Error("unknown patch format");
            }
            if (options.confirm && this.hasUnsavedChanges()) {
                Utilitary.hideFullPageLoading();
                if (!(await this.confirmReplace())) return false;
                Utilitary.showFullPageLoading();
            }
            this.fRecalling++;
            try {
                this.clearScene();
                warnings = await recall();
                replaced = true;
            } finally {
                this.fRecalling--;
                this.fModified = false;     // a scene just opened has nothing to save
                this.history.reset();       // nor anything to undo
            }
        } catch (e) {
            console.error(e);
            new Message(Utilitary.messageResource.errorJsonCorrupted + " : " + e);
        }
        if (warnings.length > 0) {
            warnings.forEach((w) => console.warn(w));
            new Message(warnings.join("\n"));
        }
        if (replaced && !this.documents) document.dispatchEvent(new CustomEvent("updatename"));
        Utilitary.hideFullPageLoading();
        return replaced;
    }

    private async recallV2({ patch: file, sceneName }: ReturnType<typeof parsePatchV2>, keepIds: boolean): Promise<string[]> {
        this.sceneName = sceneName;
        var warnings: string[] = [];
        // positions of the physical input and output, kept in the window. (0, 0) is no position: the
        // files and documents saved before 3.1.1 had no other, and the modules stay where they are.
        for (var io of file.getModules()) {
            var physical = io.kind == "input" ? this.fAudioInput : io.kind == "output" ? this.fAudioOutput : undefined;
            if (!physical || (io.x == 0 && io.y == 0)) continue;
            var x = Math.max(0, Math.min(io.x, window.innerWidth - 98));
            var y = Math.max(50, Math.min(io.y, window.innerHeight - 100));
            this.moveModule(physical, x, y);
        }
        var ids = await this.recallModules(file.getModules().filter((m) => m.kind == "faust"), warnings, keepIds);
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

    private async recallV1(draft: ReturnType<typeof readV1>): Promise<string[]> {
        if (draft.sceneName) {
            this.sceneName = draft.sceneName;
        }
        var warnings = [...draft.warnings];
        var ids = await this.recallModules(draft.modules, warnings);
        warnings.push(...connectV1Links(this.patch, draft.links, (id) => ids.get(id)));
        return warnings;
    }

    // Creates the modules (in sequence) and returns the map: id in the file -> id in the patch.
    private async recallModules(descriptions: ModuleDescription[], warnings: string[], keepIds: boolean = false): Promise<Map<ModuleId, ModuleId>> {
        var ids = new Map<ModuleId, ModuleId>([[INPUT_ID, INPUT_ID], [OUTPUT_ID, OUTPUT_ID]]);
        for (var description of descriptions) {
            var module = await this.createModule(description, keepIds);
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

    private async compile(name: string, code: string, x: number, y: number, mute: boolean = true, onError?: (error: string) => void): Promise<FaustDspFactory | null> {
        var result: FaustDspFactory | null = null;
        await this.compileFaust({ name, sourceCode: code, x, y, mute, onError, callback: (factory) => { result = factory } });
        return result;
    }

    /*********************** WIDGET MODULATIONS ***************************/
    // See model/Modulation.ts and Documentation/widget-modulation/PLAN.md.

    private fRecompilations = new Map<ModuleId, Promise<boolean>>();
    private fWidgets = new WeakMap<object, WidgetDescription[]>();

    // Widgets of the current DSP of a module (cached per DSP: asked at every move of a cable).
    widgetsOf(module: ModuleClass): WidgetDescription[] {
        var dsp = module.moduleFaust.getDSP();
        var widgets = this.fWidgets.get(dsp);
        if (!widgets) {
            widgets = listWidgets(JSON.parse(dsp.getJSON()).ui);
            this.fWidgets.set(dsp, widgets);
        }
        return widgets;
    }

    // Depth slider of a "modulate" or "add" modulation in the current DSP of its module (absent while the
    // module is being recompiled with a new modulation).
    private depthOf(moduleId: ModuleId, modulationId: string): { module: ModuleClass; address: string } | undefined {
        var module = this.getModuleById(moduleId);
        var modulation = this.patch.getModule(moduleId)?.modulations.find((m) => m.id == modulationId);
        if (!module || !modulation || !hasDepth(modulation.spec.mode)) return undefined;
        var widget = depthWidget(this.widgetsOf(module), modulation.spec);
        return widget ? { module, address: widget.address } : undefined;
    }

    // Read from the interface state, updated at once (the parameter value of an AudioWorklet node is
    // only updated when the audio thread reports it).
    getDepth(moduleId: ModuleId, modulationId: string): number | undefined {
        var depth = this.depthOf(moduleId, modulationId);
        if (!depth) return undefined;
        var controler = depth.module.moduleControles.find((c) => c.itemParam.address == depth!.address);
        var value = controler ? parseFloat(controler.value) : NaN;
        return isNaN(value) ? depth.module.moduleFaust.getDSP().getParamValue(depth.address) : value;
    }

    // Sets a depth through its (hidden) slider, so that the interface state, saved with the patch and
    // kept across recompilations, follows.
    setDepth(moduleId: ModuleId, modulationId: string, value: number): void {
        var depth = this.depthOf(moduleId, modulationId);
        if (!depth) return;
        var controler = depth.module.moduleControles.find((c) => c.itemParam.address == depth!.address);
        var slider = controler?.faustInterfaceView.slider;
        if (controler && slider) {
            setControlerValue(controler, value, (a, v) => depth!.module.moduleFaust.getDSP().setParamValue(a, v));
            this.markModified();
        } else {
            depth.module.moduleFaust.getDSP().setParamValue(depth.address, value);
        }
    }

    // Modulation types a cable may choose for a widget: those allowed for its kind, or the type of
    // its modulation if it has one (one type per widget); none beyond 32 inputs.
    allowedModesOf(moduleId: ModuleId, widget: string): ModulationMode[] {
        var state = this.patch.getModule(moduleId);
        var module = this.getModuleById(moduleId);
        if (!state || !module || state.kind != "faust") return [];
        var existing = state.modulations.find((m) => m.widget == widget);
        if (existing) return [existing.spec.mode];
        var description = this.widgetsOf(module).find((w) => w.address == widget);
        if (!description || !isModulable(description) || totalInputs(state) >= MAX_CHANNELS) return [];
        return allowedModes(description);
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
    // Errors are passed to onError if given (shown as messages otherwise).
    async compileModuleCode(module: ModuleClass, name: string, code: string, onError?: (error: string) => void, mute: boolean = true): Promise<FaustDspFactory | null> {
        var state = module.moduleId !== undefined ? this.patch.getModule(module.moduleId) : undefined;
        var base = await this.compile(name, code, module.moduleView.x, module.moduleView.y, mute, onError);
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
        var factory = await this.compile(name, modulatedCode(code, json.inputs, state.modulations.map((m) => m.spec)), module.moduleView.x, module.moduleView.y, mute, onError);
        if (factory && JSON.parse(factory.json).inputs != json.inputs + state.modulations.length) {
            var error = Utilitary.messageResource.modulationFailed.replace("{reason}", "unexpected number of inputs");
            if (onError) onError(error); else new Message(error);
            return null;
        }
        return factory;
    }

    // Replaces the code of a module by edited user code (integrated editor, faustcode): rewrapped in
    // the group of the module, so that its parameters keep their addresses and values; with its
    // modulations; after the pending recompilations of the module. The scene keeps playing.
    // Resolves with null when done, or with the reason of the failure (the module keeps its DSP).
    editModuleCode(module: ModuleClass, edited: string): Promise<string | null> {
        var id = module.moduleId;
        var task = async (): Promise<string | null> => {
            if (!this.getModules().includes(module)) return "the module was removed";
            var name = module.moduleFaust.getName();
            var previous = storedCode(name, module.moduleFaust.getSource()).code;
            var code = rewrapModuleCode(module.moduleFaust.getSource(), edited);
            var error: string | null = null;
            var container = module.moduleView.getModuleContainer();
            container.classList.add("compiling");
            var factory = await this.compileModuleCode(module, name, code, (e) => { error = e }, false);
            container.classList.remove("compiling");
            if (!factory) {
                error = error ?? Utilitary.messageResource.errorCreateDSP;
                return unwrapModuleCode(code) ? userError(error) : error;
            }
            if (!this.getModules().includes(module)) return "the module was removed";
            if (!(await module.replaceDSP(factory, { name, code }))) return module.lastError ?? Utilitary.messageResource.errorCreateDSP;
            // a new version of the user module (documents/Documents.ts)
            this.documents?.codeEdited(previous, storedCode(name, code).code, name);
            return null;
        };
        var result = (this.fRecompilations.get(id) ?? Promise.resolve(true)).then(task, task);
        this.fRecompilations.set(id, result.then((error) => error == null));
        return result;
    }

    // Edits the code of a module in faustcode (see FaustcodeLink).
    // An update of a module to the latest version of its user module (the ↑ of its title bar).
    showUpdate(id: ModuleId, available: boolean): void {
        this.getModuleById(id)?.moduleView.setUpdateAvailable(available);
    }

    updateModuleCode(id: ModuleId, code: string): Promise<string | null> {
        var module = this.getModuleById(id);
        return module ? this.editModuleCode(module, code) : Promise.resolve("the module was removed");
    }

    updateModule(module: ModuleClass): void {
        if (module.moduleId !== undefined && this.documents) {
            this.documents.updateInstance(module.moduleId).then((error) => {
                if (error) new Message(Utilitary.messageResource.moduleUpdateFailed.replace("{name}", module.moduleFaust.getName()).replace("{error}", error));
            });
        }
    }

    editInFaustcode(module: ModuleClass): void {
        this.faustcodeLink.edit(module);
    }

    // Creates a module from its description: precompiled factory if any, otherwise compilation.
    // keepId: the module gets the id of its description (undo/redo), instead of a new one.
    private async createModule(description: ModuleDescription, keepId: boolean = false): Promise<ModuleClass | null> {
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
            } else if (isDepthAddress(path)) {
                module.addInterfaceParam(path, description.params[path]);      // remembered for a later modulation
            } else {
                console.warn(`module ${description.id} (${description.name}): unknown parameter ${path} ignored`);
            }
        }
        module.recallInterfaceParams();
        module.setFaustInterfaceControles();
        module.createFaustInterface();
        this.addModule(module, modulations.map((m) => ({ widget: m.widget, spec: m.spec })), keepId ? description.id : undefined);
        this.recallAccValues(description.acc, module);
        return module;
    }

    //recall of the accelerometer mapping parameters for each FaustInterfaceControler of the Module
    recallAccValues(mappings: AccMapping[], module: ModuleClass) {
        for (var controle of mappings) {
            for (var moduleControle of module.moduleControles) {
                // only sliders have an accelerometer mapping shown (buttons and checkboxes have no group)
                if (moduleControle.itemParam.address == controle.address && moduleControle.faustInterfaceView.group && moduleControle.faustInterfaceView.slider) {
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

                    // only the accelerometer classes are reset: the others (widget, modulation-depth,
                    // modulated...) belong to the view
                    group.classList.remove("x", "y", "z", "disabledAcc");
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
    // the center of the window, on the stage
    positionDblTapModule(): PositionModule {
        var position: PositionModule = new PositionModule();
        var center = this.toStage(window.innerWidth / 2, window.innerHeight / 2);
        position.x = center.x;
        position.y = center.y;
        return position
    }
}
