// Alignment guides while modules are dragged (src/view/Alignment.ts).
import { describe, expect, it } from "vitest";
import { align, Rect } from "../../src/view/Alignment";

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height });
const options = { threshold: 4, snap: true, epsilon: 0.5, extend: 8 };

describe("alignment guides", () => {
    const other = rect(300, 100, 200, 150);         // left 300, right 500, top 100, bottom 250
    const dragged = rect(0, 0, 100, 80);

    it("pulls a top within 4 px onto the top of another module, and shows a horizontal line joining them", () => {
        // dragged to (50, 103): its top 3 px below the other's top
        const a = align([dragged], [other], 50, 103, options);
        expect([a.dx, a.dy]).toEqual([50, 100]);
        expect(a.guides).toEqual([{ axis: "y", at: 100, from: 50 - 8, to: 500 + 8 }]);
    });

    it("aligns a top on a bottom, a left on a right (side by side), on both axes at once", () => {
        // left 497 → right edge 500 of the other; top 252 → its bottom 250
        const a = align([dragged], [other], 497, 252, options);
        expect([a.dx, a.dy]).toEqual([500, 250]);
        expect(a.guides).toEqual(expect.arrayContaining([
            { axis: "x", at: 500, from: 100 - 8, to: 330 + 8 },
            { axis: "y", at: 250, from: 300 - 8, to: 600 + 8 },
        ]));
    });

    it("takes the nearest coincidence, and nothing beyond the threshold", () => {
        // top 105 (5 px from 100): too far; bottom 105 + 80 = 185: nothing there
        expect(align([dragged], [other], 50, 105, options)).toEqual({ dx: 50, dy: 105, guides: [] });
        // two candidates: top 102 (2 from 100) and, on another module, top 101 (1 from 100)... the nearest wins
        const near = rect(700, 101, 50, 50);
        const a = align([dragged], [other, near], 50, 102, options);
        expect(a.dy).toBe(101);
    });

    it("without magnetism (Alt), shows only the exact coincidences", () => {
        expect(align([dragged], [other], 50, 103, { ...options, snap: false })).toEqual({ dx: 50, dy: 103, guides: [] });
        expect(align([dragged], [other], 50, 100, { ...options, snap: false }).guides).toHaveLength(1);
    });

    it("moves a selection as a block, pulled by whichever of its modules is nearest; one line per position", () => {
        const second = rect(0, 200, 100, 80);       // the selection: dragged and second, 200 px apart
        const below = rect(300, 300, 100, 60);
        // second's top at 303 is 3 px from below's top: the block goes 3 px up
        const a = align([dragged, second], [other, below], 600, 103 + 0, options);
        expect(a.dy).toBe(100);                     // dragged's top on other's top (3 px), as near as second's
        // both modules aligned on the left edge 300 of two others: one vertical line spanning them all
        const b = align([dragged, second], [other, below], 302, 100, options);
        expect(b.dx).toBe(300);
        // the block: y 100..180 and 300..380; the others: y 100..250 and 300..360
        expect(b.guides.filter((g) => g.axis == "x" && g.at == 300)).toEqual([{ axis: "x", at: 300, from: 100 - 8, to: 380 + 8 }]);
        // and their right edges (400) on the right edge of the module below
        expect(b.guides.filter((g) => g.axis == "x" && g.at == 400)).toEqual([{ axis: "x", at: 400, from: 100 - 8, to: 380 + 8 }]);
    });
});
