/*				PATCHVIEW.TS
    Graphical view of the patch: ports of the modules, one SVG cable per connection,
    and the pointer interactions (mouse, touch and pen through Pointer Events):

    - drag a module by its body;
    - drag from a port to start a cable, then release
        - on a port of the other direction: port-to-port connection,
        - on the body of another module: bus connection between the two modules (cyclic rule);
    - click on a cable to delete it.

    Each pointer is tracked separately (pointerId), so several cables can be drawn at once
    on a touch screen. Cables are redrawn when a module moves or changes size; cables closing
    a cycle (delayed in the audio graph) are dashed.
*/

import { Connection, ConnectionId, ModuleId, Patch, PatchError, PatchEvent } from "../model/Patch";
import type { ModuleClass } from "../Modules/ModuleClass";

const SVG_NS = "http://www.w3.org/2000/svg";

type Dir = "in" | "out";

interface Point {
    x: number;
    y: number;
}

type DropTarget =
    | { kind: "port"; element: HTMLElement; module: ModuleId; port: number }
    | { kind: "bus"; element: HTMLElement; module: ModuleId };

interface CableDrag {
    module: ModuleClass;
    dir: Dir;
    port: number;
    element: HTMLElement;
    path: SVGPathElement;
    target?: DropTarget;
}

interface ModuleDrag {
    module: ModuleClass;
    startX: number;
    startY: number;
    left: number;
    top: number;
}

// Elements of a module that keep their own pointer behaviour (controls, buttons, editor).
const INTERACTIVE = "input, textarea, select, button, a, .close, .minus, .max, .edit";

export class PatchView {
    private fCables = new Map<ConnectionId, SVGPathElement>();
    private fContainers = new Map<HTMLElement, ModuleId>();
    private fCableDrags = new Map<number, CableDrag>();
    private fModuleDrags = new Map<number, ModuleDrag>();
    private fResizeObserver?: ResizeObserver;

    constructor(private fPatch: Patch, private fSvg: SVGSVGElement, private fLookup: (id: ModuleId) => ModuleClass | undefined) {
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
    addModule(module: ModuleClass): void {
        const container = module.moduleView.getModuleContainer();
        this.fContainers.set(container, module.moduleId);
        this.renderPorts(module);
        container.addEventListener("pointerdown", (e) => this.onPointerDown(e, module));
        container.addEventListener("pointermove", (e) => this.onPointerMove(e));
        container.addEventListener("pointerup", (e) => this.onPointerUp(e, true));
        container.addEventListener("pointercancel", (e) => this.onPointerUp(e, false));
        this.fResizeObserver?.observe(container);
        this.redrawModule(module.moduleId);
    }

    redrawModule(id: ModuleId): void {
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
            case "arityChanged": {
                const module = this.fLookup(event.module.id);
                if (module && this.isShown(module)) {
                    this.renderPorts(module);
                    this.redrawModule(event.module.id);
                }
                break;
            }
            case "moduleRemoved":
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
        path.setAttribute("class", "cable");
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
        const to = this.fLookup(connection.to.module)?.moduleView.getPort("in", connection.to.port);
        if (path && from && to) {
            path.setAttribute("d", PatchView.curve(this.center(from), this.center(to)));
        }
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

    private toCanvas(clientX: number, clientY: number): Point {
        const svgRect = this.fSvg.getBoundingClientRect();
        return { x: clientX - svgRect.left, y: clientY - svgRect.top };
    }

    // Horizontal tangents at both ends, also for cables going backwards.
    static curve(a: Point, b: Point): string {
        const c = Math.max(40, Math.abs(b.x - a.x) / 2);
        return `M${a.x},${a.y} C${a.x + c},${a.y} ${b.x - c},${b.y} ${b.x},${b.y}`;
    }

    /******************** POINTER INTERACTIONS ********************/

    private onPointerDown(e: PointerEvent, module: ModuleClass): void {
        if (e.pointerType == "mouse" && e.button != 0) return;
        const target = e.target as HTMLElement;
        const port = target.closest(".port") as HTMLElement | null;
        if (port && port.dataset.module == module.moduleId) {
            this.startCableDrag(e, module, port);
        } else if (!target.closest(INTERACTIVE)) {
            this.startModuleDrag(e, module);
        }
    }

    private onPointerMove(e: PointerEvent): void {
        const moduleDrag = this.fModuleDrags.get(e.pointerId);
        if (moduleDrag) {
            const view = moduleDrag.module.moduleView;
            view.x = moduleDrag.left + e.clientX - moduleDrag.startX;
            view.y = moduleDrag.top + e.clientY - moduleDrag.startY;
            view.getModuleContainer().style.left = view.x + "px";
            view.getModuleContainer().style.top = view.y + "px";
            this.redrawModule(moduleDrag.module.moduleId);
        }
        const cableDrag = this.fCableDrags.get(e.pointerId);
        if (cableDrag) {
            this.moveCable(cableDrag, e);
        }
    }

    private onPointerUp(e: PointerEvent, commit: boolean): void {
        const moduleDrag = this.fModuleDrags.get(e.pointerId);
        if (moduleDrag) {
            this.fModuleDrags.delete(e.pointerId);
            const view = moduleDrag.module.moduleView;
            if (this.fPatch.getModule(moduleDrag.module.moduleId)) {
                this.fPatch.updateModule(moduleDrag.module.moduleId, { x: view.x, y: view.y });
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
        const container = module.moduleView.getModuleContainer();
        container.setPointerCapture(e.pointerId);
        this.fModuleDrags.set(e.pointerId, {
            module,
            startX: e.clientX,
            startY: e.clientY,
            left: parseFloat(container.style.left) || 0,
            top: parseFloat(container.style.top) || 0,
        });
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
        drag.path.setAttribute("d", drag.dir == "out" ? PatchView.curve(start, pointer) : PatchView.curve(pointer, start));
        this.setTarget(drag, this.findTarget(drag, e));
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
        const container = element.closest(".moduleFaust") as HTMLElement | null;
        const id = container ? this.fContainers.get(container) : undefined;
        const state = id !== undefined ? this.fPatch.getModule(id) : undefined;
        if (container && state && id != drag.module.moduleId && (drag.dir == "out" ? state.numInputs : state.numOutputs) > 0) {
            return { kind: "bus", element: container, module: id! };
        }
        return undefined;
    }

    private setTarget(drag: CableDrag, target: DropTarget | undefined): void {
        if (drag.target && drag.target.element !== target?.element) {
            drag.target.element.classList.remove(drag.target.kind == "port" ? "port-target" : "bus-target");
        }
        if (target) {
            target.element.classList.add(target.kind == "port" ? "port-target" : "bus-target");
        }
        drag.target = target;
    }

    private connect(drag: CableDrag): void {
        const target = drag.target;
        if (!target) return;
        const self = drag.module.moduleId;
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
