/*				PATCHVIEW.TS
    Graphical view of the patch: ports of the modules, one SVG cable per connection,
    and the pointer interactions (mouse, touch and pen through Pointer Events):

    - drag a module by its body: the selected modules move with it. Their edges are pulled onto the
      edges of the other modules within 4 screen pixels (not with Alt), and each coincidence is shown
      as a thin line (Alignment.ts). Shift (or Ctrl, Cmd) and click
      adds a module to the selection or removes it; dragging on the empty stage draws a rectangle
      that selects the modules it touches; a click on the stage clears the selection;
    - drag from a port to start a cable, then release
        - on a port of the other direction: port-to-port connection,
        - on the body of another module: bus connection between the two modules (cyclic rule);
        - on a widget (from an output): modulates the widget with the mode of its kind ("modulate"
          for sliders, "add" for pitch sliders, "linear" for [mod:lin] sliders, "drive" for buttons and checkboxes; Documentation/widget-modulation/PLAN.md);
    - click on a cable to delete it.

    Each pointer is tracked separately (pointerId), so several cables can be drawn at once
    on a touch screen. Cables are redrawn when a module moves or changes size; cables closing
    a cycle (delayed in the audio graph) are dashed.

    Audio ports are astride the side edges, in a zone at the bottom of the modules, under the last
    widget: inputs on the left, outputs on the right. Each modulation has its own port, astride the
    left edge at the height of its widget: an
    icon shows its type and, for "modulate" and "add", a ring shows its depth (arc length = |depth|,
    clockwise when positive). Dragging such a port vertically sets the depth live (0.01 per pixel, 0.001
    with Shift, ten times more for "linear", whose deviation goes from −10 to 10); a double click sets it
    back to its default (0.5 for "modulate", 1 for "add" and "linear").
    Modulation cables end on these ports; dropping a cable on one adds a source to the modulation.
*/

import type { ModulationMode } from "../model/Modulation";
import { defaultDepth, depthRange, hasDepth } from "../model/Modulation";
import { align, Guide, Rect } from "./Alignment";
import { Connection, ConnectionId, ModuleId, Patch, PatchError, PatchEvent, PortRef } from "../model/Patch";
import type { ModuleClass } from "../Modules/ModuleClass";
import { Utilitary } from "../Utilitary";

export const MODE_SYMBOLS: Record<ModulationMode, string> = { modulate: "±", add: "+", linear: "~", scale: "×", drive: "→" };

// Stroke icons of the modulation types (24 x 24 viewBox, drawn with currentColor).
export const MODE_ICONS: Record<ModulationMode, string> = {
    modulate: "M12 4v9M7.5 8.5h9M7.5 19h9",       // ±
    add: "M12 6v12M6 12h12",                       // + the signal is added to the slider (a pitch)
    linear: "M3 12c2.5-7 6.5-7 9 0s6.5 7 9 0",     // ~ linear frequency modulation
    scale: "M7 7l10 10M17 7L7 17",                 // ×
    drive: "M4 12h14M13 7l5 5-5 5",                // → the signal drives the widget
};

// Modulation port geometry (px) and depth change per pixel of vertical drag (with Shift: fine).
const MODULATION_PORT_SIZE = 24;
const DEPTH_PER_PIXEL = 0.01;
const FINE_DEPTH_PER_PIXEL = 0.001;

// Direction in which a cable leaves a port: right for the outputs (right edge), left for the audio
// inputs and the modulation ports (left edge).
const RIGHT: Point = { x: 1, y: 0 };
const LEFT: Point = { x: -1, y: 0 };

// What the view needs from the scene to modulate widgets.
export interface ModulationHandler {
    allowedModes(module: ModuleId, widget: string): ModulationMode[];
    modulate(from: PortRef, module: ModuleId, widget: string, mode: ModulationMode): Promise<boolean>;
    // depth of a "modulate" modulation (undefined until its DSP exists), and its live change
    getDepth(module: ModuleId, modulation: string): number | undefined;
    setDepth(module: ModuleId, modulation: string, depth: number): void;
}

