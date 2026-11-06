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
import { MasterVolume } from "../audio/MasterVolume";
import { MidiModules } from "../midi/MidiModules";
import { SharedTimeline } from "../sync/SharedTimeline";
import { syncInputs } from "../sync/SyncInputs";
import { VolumeControl } from "../view/VolumeControl";
import { faustWasmEnv } from "../Main";
import { Confirm, Message } from "../Messages";
import { allowedModes, defaultDepthAt, depthWidget, hasDepth, isDepthAddress, isModulable, listWidgets, ModulationError, ModulationMode, ModulationSpec, modulatedCode, modulationSpec, WidgetDescription } from "../model/Modulation";
import { AccMapping, Connection, MAX_CHANNELS, ModuleId, ModuleViewSettings, Patch, PortRef, PrecompiledFactory, totalInputs } from "../model/Patch";
import { ORBIT_SIZE } from "../Modules/OrbitPanel";
import { encodeFactoryCode, isPatchFileV2, ModuleFileV2, PATCH_FORMAT, PATCH_VERSION, PATCH_VERSION_MODULATIONS, PatchFileV2, parsePatchV2, serializePatch } from "../model/PatchFormat";
import { connectV1Links, isPatchFileV1, matchParamPath, readV1 } from "../model/PatchFormatV1";
import { ModuleClass } from "../Modules/ModuleClass";
import { setControlerValue } from "../Modules/FaustInterface";
import { CompileFaust, PositionModule, Utilitary } from "../Utilitary";
import { PatchView } from "../view/PatchView";
import { MenuItem, shortcut, showContextMenu } from "../view/ContextMenu";
import { FaustcodeLink, faustcodeUrl } from "../FaustcodeLink";
import { rewrapModuleCode, unwrapModuleCode, userCode, userError, wrapModuleCode } from "../model/ModuleCode";
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
        view?: ModuleViewSettings;          // the Orbit and its size (the layout of its points is not undone)
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

// The code of a new module (the context menu of the stage), to be written in faustcode.
const NEW_MODULE_CODE = `import("stdfaust.lib");

// A new module: write it in faustcode, each successful save (Cmd/Ctrl-S) updates it.
process = _;
`;

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
    view?: ModuleViewSettings;              // the Orbit interface
}

