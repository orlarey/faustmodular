/*				ORBITPANEL.TS
    The Orbit interface of a module (faust-orbit-ui, https://github.com/orlarey/faust-orbit-ui): each input
    widget is a point around a centre, its value set by its distance to the centre; moving the centre moves
    them all. It replaces the classic interface of the module when chosen (ModuleClass.setOrbit), in a frame
    resized by a grip at its bottom right corner.

    The values stay those of the controllers of the module (one source of truth): a gesture in the Orbit
    sets them as a slider does (DSP, saving, history), and the host pushes them back after an undo or a
    recall (sync).

    Two workarounds of faust-orbit-ui 0.4.1 (to remove when the library handles a zoomed host):
    - the stage of faustmodular is zoomed by a CSS transform: the library reads the pointer in screen
      pixels (getBoundingClientRect) but draws in CSS pixels. The five methods that read the pointer are
      wrapped so that they get it in CSS pixels;
    - its dropdown menus are fixed elements placed in screen pixels, inside the zoomed stage (the
      containing block of a fixed element under a transform): they are moved to the stage's coordinates.
*/

import { OrbitUI } from "faust-orbit-ui";
import { isHidden, metaValue, UIItem } from "../model/UILayout";
import { DEPTH_METADATA, DRIVEN_METADATA } from "../model/Modulation";

export interface OrbitSettings {
    width: number;
    height: number;
    state?: unknown;            // positions of the points, zoom, centre (OrbitUI.getOrbitState)
}

export interface OrbitHost {
    values(): Record<string, number>;               // the values of the input widgets
    setValue(address: string, value: number): void; // a gesture in the Orbit
    gesture(active: boolean): void;                 // a gesture begins or ends
    changed(): void;                                // its size or its layout changed
}

export const ORBIT_SIZE = { width: 360, height: 360, minWidth: 260, minHeight: 240, maxWidth: 1200, maxHeight: 1000 };

const INPUTS = ["hslider", "vslider", "nentry", "button", "checkbox"];

// The widgets the Orbit shows: the input widgets of the user, not the depths of the modulations, the
// driven bargraphs, the hidden widgets, nor the bargraphs (displays of the classic interface).
export function orbitDescriptor(ui: UIItem[]): UIItem[] {
    const keep = (item: UIItem): UIItem | null => {
        if (item.items) {
            const items = item.items.map(keep).filter((x): x is UIItem => x != null);
            return items.length > 0 ? { ...item, items } : null;
        }
        if (!INPUTS.includes(item.type) || isHidden(item)) return null;
        if (metaValue(item, DEPTH_METADATA) !== undefined || metaValue(item, DRIVEN_METADATA) !== undefined) return null;
        return item;
    };
    return ui.map(keep).filter((x): x is UIItem => x != null);
}

export function hasOrbitWidgets(ui: UIItem[]): boolean {
    return orbitDescriptor(ui).length > 0;
}

// Screen pixels of an element per CSS pixel (the zoom of the stage).
function scaleOf(element: Element): number {
    const width = (element as HTMLElement).offsetWidth;
    const scale = width > 0 ? element.getBoundingClientRect().width / width : 1;
    return scale > 0 && isFinite(scale) ? scale : 1;
}

// A point of the screen, moved so that its distance to the corner of the element is in CSS pixels.
function unzoom(element: Element, x: number, y: number): [number, number] {
    const r = element.getBoundingClientRect();
    const s = scaleOf(element);
    return [r.left + (x - r.left) / s, r.top + (y - r.top) / s];
}

export class OrbitPanel {
    readonly element: HTMLElement;      // the frame: the host of the Orbit and the grip
    private fHostElement: HTMLElement;
    private fOrbit: OrbitUI;
    private fSyncing = false;
    private fObserver: MutationObserver;

    // `mount` puts the frame in the page: the Orbit measures its place when it is made.
    constructor(private fUi: UIItem[], private fHost: OrbitHost, settings: OrbitSettings, mount: (frame: HTMLElement) => void) {
        this.element = document.createElement("div");
        this.element.className = "orbit-frame";
        this.fHostElement = document.createElement("div");
        this.fHostElement.className = "orbit-host";
        this.element.style.width = settings.width + "px";
        this.element.style.height = settings.height + "px";
        const grip = document.createElement("div");
        grip.className = "display-grip orbit-grip";
        this.element.append(this.fHostElement, grip);
        this.attachGrip(grip);
        mount(this.element);

        const descriptor = orbitDescriptor(fUi);
        this.fOrbit = new OrbitUI(this.fHostElement, {
            uiDescriptor: descriptor,
            onParamChange: (path, value) => this.fHost.setValue(path, value),
            onInteractionStart: () => this.fHost.gesture(true),
            onInteractionEnd: () => this.fHost.gesture(false),
            onOrbitStateChange: () => { if (!this.fSyncing) this.fHost.changed() },
        });
        this.unzoomPointer();
        this.fObserver = new MutationObserver((records) => this.placeMenus(records));
        this.fObserver.observe((this.fOrbit as any).shadow, { childList: true, subtree: true });
        // the layout of the points: the saved one, or one made for the size of the frame
        this.fSyncing = true;
        this.fOrbit.resize();
        this.fOrbit.beginUpdate();
        try {
            let state: any = this.fOrbit.buildControlsFromUnknown(descriptor);
            if (settings.state && typeof settings.state == "object") state = { ...state, ...(settings.state as any) };
            this.fOrbit.setOrbitState(state);
        } catch (e) {
            console.warn("orbit: saved layout ignored", e);
        } finally {
            this.fOrbit.endUpdate();
            this.fSyncing = false;
        }
        this.sync();
    }