interface DepthDrag {
    module: ModuleId;
    modulation: string;
    port: HTMLElement;
    range: number;              // the depth goes from −range to range
    lastY: number;
    depth: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

type Dir = "in" | "out";

interface Point {
    x: number;
    y: number;
}

type DropTarget =
    | { kind: "port"; element: HTMLElement; module: ModuleId; port: number }
    | { kind: "bus"; element: HTMLElement; module: ModuleId }
    | { kind: "widget"; element: HTMLElement; module: ModuleId; widget: string };

const TARGET_CLASSES: Record<DropTarget["kind"], string | undefined> = {
    port: "port-target", bus: "bus-target", widget: "widget-target",
};

interface CableDrag {
    module: ModuleClass;
    dir: Dir;
    port: number;
    element: HTMLElement;
    path: SVGPathElement;
    target?: DropTarget;
}

interface ModuleDrag {
    clicked: ModuleClass;
    startX: number;
    startY: number;
    items: Array<{ module: ModuleClass; left: number; top: number }>;
    moved: boolean;
    rects: Rect[];              // the dragged modules where the drag started (stage coordinates)
    others: Rect[];             // the modules that stay: their edges are the alignment guides
}

// Alignment guides (Alignment.ts): magnetism threshold and length beyond the modules, in screen pixels.
const ALIGN_THRESHOLD = 4;
const ALIGN_EXTEND = 8;

interface BandDrag {
    startX: number;
    startY: number;
    element: HTMLDivElement;
    base: Set<ModuleId>;        // selection kept (Shift), the rectangle adds to it
}

// Elements of a module that keep their own pointer behaviour (controls, buttons, editor).
const INTERACTIVE = "input, textarea, select, button, a, .close, .minus, .max, .edit, .update, .duplicate, .display-grip";

export class PatchView {
    private fCables = new Map<ConnectionId, SVGPathElement>();
    private fDepthDrags = new Map<number, DepthDrag>();
    private fContainers = new Map<HTMLElement, ModuleId>();
    private fCableDrags = new Map<number, CableDrag>();
    private fModuleDrags = new Map<number, ModuleDrag>();
    private fResizeObserver?: ResizeObserver;

    constructor(private fPatch: Patch, private fSvg: SVGSVGElement, private fLookup: (id: ModuleId) => ModuleClass | undefined,
        private fModulation?: ModulationHandler) {
        fPatch.subscribe((event) => this.onPatchEvent(event));
        if (typeof ResizeObserver != "undefined") {
            this.fResizeObserver = new ResizeObserver((entries) => {
                entries.forEach((entry) => {
                    const id = this.fContainers.get(entry.target as HTMLElement);
                    if (id !== undefined) this.redrawModule(id);
                });
            });
        }
    }

    // Shows a module of the patch: ports, cables, pointer handlers. Called once the module is in the patch.
    /******************** SELECTION ********************/

    private fSelection = new Set<ModuleId>();
    private fBand?: { pointer: number; drag: BandDrag };

    getSelection(): ModuleId[] {
        return Array.from(this.fSelection);
    }

    // The module whose container holds this element (a Faust module, or the physical input or output).
    moduleOf(element: Element | null): ModuleId | undefined {
        for (let e = element; e; e = e.parentElement) {
            const id = this.fContainers.get(e as HTMLElement);
            if (id !== undefined) return id;
        }
        return undefined;
    }

    select(ids: Iterable<ModuleId>): void {
        const next = new Set(ids);
        this.fContainers.forEach((id, container) => container.classList.toggle("selected", next.has(id)));
        this.fSelection = next;
    }

