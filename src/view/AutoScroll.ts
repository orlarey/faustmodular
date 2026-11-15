/*				AUTOSCROLL.TS
    The stage scrolls by itself while something is dragged near an edge of the window (a module or a selection
    moved, a selection rectangle drawn, a cable drawn): in a band of EDGE pixels along each edge (under the
    toolbar at the top), the faster as the pointer is deeper in it, at most SPEED pixels per second (beyond the
    edge too: the pointer is captured). Not before the pointer has moved: a drag that starts near an edge does
    not scroll at once. PatchView moves the view (Scene.setView) and the dragged thing with it, so that it stays
    under the pointer.
*/

export const EDGE = 40;             // px of the band along each edge
export const SPEED = 1000;          // px per second, at the edge and beyond
const START = 8;                    // px the pointer moves before it scrolls
const STEP = 0.05;                  // s at most per frame (a frame late: no jump)

export interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

// The speed of the scroll along an axis (px/s): negative toward `min`, positive toward `max`, 0 out of the bands;
// growing as the square of the depth in the band, so that it starts slowly.
export function edgeSpeed(p: number, min: number, max: number, edge = EDGE, speed = SPEED): number {
    const depth = (d: number) => Math.min(1, Math.max(0, d / edge)) ** 2;
    if (max - min < 2 * edge) return 0;     // a window too small: no band
    if (p < min + edge) return -speed * depth(min + edge - p);
    if (p > max - edge) return speed * depth(p - (max - edge));
    return 0;
}

export interface AutoScrollHost {
    bounds(): Bounds;                       // the visible stage, in the window
    scroll(dx: number, dy: number): void;   // moves the view by (dx, dy) screen pixels, and the drag with it
}

export class AutoScroll {
    private fStart: { x: number; y: number } | null = null;
    private fPointer = { x: 0, y: 0 };
    private fArmed = false;
    private fFrame = 0;
    private fTime = 0;

    constructor(private fHost: AutoScrollHost) {}

    get running(): boolean {
        return this.fFrame != 0;
    }

    // A drag starts, the pointer here.
    begin(x: number, y: number): void {
        this.end();
        this.fStart = { x, y };
        this.fPointer = { x, y };
        this.fArmed = false;
    }

    // The pointer of the drag has moved: scrolls while it is in a band.
    track(x: number, y: number): void {
        if (!this.fStart) return;
        this.fPointer = { x, y };
        this.fArmed ||= Math.hypot(x - this.fStart.x, y - this.fStart.y) > START;
        if (this.fArmed && this.fFrame == 0 && this.speed().some((v) => v != 0)) {
            this.fTime = performance.now();
            this.fFrame = requestAnimationFrame((t) => this.step(t));
        }
    }

    // The drag ends.
    end(): void {
        if (this.fFrame) cancelAnimationFrame(this.fFrame);
        this.fFrame = 0;
        this.fStart = null;
    }

    private speed(): [number, number] {
        const b = this.fHost.bounds();
        return [edgeSpeed(this.fPointer.x, b.left, b.right), edgeSpeed(this.fPointer.y, b.top, b.bottom)];
    }

    private step(time: number): void {
        const [vx, vy] = this.speed();
        if (!this.fStart || (vx == 0 && vy == 0)) {
            this.fFrame = 0;
            return;
        }
        const dt = Math.min(STEP, Math.max(0, (time - this.fTime) / 1000));
        this.fTime = time;
        // the pointer toward the right: the stage goes left, to show what is beyond
        if (dt > 0) this.fHost.scroll(-vx * dt, -vy * dt);
        this.fFrame = requestAnimationFrame((t) => this.step(t));
    }
}
