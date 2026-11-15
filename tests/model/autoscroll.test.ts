import { describe, expect, it } from "vitest";
import { EDGE, SPEED, edgeSpeed } from "../../src/view/AutoScroll";

describe("edgeSpeed", () => {
    it("is 0 out of the bands, and grows toward the edges, as the square of the depth", () => {
        expect(edgeSpeed(500, 0, 1000)).toBe(0);
        expect(edgeSpeed(EDGE, 0, 1000)).toBe(0);
        expect(edgeSpeed(1000 - EDGE, 0, 1000)).toBe(0);
        expect(edgeSpeed(EDGE / 2, 0, 1000)).toBeCloseTo(-SPEED / 4);
        expect(edgeSpeed(1000 - EDGE / 2, 0, 1000)).toBeCloseTo(SPEED / 4);
        expect(edgeSpeed(0, 0, 1000)).toBe(-SPEED);
        expect(edgeSpeed(1000, 0, 1000)).toBe(SPEED);
    });

    it("is at most SPEED beyond the edges, and from the given edge (the toolbar)", () => {
        expect(edgeSpeed(-300, 0, 1000)).toBe(-SPEED);
        expect(edgeSpeed(1300, 0, 1000)).toBe(SPEED);
        expect(edgeSpeed(48 + EDGE + 1, 48, 1000)).toBe(0);
        expect(edgeSpeed(48, 48, 1000)).toBe(-SPEED);
    });

    it("is 0 in a window too small for two bands", () => {
        expect(edgeSpeed(10, 0, 2 * EDGE - 1)).toBe(0);
    });
});
