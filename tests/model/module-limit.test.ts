import { afterEach, describe, expect, it, vi } from "vitest";
import { FailureBatch, WARN_FROM, crossesWarning, listNames } from "../../src/audio/ModuleLimit";

describe("module limit", () => {
    afterEach(() => vi.useRealTimers());

    it("warns when the number of modules enters the band, once", () => {
        expect(crossesWarning(WARN_FROM - 1, WARN_FROM)).toBe(true);
        expect(crossesWarning(0, WARN_FROM + 30)).toBe(true);          // a scene opened
        expect(crossesWarning(WARN_FROM, WARN_FROM + 1)).toBe(false);  // already in it
        expect(crossesWarning(WARN_FROM - 2, WARN_FROM - 1)).toBe(false);
        expect(crossesWarning(WARN_FROM + 1, WARN_FROM - 1)).toBe(false);
    });

    it("reports the failures of a moment together", () => {
        vi.useFakeTimers();
        const reports: string[][] = [];
        const batch = new FailureBatch((names) => reports.push(names), 300);
        batch.add("VCO");
        batch.add("VCF");
        vi.advanceTimersByTime(299);
        expect(reports).toEqual([]);
        batch.add("ADSR");
        vi.advanceTimersByTime(1);
        expect(reports).toEqual([["VCO", "VCF", "ADSR"]]);
        batch.add("LFO");
        vi.advanceTimersByTime(300);
        expect(reports).toEqual([["VCO", "VCF", "ADSR"], ["LFO"]]);
    });

    it("lists the first names, then how many others", () => {
        const others = (n: number) => ` and ${n} others`;
        expect(listNames(["A", "B"], others)).toBe("A, B");
        expect(listNames(["A", "B", "C", "D", "E", "F"], others)).toBe("A, B, C, D and 2 others");
        expect(listNames(["Osc", "Osc", "VCF", "Osc"], others)).toBe("Osc ×3, VCF");
    });
});
