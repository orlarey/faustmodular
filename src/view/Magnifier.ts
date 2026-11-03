/*				MAGNIFIER.TS
    The magnifier of the modules, as the Dock of macOS: when the stage is zoomed out (under 75 %), the module
    under the pointer is shown at its real size (100 % on the screen) after 250 ms, above the others, without
    moving them. It is the module itself, scaled: its widgets, its value fields, its Orbit work; its cables
    and ports follow it. The point under the pointer stays in place; the module is moved back into the window
    if it would leave it, and made smaller if it would not fit.

    It stays while the pointer is on it and goes back when the pointer leaves it. While a button is pressed (a
    slider moved, a module moved, a selection drawn) nothing changes, except while a cable is drawn: the
    module under the cable is magnified, so that its widgets can be aimed at. A module moved is no longer
    magnified (Patchview), as when the stage is zoomed or moved.
*/

export const MAGNIFY_BELOW = 0.75;      // the zoom of the stage under which the modules are magnified
export const MAGNIFY_DELAY = 250;       // ms on a module before it is magnified
const MARGIN = 8;                       // px between a magnified module and the edges of the window
const TOP = 48;                         // px of the toolbar, not covered
const GLIDE = 120;                      // ms of the change of size

export interface MagnifierHost {
    zoom(): number;                                         // of the stage
    containerAt(clientX: number, clientY: number): HTMLElement | null;  // the module under a point
    state(): "free" | "frozen" | "cable";                   // a drag of the stage: nothing changes, but a cable
    redraw(container: HTMLElement): void;                   // its ports and cables, where it is shown
}

export class Magnifier {
    private fActive: HTMLElement | null = null;
    private fCandidate: HTMLElement | null = null;
    private fTimer = 0;
    private fLast = { x: 0, y: 0 };
    private fButtons = 0;

    constructor(private fHost: MagnifierHost) {
        document.addEventListener("pointermove", (e) => {
            if (e.pointerType == "touch") return;
            this.fLast = { x: e.clientX, y: e.clientY };
            this.fButtons = e.buttons;
            this.update();
        }, true);
        document.addEventListener("pointerleave", () => this.release());
        window.addEventListener("blur", () => this.release());
    }

    get active(): HTMLElement | null {
        return this.fActive;
    }

    // The magnified module goes back, and nothing is waiting; at once (instant) when its place is about to be
    // read (a module moved, the view changed).
    release(instant = false): void {
        this.cancel();
        this.shrink(instant);
    }

    private cancel(): void {
        window.clearTimeout(this.fTimer);
        this.fCandidate = null;
    }

    private update(): void {
        // a button pressed (a slider moved, a drag): nothing changes, except while a cable is drawn
        const state = this.fHost.state();
        if (state == "frozen" || (this.fButtons != 0 && state != "cable")) return;
        if (this.fHost.zoom() >= MAGNIFY_BELOW) {
            this.release();
            return;
        }
        const hit = this.fHost.containerAt(this.fLast.x, this.fLast.y);
        if (hit && hit === this.fActive) {
            this.cancel();
            return;
        }
        if (this.fActive) this.shrink();
        if (!hit) {
            this.cancel();
            return;
        }
        if (hit === this.fCandidate) return;
        this.cancel();
        this.fCandidate = hit;
        this.fTimer = window.setTimeout(() => {
            if (this.fCandidate !== hit || !hit.isConnected) return;
            this.fCandidate = null;
            const now = this.fHost.state();
            if (now == "frozen" || (this.fButtons != 0 && now != "cable") || this.fHost.zoom() >= MAGNIFY_BELOW) return;
            if (this.fHost.containerAt(this.fLast.x, this.fLast.y) !== hit) return;
            this.magnify(hit, this.fLast.x, this.fLast.y);
        }, MAGNIFY_DELAY);
    }

    // The module at 100 % on the screen around a point, kept inside the window.
    magnify(container: HTMLElement, clientX: number, clientY: number): void {
        this.shrink();
        const zoom = this.fHost.zoom();
        const box = container.getBoundingClientRect();
        const width = container.offsetWidth, height = container.offsetHeight;
        if (!width || !height) return;
        // the scale in the stage: 1 / zoom gives 100 % on the screen, less if it would not fit
        const room = { width: window.innerWidth - 2 * MARGIN, height: window.innerHeight - TOP - 2 * MARGIN };
        const screen = Math.min(1, room.width / width, room.height / height);  // the size on the screen, 1 = real
        const scale = Math.max(1, screen / zoom);
        // the point under the pointer stays (its place in the module, in its own pixels)
        const ox = (clientX - box.left) / zoom, oy = (clientY - box.top) / zoom;
        // where it would be on the screen, and the shift that keeps it in the window
        const size = { width: width * zoom * scale, height: height * zoom * scale };
        const left = clientX - ox * zoom * scale, top = clientY - oy * zoom * scale;
        const dx = Math.max(MARGIN - left, Math.min(0, window.innerWidth - MARGIN - (left + size.width)));
        const dy = Math.max(TOP + MARGIN - top, Math.min(0, window.innerHeight - MARGIN - (top + size.height)));
        container.style.transformOrigin = `${ox}px ${oy}px`;
        container.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px) scale(${scale})`;
        container.classList.add("magnified");
        this.fActive = container;
        this.follow(container);
    }

    private shrink(instant = false): void {
        const container = this.fActive;
        if (!container) return;
        this.fActive = null;
        if (instant) {
            container.style.transition = "none";
            container.style.transform = "";
            container.classList.remove("magnified");
            void container.offsetWidth;        // the size applied now, without the transition
            container.style.transition = "";
            this.fHost.redraw(container);
            return;
        }
        container.style.transform = "";
        container.classList.remove("magnified");
        // above the others until it is back
        container.classList.add("unmagnifying");
        window.setTimeout(() => container.classList.remove("unmagnifying"), GLIDE);
        this.follow(container);
    }

    // The ports and cables follow the module while it changes size.
    private follow(container: HTMLElement): void {
        const end = performance.now() + GLIDE + 40;
        const step = () => {
            this.fHost.redraw(container);
            if (performance.now() < end) requestAnimationFrame(step);
        };
        step();
        if (this.fActive && container !== this.fActive) this.fHost.redraw(this.fActive);
    }
}