    // The empty stage: a click clears the selection, a drag draws a selection rectangle.
    attachStage(stage: HTMLElement): void {
        stage.addEventListener("pointerdown", (e) => {
            if (e.pointerType == "mouse" && e.button != 0) return;
            const target = e.target as HTMLElement;
            if (target.closest(".moduleFaust, .port, .cable, #menuContainer, #dialogue, .modulation-port")) return;
            const additive = e.shiftKey || e.ctrlKey || e.metaKey;
            const band = document.createElement("div");
            band.className = "selection-band";
            document.body.appendChild(band);
            this.fBand = { pointer: e.pointerId, drag: { startX: e.clientX, startY: e.clientY, element: band, base: additive ? new Set(this.fSelection) : new Set() } };
            this.select(this.fBand.drag.base);
            stage.setPointerCapture(e.pointerId);
            this.moveBand(e);
        });
        stage.addEventListener("pointermove", (e) => {
            if (this.fBand?.pointer == e.pointerId) this.moveBand(e);
        });
        const end = (e: PointerEvent) => {
            if (this.fBand?.pointer != e.pointerId) return;
            this.fBand.drag.element.remove();
            this.fBand = undefined;
        };
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", end);
    }

    private moveBand(e: PointerEvent): void {
        const drag = this.fBand!.drag;
        const left = Math.min(drag.startX, e.clientX), top = Math.min(drag.startY, e.clientY);
        const right = Math.max(drag.startX, e.clientX), bottom = Math.max(drag.startY, e.clientY);
        Object.assign(drag.element.style, { left: left + "px", top: top + "px", width: (right - left) + "px", height: (bottom - top) + "px" });
        const inside = new Set(drag.base);
        this.fContainers.forEach((id, container) => {
            const r = container.getBoundingClientRect();
            if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) inside.add(id);
        });
        this.select(inside);
    }

    addModule(module: ModuleClass): void {
        const container = module.moduleView.getModuleContainer();
        this.fContainers.set(container, module.moduleId);
        this.renderPorts(module);
        container.addEventListener("pointerdown", (e) => this.onPointerDown(e, module));
        container.addEventListener("pointermove", (e) => this.onPointerMove(e));
        container.addEventListener("pointerup", (e) => this.onPointerUp(e, true));
        container.addEventListener("pointercancel", (e) => this.onPointerUp(e, false));
        this.fResizeObserver?.observe(container);
        this.markWidgets(module.moduleId);
        this.renderModulationPorts(module.moduleId);
        this.redrawModule(module.moduleId);
    }

    // Redraws the modulation ports (depth rings) and the cables of a module (undo/redo).
    refreshModule(id: ModuleId): void {
        if (!this.fLookup(id)) return;
        this.markWidgets(id);
        this.renderModulationPorts(id);
        this.redrawModule(id);
    }

    redrawModule(id: ModuleId): void {
        this.placeModulationPorts(id);
        this.fPatch.getConnections()
            .filter((c) => c.from.module == id || c.to.module == id)
            .forEach((c) => this.redrawCable(c));
    }

    redrawAll(): void {
        this.fPatch.getConnections().forEach((c) => this.redrawCable(c));
    }

    getCable(id: ConnectionId): SVGPathElement | undefined {
        return this.fCables.get(id);
    }

    /******************** PATCH EVENTS ********************/

    private onPatchEvent(event: PatchEvent): void {
        switch (event.type) {
            case "connectionAdded":
                this.addCable(event.connection);
                this.updateFeedbackStyle();
                break;
            case "connectionRemoved":
                this.fCables.get(event.connection.id)?.remove();
                this.fCables.delete(event.connection.id);
                this.updateFeedbackStyle();
                break;
            case "arityChanged":
            case "modulationsChanged": {
                const module = this.fLookup(event.module.id);
                if (module && this.isShown(module)) {
                    this.renderPorts(module);
                    this.markWidgets(event.module.id);
                    this.renderModulationPorts(event.module.id);
                    this.redrawModule(event.module.id);
                }
                break;
            }
            case "moduleRemoved":
                this.fSelection.delete(event.module.id);
                this.fContainers.forEach((id, container) => {
                    if (id == event.module.id) {
                        this.fResizeObserver?.unobserve(container);
                        this.fContainers.delete(container);
                    }
                });
                break;
        }
    }

    private isShown(module: ModuleClass): boolean {
        return this.fContainers.get(module.moduleView.getModuleContainer()) == module.moduleId;
    }

    private renderPorts(module: ModuleClass): void {
        const state = this.fPatch.getModule(module.moduleId);
        if (state) {
            module.moduleView.setPorts(module.moduleId, state.numInputs, state.numOutputs);
        }
    }

