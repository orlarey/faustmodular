/*				VOLUMECONTROL.TS
    The volume of the scene (audio/MasterVolume.ts) on the icon of the physical output module, as the depth of
    a modulation port: a drag on the icon that starts vertically sets it (1 % per pixel up, 0.1 % with Shift; one
    that starts horizontally moves the module), a label shows
    its value while it is set, and the brightness of the icon shows it at rest (its tooltip gives the value).
    Muted, or at 0 %, the icon is the crossed speaker; it glows while the safety limiter acts. The module is also
    moved by its edge, around the icon.
*/

import type { MasterVolume } from "../audio/MasterVolume";
import { Utilitary } from "../Utilitary";

const PER_PIXEL = 1;
const FINE_PER_PIXEL = 0.1;
const DIMMEST = 0.25;       // the opacity of the icon at 0 %
const DECIDE = 4;           // px before the direction of a drag decides: volume (vertical) or move (horizontal)

export class VolumeControl {
    readonly icon: HTMLElement;
    private fLabel: HTMLElement;

    // moveModule: a drag started horizontally moves the module (PatchView.dragModuleFrom)
    constructor(container: HTMLElement, private fVolume: MasterVolume, private fMoveModule?: (down: PointerEvent, now: PointerEvent) => void) {
        this.icon = document.createElement("div");
        this.icon.className = "volume-icon";
        this.fLabel = document.createElement("div");
        this.fLabel.className = "volume-label";
        container.append(this.icon, this.fLabel);
        this.attachDrag();
        fVolume.onChange(() => this.show());
        // the limiter acts: the speaker glows a moment
        let timer = 0;
        fVolume.onLimit(() => {
            this.icon.classList.add("limiting");
            window.clearTimeout(timer);
            timer = window.setTimeout(() => this.icon.classList.remove("limiting"), 300);
        });
        this.show();
    }

    show(): void {
        const v = this.fVolume.volume;
        const silent = this.fVolume.muted || v == 0;
        this.icon.classList.toggle("muted", silent);
        this.icon.style.opacity = String(silent ? 1 : DIMMEST + (1 - DIMMEST) * v / 100);
        const text = VolumeControl.format(v);
        this.fLabel.textContent = text;
        const t = Utilitary.messageResource;
        this.icon.title = `${t?.volume ?? "Volume"} ${text}${this.fVolume.muted ? " (" + (t?.volumeMuted ?? "muted") + ")" : ""}\n${t?.volumeHint ?? ""}`;
        this.icon.dataset.volume = String(v);
    }

    static format(volume: number): string {
        return (Number.isInteger(volume) ? String(volume) : volume.toFixed(1)) + " %";
    }

    // The first direction of a drag decides: mostly vertical, the volume; mostly horizontal, a move of the
    // module (from where the press started). Undecided until the pointer has moved DECIDE px.
    private attachDrag(): void {
        this.icon.addEventListener("pointerdown", (e) => {
            if (e.pointerType == "mouse" && e.button != 0) return;
            e.stopPropagation();        // the module is not moved, unless the drag starts horizontally
            e.preventDefault();
            const down = e;
            this.icon.setPointerCapture(e.pointerId);
            let decided: "volume" | "move" | null = null;
            let lastY = e.clientY;
            let volume = this.fVolume.volume;
            const move = (m: PointerEvent) => {
                if (!decided) {
                    const dx = m.clientX - down.clientX, dy = m.clientY - down.clientY;
                    if (Math.hypot(dx, dy) < DECIDE) return;
                    if (Math.abs(dx) > Math.abs(dy) && this.fMoveModule) {
                        decided = "move";
                        end();
                        if (this.icon.hasPointerCapture(m.pointerId)) this.icon.releasePointerCapture(m.pointerId);
                        this.fMoveModule(down, m);
                        return;
                    }
                    decided = "volume";
                    this.icon.parentElement?.classList.add("adjusting-volume");
                }
                // by steps from the previous position, so that pressing or releasing Shift does not jump
                volume = Math.max(0, Math.min(100, volume + (lastY - m.clientY) * (m.shiftKey ? FINE_PER_PIXEL : PER_PIXEL)));
                lastY = m.clientY;
                this.fVolume.setVolume(volume);
            };
            const end = () => {
                this.icon.removeEventListener("pointermove", move);
                this.icon.removeEventListener("pointerup", end);
                this.icon.removeEventListener("pointercancel", end);
                this.icon.parentElement?.classList.remove("adjusting-volume");
            };
            this.icon.addEventListener("pointermove", move);
            this.icon.addEventListener("pointerup", end);
            this.icon.addEventListener("pointercancel", end);
        });
    }
}
