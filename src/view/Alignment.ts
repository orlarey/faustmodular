/*				ALIGNMENT.TS
    Alignment guides while modules are dragged, as in Faust DAW (its clips, on the time axis), in two
    dimensions: the left and right edges of the dragged modules against the left and right edges of the
    other modules (vertical guides), their tops and bottoms against the tops and bottoms (horizontal
    guides). A left edge may meet a right edge: two modules then sit side by side.

    Within a threshold (4 screen pixels), the dragged group is pulled onto the nearest coincidence, on
    each axis independently (magnetism; Alt while dragging leaves the group where the pointer puts it).
    Every coincidence reached is shown as a thin line, from the dragged module to the aligned one,
    slightly beyond both.

    All coordinates are those of the stage (PatchView.toCanvas); the caller converts the screen
    threshold with the zoom.
*/

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

// A guide to draw: a vertical line (axis "x") at x = at from y = from to y = to, or a horizontal one
// (axis "y") at y = at from x = from to x = to.
export interface Guide {
    axis: "x" | "y";
    at: number;
    from: number;
    to: number;
}

export interface Alignment {
    dx: number;
    dy: number;
    guides: Guide[];
}

export interface AlignOptions {
    threshold: number;          // distance under which the group is pulled onto a coincidence
    snap: boolean;              // false: no magnetism (Alt), the coincidences are only shown
    epsilon: number;            // distance under which two edges coincide (half a screen pixel)
    extend: number;             // a guide goes this far beyond the modules it joins
}

const move = (r: Rect, dx: number, dy: number): Rect => ({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy });

// The edges of a rectangle along an axis: left and right for x, top and bottom for y.
const edges = (r: Rect, axis: "x" | "y"): number[] => axis == "x" ? [r.left, r.right] : [r.top, r.bottom];
// Its extent across: top to bottom for a vertical guide, left to right for a horizontal one.
const across = (r: Rect, axis: "x" | "y"): [number, number] => axis == "x" ? [r.top, r.bottom] : [r.left, r.right];

// The correction (added to the displacement) that brings the nearest edge of `moving` onto an edge of
// `others`, if one is within the threshold.
function nearest(moving: Rect[], others: Rect[], axis: "x" | "y", threshold: number): number | null {
    let best: number | null = null;
    for (const r of moving) {
        for (const e of edges(r, axis)) {
            for (const o of others) {
                for (const g of edges(o, axis)) {
                    const d = g - e;
                    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
                }
            }
        }
    }
    return best;
}

// The coincidences of `moving` with `others` along an axis, one guide per position, joining all the
// modules that meet there.
function guidesAlong(moving: Rect[], others: Rect[], axis: "x" | "y", epsilon: number, extend: number): Guide[] {
    const lines = new Map<number, { at: number; from: number; to: number }>();
    for (const r of moving) {
        for (const e of edges(r, axis)) {
            for (const o of others) {
                for (const g of edges(o, axis)) {
                    if (Math.abs(g - e) > epsilon) continue;
                    const [a0, a1] = across(r, axis), [b0, b1] = across(o, axis);
                    const key = Math.round(g / epsilon);
                    const line = lines.get(key) ?? { at: g, from: Infinity, to: -Infinity };
                    line.from = Math.min(line.from, a0, b0);
                    line.to = Math.max(line.to, a1, b1);
                    lines.set(key, line);
                }
            }
        }
    }
    return Array.from(lines.values()).map((l) => ({ axis, at: l.at, from: l.from - extend, to: l.to + extend }));
}

// Where the dragged modules go for a displacement (dx, dy) of the pointer, and the guides to show.
// `moving`: the dragged modules where the drag started; `others`: the modules that stay.
export function align(moving: Rect[], others: Rect[], dx: number, dy: number, options: AlignOptions): Alignment {
    if (options.snap) {
        const moved = moving.map((r) => move(r, dx, dy));
        dx += nearest(moved, others, "x", options.threshold) ?? 0;
        dy += nearest(moved, others, "y", options.threshold) ?? 0;
    }
    const placed = moving.map((r) => move(r, dx, dy));
    return {
        dx, dy,
        guides: [...guidesAlong(placed, others, "x", options.epsilon, options.extend), ...guidesAlong(placed, others, "y", options.epsilon, options.extend)],
    };
}