export class Scene {
    isMute: boolean = false;
    masterVolume: MasterVolume | null = null;
    // faust-sync: the timeline shared with the other Faust applications of the browser, and its Timeline node
    // that feeds the reserved inputs of the modules (Documentation/FAUST-SYNC-SPEC.md)
    sync: SharedTimeline | null = null;
    // the MIDI keyboards, played by the MIDI to CV modules (asked for when the first one appears)
    midi = new MidiModules({
        modules: () => this.fModuleList,
        notify: (message) => { new Message(message) },
        messages: () => Utilitary.messageResource,
    });
    volumeControl: VolumeControl | null = null;
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
        this.startSync();
        this.patch.subscribe(() => this.markModified());     // modules, connections, positions, code, modulations
        var svgCanvas = this.sceneView.fSceneContainer.querySelector("#svgCanvas") as SVGSVGElement;
        this.faustcodeLink = new FaustcodeLink<ModuleClass>(faustcodeUrl(), {
            isAlive: (module) => this.fModuleList.includes(module),
            nameOf: (module) => module.moduleFaust.getName(),
            codeOf: (module) => userCode(module.moduleFaust.getSource()),
            apply: (module, code) => this.editModuleCode(module, code),
            notify: (message) => { new Message(message) },
            libfaust: () => faustWasmEnv.faustCompiler.version(),
            importModule: (name, code) => this.addModuleFromCode(name, code),
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
        this.attachCommands(this.sceneView.fSceneContainer);
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
            // in an Orbit whose library of presets is open: the undo of the library (faust-orbit-ui)
            var orbit = target?.closest?.(".orbit-ui-root.orbit-ui-overlay-active") as HTMLElement | null;
            if (orbit && (e.ctrlKey || e.metaKey) && key == "z") {
                var owner = this.fModuleList.find((m) => m.orbit?.host === orbit);
                if (owner) {
                    e.preventDefault();
                    if (e.shiftKey) owner.orbit!.orbit.redoLibrary(); else owner.orbit!.orbit.undoLibrary();
                    return;
                }
            }
            if ((e.ctrlKey || e.metaKey) && key == "z") {
                e.preventDefault();
                if (e.shiftKey) this.redo(); else this.undo();
            } else if ((e.ctrlKey || e.metaKey) && key == "y") {
                e.preventDefault();
                this.redo();
            } else if ((e.ctrlKey || e.metaKey) && key == "d") {
                // duplicates the selected modules; with Shift, without the cables coming from outside
                e.preventDefault();
                var selection = this.patchView.getSelection();
                if (selection.length > 0) this.duplicateModules(selection, !e.shiftKey);
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
        this.patchView.magnifier.release(true);
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
        await Promise.all(Array.from(this.fOperations));
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
            var orbit = module?.orbitSettings();
            snapshot.modules.push({
                id: state.id, name: state.name, code: state.code, x: state.x, y: state.y, numInputs: state.numInputs, params,
                modulations: state.modulations.map((m) => ({ widget: m.widget, spec: m.spec })),
                ...(orbit ? { view: { orbit: { width: orbit.width, height: orbit.height } } } : {}),
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
                await this.createModule({ id: t.id, name: t.name, code: t.code, x: t.x, y: t.y, params: t.params, acc: [], numInputs: t.numInputs, modulations: t.modulations, view: t.view }, true);
                continue;
            }
            var state = this.patch.getModule(t.id)!;
            var sameModulations = JSON.stringify(state.modulations.map((m) => ({ widget: m.widget, spec: m.spec }))) == JSON.stringify(t.modulations);
            if (!sameModulations) {
                state.modulations.slice().forEach((m) => this.patch.removeModulation(t.id, m.id));
                t.modulations.forEach((m) => this.patch.addModulation(t.id, m.widget, m.spec));
            }
            if (state.code != t.code) {
                var factory = await this.compileModuleCode(existing, t.name, t.code);
                if (factory) await existing.replaceDSP(factory, { name: t.name, code: t.code });
            } else if (!sameModulations) {
                await this.recompileModulations(existing);
            }
            this.restoreParams(existing, t.params);
            this.restoreView(existing, t.view);
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
            if (slider || controler.faustInterfaceView.checkbox) {
                // the value as it is (with a logarithmic scale, the position is not exact); a checkbox shown checked or not
                setControlerValue(controler, value, (a, v) => module.moduleFaust.getDSP().setParamValue(a, v));
            } else {
                controler.value = String(value);
                module.moduleFaust.getDSP().setParamValue(address, value);
            }
        }
        module.syncOrbit();
    }

    // The Orbit interface of a module, or the classic one (an undo, a redo): its size; the layout of its
    // points stays as it is.
    private restoreView(module: ModuleClass, view: ModuleViewSettings | undefined): void {
        var orbit = view?.orbit;
        module.setOrbit(orbit ? { width: orbit.width, height: orbit.height } : null);
        this.patch.updateModule(module.moduleId, { view: orbit ? { orbit: { width: orbit.width, height: orbit.height } } : undefined });
    }

    /*********************** ORBIT INTERFACE ***************************/
    // The Orbit interface (faust-orbit-ui) of the modules, in place of the classic one (ModuleClass.setOrbit).

    // Shows the Orbit of the modules, or their classic interface if they all show the Orbit.
    toggleOrbit(ids: ModuleId[]): void {
        var modules = ids.map((id) => this.getModuleById(id)).filter((m): m is ModuleClass => !!m && m.canShowOrbit());
        if (modules.length == 0) return;
        var classic = modules.every((m) => m.orbit);
        for (var module of modules) {
            module.setOrbit(classic ? null : { width: ORBIT_SIZE.width, height: ORBIT_SIZE.height });
            this.orbitChanged(module);
        }
    }

    // The Orbit of a module shown, hidden or resized (the patch, so the history), or the layout of its
    // points changed (saved with the document, not recorded by the history).
    orbitChanged(module: ModuleClass): void {
        var state = this.patch.getModule(module.moduleId);
        if (!state) return;
        var settings = module.orbitSettings();
        var view: ModuleViewSettings | undefined = settings ? { orbit: { width: settings.width, height: settings.height } } : undefined;
        if (JSON.stringify(state.view ?? null) != JSON.stringify(view ?? null)) {
            this.patch.updateModule(module.moduleId, { view });
        } else {
            this.markModified();
        }
        this.patchView.refreshModule(module.moduleId);
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

    // faust-sync: the shared timeline, and the reserved inputs of the modules fed by its Timeline node; the modules
    // created before the node is ready get their reserved inputs once it is.
    private startSync(): void {
        var context = Utilitary.audioContext as AudioContext;
        if (!context?.audioWorklet) return;
        var sync = new SharedTimeline(context, "faustmodular");
        this.audioGraph.setReservedInputs((id) => {
            var module = this.getModuleById(id);
            var outputs = module ? syncInputs(module.moduleFaust.getSource()) : [];
            return outputs.length > 0 && sync.output ? { source: sync.output, outputs } : null;
        });
        sync.start().then(() => {
            this.sync = sync;
            this.audioGraph.refreshReserved();
            // the modules that read the timeline, created before: their gates watched (diagnosis)
            this.fModuleList.forEach((m) => {
                const node = m.moduleId !== undefined ? this.audioGraph.getNode(m.moduleId) : undefined;
                if (node && syncInputs(m.moduleFaust.getSource()).length > 0) sync.probe(node);
            });
            document.dispatchEvent(new CustomEvent("syncready"));
        }).catch((e) => console.warn("faust-sync unavailable:", e));
    }

    /*********************** MUTE/UNMUTE SCENE ***************************/
    // By the gain of the volume (audio/MasterVolume.ts): the audio keeps running, the volume is kept.
    muteScene(): void {
        this.masterVolume?.setMuted(true);
        this.isMute = true;
    }
    unmuteScene(): void {
        this.masterVolume?.setMuted(false);
        this.isMute = false;
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
            numInputs: dsp.getNumInputs() - modulations.length - syncInputs(module.moduleFaust.getSource()).length,
            numOutputs: dsp.getNumOutputs(),
            modulations,
        });
        module.moduleId = state.id;
        // in the list before its node: the graph asks for its reserved inputs (startSync)
        this.fModuleList.push(module);
        this.audioGraph.setNode(state.id, dsp);
        if (syncInputs(module.moduleFaust.getSource()).length > 0) this.sync?.probe(dsp);
        this.patchView.addModule(module);
        this.midi.moduleAdded(module);          // a MIDI to CV module: the MIDI devices asked for (once)
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
    // `replaced` receives nothing: it is called when the previous DSP of the module, crossfaded with the
    // new one (AudioGraph), can be destroyed.
    updateModuleDSP(module: ModuleClass, replaced?: () => void): Connection[] {
        var dsp = module.moduleFaust.getDSP();
        // the DSP is compiled from the effective code: its first inputs are the audio inputs
        var modulations = this.patch.getModule(module.moduleId)!.modulations.length;
        var reserved = syncInputs(module.moduleFaust.getSource()).length;
        var removed = this.patch.setArity(module.moduleId, dsp.getNumInputs() - modulations - reserved, dsp.getNumOutputs());
        this.patch.updateModule(module.moduleId, { name: module.moduleFaust.getName(), code: module.moduleFaust.getSource() });
        this.audioGraph.setNode(module.moduleId, dsp, replaced);
        if (reserved > 0) this.sync?.probe(dsp);
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
        // the volume of the scene between the output module and the device, set on its icon
        this.masterVolume = new MasterVolume(Utilitary.audioContext, channels);
        this.volumeControl = new VolumeControl(this.fAudioOutput.moduleView.fInterfaceContainer, this.masterVolume,
            (down, now) => this.patchView.dragModuleFrom(down, OUTPUT_ID, now));
        this.audioGraph.setNode(OUTPUT_ID, this.masterVolume.node);
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
        // the microphone on demand, not at load: when a cable leaves the input module (drawn, undone, loaded
        // with a scene), or on a click on it
        this.showAudioInput();
        this.patch.subscribe((event) => {
            if (event.type == "connectionAdded" && event.connection.from.module == INPUT_ID) this.activateAudioInput();
            // the last cable from it removed: the microphone closed (an open microphone may change the output of the
            // browser: its latency, its quality), after a moment (a cable drawn again, an undo)
            if (event.type == "connectionRemoved" && event.connection.from.module == INPUT_ID) {
                setTimeout(() => { if (this.patch.connectionsFrom(INPUT_ID).length == 0) this.deactivateAudioInput(); }, 1000);
            }
        });
        const container = this.fAudioInput.moduleView.fModuleContainer;
        let down: { x: number; y: number } | null = null;
        container.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
        container.addEventListener("click", (e) => {
            if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && !(e.target as HTMLElement).closest(".port")) {
                // a click turns it on, or off when no cable leaves it
                if (this.audioInputState == "on" && this.patch.connectionsFrom(INPUT_ID).length == 0) this.deactivateAudioInput();
                else this.activateAudioInput();
            }
        });
    }

    // The entry of the context menu of a module to publish it to a store (FileMenu.publishItem, set by Main.ts).
    publishMenuItem: ((label: string, publish: (store: string) => void, enabled: boolean) => MenuItem) | null = null;

    // The state of the microphone: not asked yet (idle), being asked, on, or refused (or missing).
    audioInputState: "idle" | "pending" | "on" | "refused" = "idle";

    private showAudioInput(): void {
        const container = this.fAudioInput.moduleView.fModuleContainer;
        const t = Utilitary.messageResource;
        container.dataset.microphone = this.audioInputState;
        container.title = this.audioInputState == "on" ? (t.microphoneOn ?? "")
            : this.audioInputState == "refused" ? t.errorGettingAudioInput
            : (t.microphoneIdle ?? "");
    }

    getAudioOutput(): ModuleClass { return this.fAudioOutput; }
    getAudioInput(): ModuleClass { return this.fAudioInput; }

    /********************************************************************
**********************  ACTIVATE PHYSICAL IN/OUTPUT *****************
********************************************************************/

    // Asks for the microphone, once (again after a refusal: the user asks for it).
    activateAudioInput(): void {
        if (this.audioInputState == "pending" || this.audioInputState == "on") return;
        this.audioInputState = "pending";
        this.showAudioInput();
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } as any })
            // 'as any' is needed here because of a typo in lib.d.ts (echoCancellation is written echoCancelation)
            .then(
                (mediaStream) => {
                    this.audioInputState = "on";
                    this.getDevice(mediaStream);
                    this.showAudioInput();
                    console.log("audio track has settings:", mediaStream.getAudioTracks()[0].getSettings());
                }
            ).catch(
                (err) => {
                    console.warn("microphone:", err);
                    this.audioInputState = "refused";
                    this.showAudioInput();
                    new Message(Utilitary.messageResource.errorGettingAudioInput);
                }
            );
    }

    // The microphone closed: its tracks stopped, the input module without a node (until it is asked for again).
    deactivateAudioInput(): void {
        if (this.audioInputState != "on") return;
        this.fMicrophone?.getTracks().forEach((t) => t.stop());
        this.fMicrophone = null;
        this.audioGraph.setNode(INPUT_ID, null);
        this.audioInputState = "idle";
        this.showAudioInput();
    }

    private fMicrophone: MediaStream | null = null;

    private getDevice(device: MediaStream): void {
        this.fMicrophone = device;
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
                view: module.orbit ? { orbit: module.orbitSettings()! } : undefined,
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
            var orbitSettings = module.orbitSettings();
            if (orbitSettings) file.view = { orbit: orbitSettings };
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

    private async compile(name: string, code: string, x: number, y: number, onError?: (error: string) => void): Promise<FaustDspFactory | null> {
        var result: FaustDspFactory | null = null;
        await this.compileFaust({ name, sourceCode: code, x, y, onError, callback: (factory) => { result = factory } });
        return result;
    }

    /*********************** WIDGET MODULATIONS ***************************/
    // See model/Modulation.ts and Documentation/widget-modulation/PLAN.md.

    private fRecompilations = new Map<ModuleId, Promise<boolean>>();
    // operations of several steps (a duplication): a history step waits for them, so that they make one
    private fOperations = new Set<Promise<unknown>>();

    /*********************** DUPLICATION, CLIPBOARD ***************************/
    // Offset of the copies from the originals (stage px).
    static DUPLICATE_OFFSET = 40;

    // Duplicates modules with their code, their settings (modulation depths included) and their
    // modulations, offset down and to the right; the copies become the selection. The connections
    // between the duplicated modules are duplicated; with `withInputs`, the connections coming from
    // other modules (audio inputs, modulation sources) too, so that the copy is fed as the original.
    // The outputs to other modules are not: the copy would double their signal. A modulation left
    // without any source is not duplicated. Undone in one step.
    duplicateModules(ids: ModuleId[], withInputs: boolean = true): Promise<ModuleId[]> {
        return this.operation(async () => {
            var fragment = await this.fragment(ids, withInputs);
            return fragment ? this.insertFragment(fragment, Scene.DUPLICATE_OFFSET, Scene.DUPLICATE_OFFSET) : [];
        });
    }

    // An operation of several steps (duplication, paste, deletion): a history step waits for it, so
    // that it makes one.
    private operation<T>(run: () => Promise<T>): Promise<T> {
        var task = run();
        this.fOperations.add(task);
        var done = () => { this.fOperations.delete(task); };
        task.then(done, done);
        return task;
    }

    // The Faust modules among `ids` as a patch file: their code, settings and modulations, the
    // connections between them and, with `withInputs`, those coming from other modules (whose ids are
    // then those of this scene). A modulation left without any source is left out, and the modulation
    // ports are numbered anew in the connections.
    private async fragment(ids: ModuleId[], withInputs: boolean): Promise<PatchFileV2 | null> {
        await Promise.all(Array.from(this.fRecompilations.values()));
        return this.fragmentNow(ids, withInputs);
    }

    // The same, at once (a copy event must fill the clipboard before it returns).
    private fragmentNow(ids: ModuleId[], withInputs: boolean): PatchFileV2 | null {
        var chosen = new Set(ids.filter((id) => this.patch.getModule(id)?.kind == "faust"));
        if (chosen.size == 0) return null;
        var file = this.describePatch();
        var incoming = file.connections.filter((c) => chosen.has(c.to.module) && (chosen.has(c.from.module) || withInputs));
        var ports = new Map<string, number>();          // "module:old port" -> new port
        var modules = file.modules.filter((m) => chosen.has(m.id)).map((m) => {
            var copy: ModuleFileV2 = { ...m };
            delete copy.modulations;
            for (var p = 0; p < m.inputs; p++) ports.set(`${m.id}:${p}`, p);
            var next = m.inputs;
            var kept = (m.modulations ?? []).filter((_, i) => {
                var port = m.inputs + i;
                if (!incoming.some((c) => c.to.module == m.id && c.to.port == port)) return false;
                ports.set(`${m.id}:${port}`, next++);
                return true;
            });
            if (kept.length > 0) copy.modulations = kept;
            return copy;
        });
        var connections = incoming.map((c) => ({ from: { ...c.from }, to: { module: c.to.module, port: ports.get(`${c.to.module}:${c.to.port}`)! } }));
        return { ...file, sceneName: "", modules, connections };
    }

    // Creates the modules of a fragment, moved by (dx, dy), and its connections: between its modules,
    // and from the modules of this scene its other connections name. Returns the new modules, which
    // become the selection.
    private async insertFragment(fragment: PatchFileV2, dx: number, dy: number): Promise<ModuleId[]> {
        var inside = new Set(fragment.modules.map((m) => m.id));
        var modules = fragment.modules.filter((m) => m.kind == "faust").map((m) => ({ ...m, x: m.x + dx, y: m.y + dy }));
        var parsed = parsePatchV2({ ...fragment, modules, connections: [] });
        var warnings: string[] = [];
        var created = await this.recallModules(parsed.patch.getModules().filter((m) => m.kind == "faust"), warnings);
        for (var c of fragment.connections) {
            var from = inside.has(c.from.module) ? created.get(c.from.module) : this.patch.getModule(c.from.module) ? c.from.module : undefined;
            var to = created.get(c.to.module);
            if (from === undefined || to === undefined) continue;
            try {
                this.patch.connect({ module: from, port: c.from.port }, { module: to, port: c.to.port });
            } catch (e) {
                warnings.push(`connection ${from}:${c.from.port} -> ${to}:${c.to.port}: ${(e as Error).message}`);
            }
        }
        warnings.forEach((w) => console.warn("insert:", w));
        var copies = modules.map((m) => created.get(m.id)).filter((id): id is ModuleId => id !== undefined);
        this.patchView.select(copies);
        return copies;
    }

    // The clipboard of the scene: the last modules copied, as a patch file (also put in the system
    // clipboard, so that they can be pasted in another document, another tab, or saved as a patch).
    private fClipboard: string | null = null;
    // The last position of the pointer on the stage (stage coordinates): where a paste puts the modules.
    private fPointer: { x: number; y: number } | null = null;
    private fPastes = 0;

    // The selected modules as a patch file, kept as the clipboard: the connections between them only.
    copyModules(ids: ModuleId[]): string | null {
        var fragment = this.fragmentNow(ids, false);
        if (!fragment) return null;
        this.fClipboard = JSON.stringify(fragment);
        this.fPastes = 0;
        return this.fClipboard;
    }

    cutModules(ids: ModuleId[]): string | null {
        var text = this.copyModules(ids);
        if (text) this.deleteModules(ids);
        return text;
    }

    /*********************** CONTEXT MENU, SHORTCUTS ***************************/
    // A right click on a module acts on the selection (the module alone if it is not part of it);
    // on the empty stage, it pastes there, selects all, opens the modules, makes a new module (written in faustcode)
    // or imports a Faust file there. The same commands have shortcuts.
    private attachCommands(stage: HTMLElement): void {
        var t = () => Utilitary.messageResource;
        // keys typed in a text field, or in an Orbit (its keys: L, Delete of its presets, Esc), are not commands
        var editing = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.("input[type=text], input:not([type]), textarea, [contenteditable=true], .orbit-ui-root");
        stage.addEventListener("pointermove", (e) => { this.fPointer = this.toStage(e.clientX, e.clientY); });
        this.patchView.onOutputClick = (id, port, x, y) => this.outputPortMenu(id, port, x, y);
        stage.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            var at = this.toStage(e.clientX, e.clientY);
            // an output port: its menu (the speakers)
            var outputPort = (e.target as HTMLElement).closest?.(".port-output") as HTMLElement | null;
            if (outputPort?.dataset.module !== undefined && !outputPort.classList.contains("modulation-port")) {
                this.outputPortMenu(outputPort.dataset.module, Number(outputPort.dataset.port), e.clientX, e.clientY);
                return;
            }
            var id = this.patchView.moduleOf(e.target as Element);
            var paste: MenuItem = { label: t().menuPaste, shortcut: shortcut("mod+V"), action: () => this.pasteFromClipboard(at) };
            if (id === undefined) {
                showContextMenu(e.clientX, e.clientY, [
                    paste,
                    { label: t().menuSelectAll, shortcut: shortcut("mod+A"), enabled: this.fModuleList.length > 0, action: () => this.selectAll() },
                    "separator",
                    { label: t().menuModules, action: () => document.dispatchEvent(new CustomEvent("openmodules")) },
                    { label: t().menuNewModule, action: () => this.newModule(at) },
                    { label: t().menuImportDsp, action: () => this.importDsp(at) },
                ]);
                return;
            }
            if (this.patchView.getSelection().indexOf(id) < 0) this.patchView.select([id]);
            var selection = this.patchView.getSelection();
            var faust = selection.some((m) => this.patch.getModule(m)?.kind == "faust");
            var plugged = this.patch.getConnections().some((c) => selection.indexOf(c.from.module) >= 0 || selection.indexOf(c.to.module) >= 0);
            var orbitable = selection.map((m) => this.getModuleById(m)).filter((m): m is ModuleClass => !!m && m.canShowOrbit());
            var orbitShown = orbitable.length > 0 && orbitable.every((m) => m.orbit);
            var minimized = selection.map((m) => this.patch.getModule(m)?.kind == "faust" ? this.getModuleById(m) : undefined)
                .filter((m): m is ModuleClass => !!m).every((m) => m.moduleView.fInterfaceContainer.classList.contains("mini"));
            showContextMenu(e.clientX, e.clientY, [
                { label: t().menuCopy, shortcut: shortcut("mod+C"), enabled: faust, action: () => this.copyToClipboard(selection) },
                { label: t().menuCut, shortcut: shortcut("mod+X"), enabled: faust, action: () => { this.copyToClipboard(selection); this.deleteModules(selection); } },
                paste,
                { label: t().menuDuplicate, shortcut: shortcut("mod+D"), enabled: faust, action: () => this.duplicateModules(selection) },
                { label: t().menuDuplicateAlone, shortcut: shortcut("shift+mod+D"), enabled: faust, action: () => this.duplicateModules(selection, false) },
                "separator",
                { label: t().menuUnplug, enabled: plugged, action: () => this.unplugModules(selection) },
                { label: t().moduleToSpeakers, enabled: selection.some((m) => this.canReachSpeakers(m)), action: () => { this.step(() => this.toSpeakers(selection)) } },
                { label: t().moduleOffSpeakers, enabled: selection.some((m) => this.speakerConnections(m).length > 0), action: () => { this.step(() => this.offSpeakers(selection)) } },
                { label: minimized ? t().menuExpand : t().menuMinimize, enabled: faust, action: () => this.toggleMinimized(selection) },
                { label: orbitShown ? t().menuClassicInterface : t().menuOrbitInterface, enabled: orbitable.length > 0, action: () => this.toggleOrbit(selection) },
                "separator",
                // its code to a store in read and write (Documentation/STORE-SPEC.md, "Publier"): Main.ts
                this.publishMenuItem
                    ? this.publishMenuItem(t().publishModule, (store) => document.dispatchEvent(new CustomEvent("storepublishmodule", { detail: { module: selection[0], store } })), selection.length == 1 && faust)
                    : { label: t().publishModule, enabled: false },
                "separator",
                { label: t().menuDelete, shortcut: shortcut("Delete"), enabled: faust, action: () => this.deleteModules(selection) },
            ]);
        });
        document.addEventListener("keydown", (e) => {
            if (editing(e.target)) return;
            var selection = this.patchView.getSelection();
            if ((e.key == "Delete" || e.key == "Backspace") && selection.length > 0) {
                e.preventDefault();
                this.deleteModules(selection);
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == "a") {
                e.preventDefault();
                this.selectAll();
            }
        });
        // copy, cut, paste: the events of the browser, which give the system clipboard without asking
        document.addEventListener("copy", (e) => {
            if (editing(e.target) || !e.clipboardData) return;
            var text = this.copyModules(this.patchView.getSelection());
            if (!text) return;
            e.preventDefault();
            e.clipboardData.setData("text/plain", text);
        });
        document.addEventListener("cut", (e) => {
            if (editing(e.target) || !e.clipboardData) return;
            var selection = this.patchView.getSelection();
            var text = this.copyModules(selection);
            if (!text) return;
            e.preventDefault();
            e.clipboardData.setData("text/plain", text);
            this.deleteModules(selection);
        });
        document.addEventListener("paste", (e) => {
            if (editing(e.target)) return;
            var text = e.clipboardData?.getData("text/plain") || this.fClipboard;
            if (!text || !text.trim().startsWith("{")) return;
            e.preventDefault();
            this.pasteModules(text, this.fPointer);
        });
    }

    // From the menu: copies into the clipboard of the scene and into the system clipboard.
    private copyToClipboard(ids: ModuleId[]): void {
        var text = this.copyModules(ids);
        if (text) navigator.clipboard?.writeText(text).catch(() => { });
    }

    // From the menu: the system clipboard if it holds modules (copied in another tab), the clipboard
    // of the scene otherwise.
    private async pasteFromClipboard(at: { x: number; y: number }): Promise<void> {
        var text: string | null = null;
        try {
            text = (await navigator.clipboard?.readText()) ?? null;
        } catch {
            text = null;
        }
        if (text && (await this.pasteModules(text, at)).length > 0) return;
        await this.pasteModules(this.fClipboard, at);
    }

    hasClipboard(): boolean {
        return this.fClipboard != null;
    }

    // Pastes modules copied (a patch file as text, the clipboard of the scene by default): their top
    // left corner at `at` (stage coordinates), or offset from where they were copied. Returns the new
    // modules (none if the text is not modules), which become the selection.
    pasteModules(text: string | null = this.fClipboard, at: { x: number; y: number } | null = null): Promise<ModuleId[]> {
        return this.operation(async () => {
            if (!text) return [];
            var data: unknown;
            try {
                data = JSON.parse(text);
            } catch {
                return [];
            }
            if (!isPatchFileV2(data)) return [];
            var fragment = data as PatchFileV2;
            var faust = fragment.modules.filter((m) => m.kind == "faust");
            if (faust.length == 0) return [];
            var dx: number, dy: number;
            if (at) {
                dx = at.x - Math.min(...faust.map((m) => m.x));
                dy = at.y - Math.min(...faust.map((m) => m.y));
            } else {
                dx = dy = Scene.DUPLICATE_OFFSET * ++this.fPastes;
            }
            // only the connections between the pasted modules: the ids of another scene mean nothing here
            var ids = new Set(faust.map((m) => m.id));
            return this.insertFragment({ ...fragment, modules: faust, connections: fragment.connections.filter((c) => ids.has(c.from.module) && ids.has(c.to.module)) }, dx, dy);
        });
    }

    // Removes the Faust modules among `ids` (the physical input and output stay).
    deleteModules(ids: ModuleId[]): Promise<void> {
        return this.operation(async () => {
            for (var id of ids) {
                if (this.patch.getModule(id)?.kind != "faust") continue;
                this.getModuleById(id)?.deleteModule();
            }
            this.patchView.select([]);
        });
    }

    // Removes every connection to or from these modules (audio and modulation): their modulations
    // lose their sources and are removed.
    /*********************** SPEAKERS ***************************/
    // The menu of an output port (a click on it, or a right click): to the speakers or not, at once, without
    // drawing a cable to the output module, often far. Each command is one step of the history.

    // The connections of a module (of one of its outputs) to the speakers.
    speakerConnections(id: ModuleId, port?: number): Connection[] {
        return this.patch.getConnections().filter((c) => c.from.module == id && c.to.module == OUTPUT_ID && (port === undefined || c.from.port == port));
    }

    // A command of a menu, one step of the history of its own (two commands in a row are two steps, though
    // within the delay that groups the changes of a gesture).
    private async step(run: () => void): Promise<void> {
        await this.history.flush();
        run();
        await this.history.flush();
    }

    // Not the microphone: to the speakers, it would ring (Larsen).
    private canReachSpeakers(id: ModuleId): boolean {
        var state = this.patch.getModule(id);
        return !!state && state.kind == "faust" && state.numOutputs > 0 && !!this.patch.getModule(OUTPUT_ID);
    }

    // An output to these channels of the speakers: all connected if one is missing, all unplugged otherwise.
    toggleSpeakers(id: ModuleId, port: number, channels: number[]): void {
        var from = { module: id, port };
        var existing = channels.map((ch) => this.patch.findConnection(from, { module: OUTPUT_ID, port: ch }));
        if (existing.every((c) => c)) {
            existing.forEach((c) => this.patch.disconnect(c!.id));
        } else {
            channels.forEach((ch, i) => { if (!existing[i]) this.patch.connect(from, { module: OUTPUT_ID, port: ch }); });
        }
    }

    // All the outputs of modules to the speakers, as a cable dropped on the output module (the bus rule).
    toSpeakers(ids: ModuleId[]): void {
        for (var id of ids) if (this.canReachSpeakers(id)) this.patch.connectBus(id, OUTPUT_ID);
    }

    offSpeakers(ids: ModuleId[]): void {
        for (var id of ids) this.speakerConnections(id).forEach((c) => this.patch.disconnect(c.id));
    }

    // All the cables of an output.
    unplugOutput(id: ModuleId, port: number): void {
        this.patch.getConnections().filter((c) => c.from.module == id && c.from.port == port).forEach((c) => this.patch.disconnect(c.id));
    }

    outputPortMenu(id: ModuleId, port: number, clientX: number, clientY: number): void {
        var t = Utilitary.messageResource;
        var state = this.patch.getModule(id);
        var speakers = this.patch.getModule(OUTPUT_ID);
        if (!state) return;
        var reach = this.canReachSpeakers(id);
        var channels = speakers?.numInputs ?? 0;
        var on = (ch: number) => !!this.patch.findConnection({ module: id, port }, { module: OUTPUT_ID, port: ch });
        var item = (label: string, chs: number[]): MenuItem => ({ label, checked: chs.every(on), enabled: reach, action: () => { this.step(() => this.toggleSpeakers(id, port, chs)) } });
        var items: MenuItem[] = [];
        if (channels == 1) {
            items.push(item(t.speakerMono, [0]));
        } else if (channels >= 2) {
            items.push(item(t.speakersBoth, [0, 1]), item(t.speakerLeft, [0]), item(t.speakerRight, [1]));
            if (channels > 2) {
                var others = Array.from({ length: channels - 2 }, (_, k) => item(t.speakerChannel.replace("{n}", String(k + 3)), [k + 2]));
                items.push({ label: t.speakersOther, enabled: reach, items: others });
            }
        }
        items.push("separator", {
            label: t.unplugOutput,
            enabled: this.patch.getConnections().some((c) => c.from.module == id && c.from.port == port),
            action: () => { this.step(() => this.unplugOutput(id, port)) },
        });
        if (state.numOutputs > 1 && reach) {
            items.push("separator",
                { label: t.moduleToSpeakers, action: () => { this.step(() => this.toSpeakers([id])) } },
                { label: t.moduleOffSpeakers, enabled: this.speakerConnections(id).length > 0, action: () => { this.step(() => this.offSpeakers([id])) } });
        }
        showContextMenu(clientX, clientY, items);
    }

    unplugModules(ids: ModuleId[]): void {
        var chosen = new Set(ids);
        for (var c of this.patch.getConnections()) {
            if (chosen.has(c.from.module) || chosen.has(c.to.module)) this.patch.disconnect(c.id);
        }
    }

    // Minimizes the modules, or expands them if they all are minimized.
    toggleMinimized(ids: ModuleId[]): void {
        var modules = ids.map((id) => this.patch.getModule(id)?.kind == "faust" ? this.getModuleById(id) : undefined).filter((m): m is ModuleClass => !!m);
        var expand = modules.every((m) => m.moduleView.fInterfaceContainer.classList.contains("mini"));
        modules.forEach((m) => expand ? m.maxModule() : m.minModule());
    }

    // A Faust file (.dsp) chosen by the user becomes a module at a point of the stage (App.loadFile, "fileloadat").
    importDsp(at: { x: number; y: number }): void {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".dsp";
        input.addEventListener("change", () => {
            var file = input.files?.item(0);
            if (file) document.dispatchEvent(new CustomEvent("fileloadat", { detail: { file: file, x: at.x, y: at.y } }));
        });
        input.click();
    }

    selectAll(): void {
        this.patchView.select(this.fModuleList.map((m) => m.moduleId));
    }
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
            var reserved = syncInputs(module.moduleFaust.getSource()).length;
            var code = modulatedCode(module.moduleFaust.getSource(), state.numInputs, state.modulations.map((m) => m.spec), reserved);
            var container = module.moduleView.getModuleContainer();
            container.classList.add("compiling");
            var factory = await this.compile(state.name, code, state.x, state.y);
            container.classList.remove("compiling");
            if (!factory || !this.patch.getModule(id)) return false;
            var inputs = JSON.parse(factory.json).inputs;
            if (inputs != totalInputs(state) + reserved) {
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
    async compileModuleCode(module: ModuleClass, name: string, code: string, onError?: (error: string) => void): Promise<FaustDspFactory | null> {
        var state = module.moduleId !== undefined ? this.patch.getModule(module.moduleId) : undefined;
        var base = await this.compile(name, code, module.moduleView.x, module.moduleView.y, onError);
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
        var reserved = syncInputs(code).length;
        var factory = await this.compile(name, modulatedCode(code, json.inputs - reserved, state.modulations.map((m) => m.spec), reserved), module.moduleView.x, module.moduleView.y, onError);
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
            var factory = await this.compileModuleCode(module, name, code, (e) => { error = e });
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

    // A module made from the code of the user (faustcode, a new module) at a point of the stage (the center
    // of the window by default); the module, or why it could not be made (the error of the compiler).
    async addModuleFromCode(name: string, code: string, at?: { x: number; y: number }): Promise<ModuleClass | string> {
        name = name.replace(/\.dsp$/i, "").trim() || "Module";
        var position = at ?? this.positionDblTapModule();
        var wrapped = wrapModuleCode(name, code);
        var error = "";
        if (!(await this.compile(name, wrapped, position.x, position.y, (e) => { error = e }))) return error || "the code does not compile";
        var module = await this.createModule({ id: "", name, code: wrapped, x: position.x, y: position.y, params: {}, acc: [] });
        return module ?? "the module could not be created";
    }

    // A new module, at a point of the stage, opened in faustcode to be written.
    async newModule(at: { x: number; y: number }): Promise<void> {
        var module = await this.addModuleFromCode(Utilitary.messageResource.newModuleName, NEW_MODULE_CODE, at);
        if (typeof module != "string") this.faustcodeLink.edit(module);
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
                ? modulatedCode(description.code, description.numInputs ?? 0, modulations.map((m) => m.spec), syncInputs(description.code).length)
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
        var orbit = description.view?.orbit;
        if (orbit && module.setOrbit(orbit)) {
            this.patch.updateModule(module.moduleId, { view: { orbit: { width: orbit.width, height: orbit.height } } });
            this.patchView.refreshModule(module.moduleId);
        }
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