    /******************** CABLES ********************/

    private addCable(connection: Connection): void {
        const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
        const modulation = this.fPatch.modulationAt(connection.to.module, connection.to.port);
        path.setAttribute("class", modulation ? `cable modulation modulation-${modulation.spec.mode}` : "cable");
        path.dataset.connection = connection.id;
        path.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.fPatch.getConnection(connection.id)) {
                this.fPatch.disconnect(connection.id);
            }
        });
        this.fSvg.appendChild(path);
        this.fCables.set(connection.id, path);
        this.redrawCable(connection);
    }

    private redrawCable(connection: Connection): void {
        const path = this.fCables.get(connection.id);
        const from = this.fLookup(connection.from.module)?.moduleView.getPort("out", connection.from.port);
        if (!path || !from) return;
        const modulation = this.fPatch.getModule(connection.to.module) && this.fPatch.modulationAt(connection.to.module, connection.to.port);
        if (modulation) {
            // ends on the modulation port, next to the widget
            const port = this.modulationPort(connection.to.module, modulation.id);
            if (port) path.setAttribute("d", PatchView.curve(this.center(from), RIGHT, this.center(port), LEFT));
            return;
        }
        const to = this.fLookup(connection.to.module)?.moduleView.getPort("in", connection.to.port);
        if (to) {
            path.setAttribute("d", PatchView.curve(this.center(from), RIGHT, this.center(to), LEFT));
        }
    }

    private widgetElement(module: ModuleId, widget: string): HTMLElement | null {
        const container = this.fLookup(module)?.moduleView.getModuleContainer();
        return container ? container.querySelector(`[data-widget="${CSS.escape(widget)}"]`) : null;
    }

    // Marks the modulated widgets of a module (class "modulated" and the type of modulation).
    private markWidgets(id: ModuleId): void {
        const container = this.fLookup(id)?.moduleView.getModuleContainer();
        const state = this.fPatch.getModule(id);
        if (!container || !state) return;
        container.querySelectorAll("[data-widget]").forEach((element) =>
            element.classList.remove("modulated", "modulated-modulate", "modulated-add", "modulated-linear", "modulated-scale", "modulated-drive"));
        for (const modulation of state.modulations) {
            this.widgetElement(id, modulation.widget)?.classList.add("modulated", "modulated-" + modulation.spec.mode);
        }
    }

    /******************** MODULATION PORTS ********************/

    private modulationPort(module: ModuleId, modulation: string): HTMLElement | null {
        const container = this.fLookup(module)?.moduleView.getModuleContainer();
        return container ? container.querySelector(`.modulation-port[data-modulation="${CSS.escape(modulation)}"]`) : null;
    }

    // One port per modulation, with the icon of its type and the ring of its depth.
    private renderModulationPorts(id: ModuleId): void {
        const container = this.fLookup(id)?.moduleView.getModuleContainer();
        const state = this.fPatch.getModule(id);
        if (!container || !state) return;
        container.querySelectorAll(".modulation-port").forEach((port) => port.remove());
        container.classList.toggle("has-modulations", state.modulations.length > 0);
        state.modulations.forEach((modulation, i) => {
            const mode = modulation.spec.mode;
            const port = document.createElement("div");
            // has-depth: its depth (±, +, ~) is set by a vertical drag on the port
            port.className = `port port-input modulation-port modulation-${mode}` + (hasDepth(mode) ? " has-depth" : "");
            port.draggable = false;
            port.dataset.module = id;
            port.dataset.dir = "in";
            port.dataset.port = String(state.numInputs + i);
            port.dataset.modulation = modulation.id;
            port.style.width = port.style.height = MODULATION_PORT_SIZE + "px";
            const size = MODULATION_PORT_SIZE;
            const r = size / 2 - 1.5;
            port.innerHTML = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">`
                + `<circle class="depth-track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>`
                + `<circle class="depth-arc" cx="${size / 2}" cy="${size / 2}" r="${r}"/>`
                + `<g transform="translate(${size * 0.22} ${size * 0.22}) scale(${(size * 0.56) / 24})"><path class="mode-icon" d="${MODE_ICONS[mode]}"/></g>`
                + `</svg>`;
            if (hasDepth(mode)) {
                port.addEventListener("dblclick", (e) => {
                    e.stopPropagation();
                    this.fModulation?.setDepth(id, modulation.id, defaultDepth(mode));
                    this.showDepth(port, id, modulation.id);
                });
            }
            container.appendChild(port);
            this.showDepth(port, id, modulation.id);
        });
        this.placeModulationPorts(id);
    }

    // Each port astride the left edge of the module, at the height of its widget (of the title when
    // the widget is hidden: module minimized, code being edited).
    private placeModulationPorts(id: ModuleId): void {
        const view = this.fLookup(id)?.moduleView;
        const state = this.fPatch.getModule(id);
        if (!view || !state) return;
        const box = view.getModuleContainer().getBoundingClientRect();
        for (const modulation of state.modulations) {
            const port = this.modulationPort(id, modulation.id);
            if (!port) continue;
            const widget = this.widgetElement(id, modulation.widget);
            const rect = widget?.getBoundingClientRect();
            const anchor = rect && rect.width > 0 && rect.height > 0 ? rect : view.fTitle.getBoundingClientRect();
            port.style.left = (-MODULATION_PORT_SIZE / 2 - 1) + "px";
            port.style.top = ((anchor.top + anchor.height / 2 - box.top) / this.zoom - MODULATION_PORT_SIZE / 2) + "px";
        }
    }

    // Depth ring (and tooltip) of a modulation port.
    private showDepth(port: HTMLElement, id: ModuleId, modulationId: string): void {
        const modulation = this.fPatch.getModule(id)?.modulations.find((m) => m.id == modulationId);
        const arc = port.querySelector(".depth-arc") as SVGCircleElement | null;
        if (!modulation || !arc) return;
        const labels: Record<ModulationMode, string> = {
            modulate: Utilitary.messageResource.modulationModulate,
            add: Utilitary.messageResource.modulationAdd,
            linear: Utilitary.messageResource.modulationLinear,
            scale: Utilitary.messageResource.modulationScale,
            drive: Utilitary.messageResource.modulationDrive,
        };
        const title = `${MODE_SYMBOLS[modulation.spec.mode]} ${labels[modulation.spec.mode]}`;
        if (!hasDepth(modulation.spec.mode)) {
            port.title = title;
            return;
        }
        const depth = this.fModulation?.getDepth(id, modulationId);
        const size = MODULATION_PORT_SIZE;
        const circumference = 2 * Math.PI * (size / 2 - 1.5);
        const amount = depth === undefined ? 1 : Math.min(1, Math.abs(depth) / depthRange(modulation.spec.mode));
        arc.setAttribute("stroke-dasharray", `${amount * circumference} ${circumference}`);
        // from the top, clockwise for a positive depth, counterclockwise for a negative one
        arc.setAttribute("transform", (depth ?? 1) < 0
            ? `translate(${size} 0) scale(-1 1) rotate(-90 ${size / 2} ${size / 2})`
            : `rotate(-90 ${size / 2} ${size / 2})`);
        port.classList.toggle("negative", (depth ?? 1) < 0);
        port.dataset.depth = depth === undefined ? "" : depth.toFixed(3);
        port.title = `${title} : ${modulation.spec.mode == "linear" ? Utilitary.messageResource.modulationDeviation : Utilitary.messageResource.modulationDepth} ${depth === undefined ? "" : depth.toFixed(3)}\n${Utilitary.messageResource.modulationPortHint}`;
    }

    private updateFeedbackStyle(): void {
        const feedback = this.fPatch.analyze().feedback;
        this.fCables.forEach((path, id) => path.classList.toggle("feedback", feedback.has(id)));
    }

    // Center of an element in the coordinates of the SVG canvas.
    private center(element: Element): Point {
        const rect = element.getBoundingClientRect();
        return this.toCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    // The stage is scaled by the zoom (Scene.setView): its rectangles are on screen, its coordinates not.
    zoom = 1;

    // The rectangle of a module on the stage (its box, without the ports astride its edges).
    private stageRect(container: HTMLElement): Rect {
        const box = container.getBoundingClientRect();
        const a = this.toCanvas(box.left, box.top), b = this.toCanvas(box.right, box.bottom);
        return { left: a.x, top: a.y, right: b.x, bottom: b.y };
    }

    // The alignment guides of a module drag: thin lines in the cable layer.
    private fGuides?: SVGGElement;

    private showGuides(guides: Guide[]): void {
        if (guides.length == 0 && !this.fGuides?.firstChild) return;
        if (!this.fGuides) {
            this.fGuides = document.createElementNS(SVG_NS, "g") as SVGGElement;
            this.fGuides.setAttribute("class", "alignment-guides");
        }
        if (this.fGuides.parentNode !== this.fSvg) this.fSvg.appendChild(this.fGuides);
        this.fGuides.replaceChildren(...guides.map((g) => {
            const line = document.createElementNS(SVG_NS, "line");
            line.setAttribute("class", "alignment-guide");
            const [x1, y1, x2, y2] = g.axis == "x" ? [g.at, g.from, g.at, g.to] : [g.from, g.at, g.to, g.at];
            line.setAttribute("x1", String(x1));
            line.setAttribute("y1", String(y1));
            line.setAttribute("x2", String(x2));
            line.setAttribute("y2", String(y2));
            return line;
        }));
    }

    private toCanvas(clientX: number, clientY: number): Point {
        const svgRect = this.fSvg.getBoundingClientRect();
        return { x: (clientX - svgRect.left) / this.zoom, y: (clientY - svgRect.top) / this.zoom };
    }

    // Cable from a to b, leaving a in the direction da and b in the direction db: two audio ports
    // (both down) give a hanging cable, as with patch cords. A zero direction (the pointer end of a
    // cable being drawn) has no tangent.
    static curve(a: Point, da: Point, b: Point, db: Point): string {
        const c = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2);
        return `M${a.x},${a.y} C${a.x + da.x * c},${a.y + da.y * c} ${b.x + db.x * c},${b.y + db.y * c} ${b.x},${b.y}`;
    }

    private static direction(port: HTMLElement): Point {
        return port.classList.contains("port-output") ? RIGHT : LEFT;
    }

    /******************** POINTER INTERACTIONS ********************/

    private onPointerDown(e: PointerEvent, module: ModuleClass): void {
        if (e.pointerType == "mouse" && e.button != 0) return;
        const target = e.target as HTMLElement;
        const port = target.closest(".port") as HTMLElement | null;
        if (port && port.dataset.module == module.moduleId && port.classList.contains("has-depth")) {
            this.startDepthDrag(e, module, port);
        } else if (port && port.dataset.module == module.moduleId) {
            this.startCableDrag(e, module, port);
        } else if (!target.closest(INTERACTIVE)) {
            this.startModuleDrag(e, module);
        }
    }

    // Vertical drag on a port with a depth: from −1 to 1 (−10 to 10 for "linear"; up increases), live.
    private startDepthDrag(e: PointerEvent, module: ModuleClass, port: HTMLElement): void {
        e.stopPropagation();
        e.preventDefault();
        const modulation = port.dataset.modulation!;
        const depth = this.fModulation?.getDepth(module.moduleId, modulation);
        if (depth === undefined) return;        // module being recompiled
        port.setPointerCapture(e.pointerId);
        port.classList.add("adjusting");
        const mode = this.fPatch.getModule(module.moduleId)?.modulations.find((m) => m.id == modulation)?.spec.mode ?? "modulate";
        this.fDepthDrags.set(e.pointerId, { module: module.moduleId, modulation, port, range: depthRange(mode), lastY: e.clientY, depth });
    }

    private onPointerMove(e: PointerEvent): void {
        const depthDrag = this.fDepthDrags.get(e.pointerId);
        if (depthDrag) {
            // by steps from the previous position, so that pressing or releasing Shift does not jump
            // the same drag covers the range of the mode (−1..1, or −10..10 for a linear modulation)
            const range = depthDrag.range;
            const rate = (e.shiftKey ? FINE_DEPTH_PER_PIXEL : DEPTH_PER_PIXEL) * range;
            depthDrag.depth = Math.max(-range, Math.min(range, depthDrag.depth + (depthDrag.lastY - e.clientY) * rate));
            depthDrag.lastY = e.clientY;
            this.fModulation?.setDepth(depthDrag.module, depthDrag.modulation, Math.round(depthDrag.depth * 1000) / 1000);
            this.showDepth(depthDrag.port, depthDrag.module, depthDrag.modulation);
            return;
        }
        const moduleDrag = this.fModuleDrags.get(e.pointerId);
        if (moduleDrag) {
            const rawX = (e.clientX - moduleDrag.startX) / this.zoom, rawY = (e.clientY - moduleDrag.startY) / this.zoom;
            moduleDrag.moved ||= Math.abs(rawX) + Math.abs(rawY) > 2 / this.zoom;
            // pulled onto the edges of the other modules (not with Alt), the coincidences shown
            const { dx, dy, guides } = moduleDrag.moved
                ? align(moduleDrag.rects, moduleDrag.others, rawX, rawY, { threshold: ALIGN_THRESHOLD / this.zoom, snap: !e.altKey, epsilon: 0.5 / this.zoom, extend: ALIGN_EXTEND / this.zoom })
                : { dx: rawX, dy: rawY, guides: [] };
            this.showGuides(guides);
            for (const item of moduleDrag.items) {
                const view = item.module.moduleView;
                view.x = item.left + dx;
                view.y = item.top + dy;
                view.getModuleContainer().style.left = view.x + "px";
                view.getModuleContainer().style.top = view.y + "px";
                this.redrawModule(item.module.moduleId);
            }
        }
        const cableDrag = this.fCableDrags.get(e.pointerId);
        if (cableDrag) {
            this.moveCable(cableDrag, e);
        }
    }

    private onPointerUp(e: PointerEvent, commit: boolean): void {
        const depthDrag = this.fDepthDrags.get(e.pointerId);
        if (depthDrag) {
            this.fDepthDrags.delete(e.pointerId);
            depthDrag.port.classList.remove("adjusting");
            return;
        }
        const moduleDrag = this.fModuleDrags.get(e.pointerId);
        if (moduleDrag) {
            this.fModuleDrags.delete(e.pointerId);
            this.showGuides([]);
            if (moduleDrag.moved) {
                for (const item of moduleDrag.items) {
                    const view = item.module.moduleView;
                    if (this.fPatch.getModule(item.module.moduleId)) {
                        this.fPatch.updateModule(item.module.moduleId, { x: view.x, y: view.y });
                    }
                }
            } else {
                this.select([moduleDrag.clicked.moduleId]);     // a click selects this module only
            }
        }
        const cableDrag = this.fCableDrags.get(e.pointerId);
        if (cableDrag) {
            this.fCableDrags.delete(e.pointerId);
            if (commit) {
                this.setTarget(cableDrag, this.findTarget(cableDrag, e));
                this.connect(cableDrag);
            }
            this.setTarget(cableDrag, undefined);
            cableDrag.path.remove();
        }
    }

    private startModuleDrag(e: PointerEvent, module: ModuleClass): void {
        const id = module.moduleId;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // adds the module to the selection or removes it
            const next = new Set(this.fSelection);
            if (next.has(id)) next.delete(id); else next.add(id);
            this.select(next);
            return;
        }
        if (!this.fSelection.has(id)) this.select([id]);
        const container = module.moduleView.getModuleContainer();
        container.setPointerCapture(e.pointerId);
        const items = Array.from(this.fSelection)
            .map((sid) => this.fLookup(sid))
            .filter((m): m is ModuleClass => m !== undefined)
            .map((m) => ({ module: m, left: parseFloat(m.moduleView.getModuleContainer().style.left) || 0, top: parseFloat(m.moduleView.getModuleContainer().style.top) || 0 }));
        // the rectangles of the modules, on the stage: the dragged ones, and the others
        const moving = new Set(items.map((item) => item.module.moduleView.getModuleContainer()));
        const rects: Rect[] = [], others: Rect[] = [];
        this.fContainers.forEach((_, container) => {
            if (!container.isConnected) return;
            (moving.has(container) ? rects : others).push(this.stageRect(container));
        });
        this.fModuleDrags.set(e.pointerId, { clicked: module, startX: e.clientX, startY: e.clientY, items, moved: false, rects, others });
    }

    private startCableDrag(e: PointerEvent, module: ModuleClass, port: HTMLElement): void {
        e.stopPropagation();
        port.setPointerCapture(e.pointerId);
        const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
        path.setAttribute("class", "cable dragging");
        this.fSvg.appendChild(path);
        const drag: CableDrag = { module, dir: port.dataset.dir as Dir, port: Number(port.dataset.port), element: port, path };
        this.fCableDrags.set(e.pointerId, drag);
        this.moveCable(drag, e);
    }

    private moveCable(drag: CableDrag, e: PointerEvent): void {
        const start = this.center(drag.element);
        const pointer = this.toCanvas(e.clientX, e.clientY);
        const none: Point = { x: 0, y: 0 };
        const leaving = PatchView.direction(drag.element);
        drag.path.setAttribute("d", drag.dir == "out" ? PatchView.curve(start, leaving, pointer, none) : PatchView.curve(pointer, none, start, leaving));
        const target = this.findTarget(drag, e);
        this.setTarget(drag, target);
    }

    // What is under the pointer: a port of the other direction, or the body of another module
    // that has ports of the other direction.
    private findTarget(drag: CableDrag, e: PointerEvent): DropTarget | undefined {
        const element = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        if (!element) return undefined;
        const port = element.closest(".port") as HTMLElement | null;
        if (port) {
            return port.dataset.dir != drag.dir
                ? { kind: "port", element: port, module: port.dataset.module!, port: Number(port.dataset.port) }
                : undefined;
        }
        if (drag.dir == "out") {
            const widget = element.closest("[data-widget]") as HTMLElement | null;
            const owner = widget?.closest(".moduleFaust") as HTMLElement | null;
            const module = owner ? this.fContainers.get(owner) : undefined;
            if (widget && module !== undefined && (this.fModulation?.allowedModes(module, widget.dataset.widget!).length ?? 0) > 0) {
                return { kind: "widget", element: widget, module, widget: widget.dataset.widget! };
            }
        }
        const container = element.closest(".moduleFaust") as HTMLElement | null;
        const id = container ? this.fContainers.get(container) : undefined;
        const state = id !== undefined ? this.fPatch.getModule(id) : undefined;
        if (container && state && id != drag.module.moduleId && (drag.dir == "out" ? state.numInputs : state.numOutputs) > 0) {
            return { kind: "bus", element: container, module: id! };
        }
        return undefined;
    }

    private setTarget(drag: CableDrag, target: DropTarget | undefined): void {
        const before = drag.target && TARGET_CLASSES[drag.target.kind];
        if (drag.target && before && drag.target.element !== target?.element) {
            drag.target.element.classList.remove(before);
        }
        const after = target && TARGET_CLASSES[target.kind];
        if (target && after) {
            target.element.classList.add(after);
        }
        drag.target = target;
    }

    private connect(drag: CableDrag): void {
        const target = drag.target;
        if (!target) return;
        const self = drag.module.moduleId;
        if (target.kind == "widget") {
            // the mode of the widget's kind (Modulation.allowedModes): no choice to make
            const [mode] = this.fModulation?.allowedModes(target.module, target.widget) ?? [];
            if (mode) this.fModulation?.modulate({ module: self, port: drag.port }, target.module, target.widget, mode);
            return;
        }
        try {
            if (target.kind == "port") {
                const here = { module: self, port: drag.port };
                const there = { module: target.module, port: target.port };
                if (drag.dir == "out") {
                    this.fPatch.connect(here, there);
                } else {
                    this.fPatch.connect(there, here);
                }
            } else if (drag.dir == "out") {
                this.fPatch.connectBus(self, target.module);
            } else {
                this.fPatch.connectBus(target.module, self);
            }
        } catch (error) {
            // already connected: nothing to do
            if (!(error instanceof PatchError)) throw error;
        }
    }
}