    get orbit(): OrbitUI {
        return this.fOrbit;
    }

    get host(): HTMLElement {
        return this.fHostElement;
    }

    // The values of the controllers shown in the Orbit (after an undo, a recall, a change elsewhere).
    sync(): void {
        this.fSyncing = true;
        try {
            this.fOrbit.setParams(this.fHost.values());
        } finally {
            this.fSyncing = false;
        }
    }

    settings(): OrbitSettings {
        return { width: this.element.offsetWidth || parseFloat(this.element.style.width), height: this.element.offsetHeight || parseFloat(this.element.style.height), state: this.fOrbit.getOrbitState() };
    }

    setSize(width: number, height: number): void {
        this.element.style.width = width + "px";
        this.element.style.height = height + "px";
        this.fOrbit.resize();
    }

    // The widget whose point is under a point of the screen (a cable dropped on it), or null.
    widgetAt(clientX: number, clientY: number): string | null {
        const inner = (this.fOrbit as any).inner;
        if (!inner?._pointerPosition || !inner._hitTest) return null;
        const p = inner._pointerPosition({ clientX, clientY });
        const hit = inner._hitTest(p.x, p.y);
        return hit && hit.mode == "slider" && hit.path ? hit.path : null;
    }

    destroy(): void {
        this.fObserver.disconnect();
        this.fOrbit.destroy();
        this.element.remove();
    }

    // The pointer read by the Orbit in CSS pixels (the stage is zoomed): see the header.
    private unzoomPointer(): void {
        const inner = (this.fOrbit as any).inner;
        if (inner && typeof inner._pointerPosition == "function") {
            const position = inner._pointerPosition;
            inner._pointerPosition = (event: { clientX: number; clientY: number }) => {
                const [x, y] = unzoom(inner.canvas, event.clientX, event.clientY);
                return position.call(inner, { clientX: x, clientY: y });
            };
        }
        const calque = (this.fOrbit as any).calque;
        for (const name of ["canvasToProj", "hitTestPreset", "hitTestCentre", "canvasPoint"]) {
            const method = calque?.[name];
            if (typeof method != "function") continue;
            calque[name] = (clientX: number, clientY: number) => method.call(calque, ...unzoom(calque.canvas, clientX, clientY));
        }
    }

    // A dropdown menu of the Orbit opened: from screen pixels to the coordinates of the zoomed stage.
    private placeMenus(records: MutationRecord[]): void {
        for (const record of records) {
            record.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement) || !node.classList.contains("orbit-dropdown-menu")) return;
                let block: HTMLElement | null = this.fHostElement.parentElement;
                while (block && getComputedStyle(block).transform == "none") block = block.parentElement;
                if (!block) return;
                const r = block.getBoundingClientRect();
                const s = scaleOf(block);
                const left = parseFloat(node.style.left), top = parseFloat(node.style.top);
                if (!isNaN(left)) node.style.left = (left - r.left) / s + "px";
                if (!isNaN(top)) node.style.top = (top - r.top) / s + "px";
                const min = parseFloat(node.style.minWidth);
                if (!isNaN(min)) node.style.minWidth = min / s + "px";
            });
        }
    }

    private attachGrip(grip: HTMLElement): void {
        grip.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            grip.setPointerCapture(e.pointerId);
            const scale = scaleOf(this.element);
            const start = { x: e.clientX, y: e.clientY, width: this.element.offsetWidth, height: this.element.offsetHeight };
            const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
            const move = (m: PointerEvent) => {
                this.setSize(clamp(start.width + (m.clientX - start.x) / scale, ORBIT_SIZE.minWidth, ORBIT_SIZE.maxWidth),
                    clamp(start.height + (m.clientY - start.y) / scale, ORBIT_SIZE.minHeight, ORBIT_SIZE.maxHeight));
            };
            const end = () => {
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("pointerup", end);
                grip.removeEventListener("pointercancel", end);
                this.fHost.changed();
            };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", end);
            grip.addEventListener("pointercancel", end);
        });
    }
}
