// The clock of an application and the difference between two clocks (Documentation/FAUST-SYNC-SPEC.md, § 7.1, 7.2):
// readings with the noise of a Mac (σ 40 µs, the 100 µs of performance.now()), a drift of −38 ppm; a jump of the
// announced latency followed while the clock settles, compensated afterwards; δ frozen once calm, not by a jump.
import { describe, expect, it } from "vitest";
import { ClockLine, lineAt, SETTLE, WARMUP } from "../../src/sync/ClockLine";
import { ClockOffset } from "../../src/sync/ClockOffset";

function noise(seed: number) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
}

// A clock read every 50 ms from T0 (ms): its true time t(T) = t0 + (T − T0)·0.001·(1 + drift), plus the announced
// latency error `latency(T)` (s), the readings at 100 µs.
function readings(line: ClockLine, from: number, to: number, opts: { t0?: number; drift?: number; latency?: (T: number) => number; seed?: number } = {}) {
    const { t0 = 10, drift = -38e-6, latency = () => 0, seed = 1 } = opts;
    const rnd = noise(seed);
    for (let T = from; T <= to; T += 50) {
        const Tq = Math.round(T * 10) / 10;                         // performance.now() at 100 µs
        line.add(1.7e12 + Tq, t0 + T * 0.001 * (1 + drift) + latency(T) + 30e-6 * rnd());
    }
}
const truth = (T: number, t0 = 10, drift = -38e-6) => t0 + T * 0.001 * (1 + drift);

describe("the clock of an application", () => {
    it("ignores the first 2 s, then gives the time within 20 µs and the drift within 2 ppm", () => {
        const line = new ClockLine();
        readings(line, 0, WARMUP - 50, { latency: () => 0.03 });   // the startup, off by 30 ms
        expect(line.ready).toBe(false);
        readings(line, WARMUP, 40000);
        expect(line.ready).toBe(true);
        expect(line.settled).toBe(true);
        expect(Math.abs(line.at(1.7e12 + 40000) - truth(40000))).toBeLessThan(20e-6);
        expect(Math.abs(line.message()!.rate / 0.001 - 1 - -38e-6)).toBeLessThan(2e-6);
        expect(line.jumps).toEqual([]);
    });

    it("follows a jump while it settles", () => {
        const line = new ClockLine();
        readings(line, 0, 4000);
        readings(line, 4050, 20000, { latency: () => -0.009, seed: 2 });
        expect(line.jumps.map((j) => j.compensated)).toEqual([false]);
        expect(Math.abs(line.at(1.7e12 + 20000) - (truth(20000) - 0.009))).toBeLessThan(20e-6);
    });

    it("compensates a jump once settled: the clock stays continuous", () => {
        const line = new ClockLine();
        readings(line, 0, WARMUP + SETTLE + 3000);
        const jump = WARMUP + SETTLE + 3050;
        readings(line, jump, 40000, { latency: () => -0.009, seed: 3 });
        expect(line.jumps.length).toBe(1);
        expect(line.jumps[0].compensated).toBe(true);
        expect(Math.abs(line.jumps[0].size + 0.009)).toBeLessThan(50e-6);
        expect(Math.abs(line.at(1.7e12 + 40000) - truth(40000))).toBeLessThan(20e-6);
        // the published line, the same
        expect(Math.abs(lineAt(line.message()!, 1.7e12 + 40000) - truth(40000))).toBeLessThan(20e-6);
    });

    it("starts again after a suspension", () => {
        const line = new ClockLine();
        readings(line, 0, 10000);
        line.reset();
        expect(line.ready).toBe(false);
        readings(line, 20000, 25000, { t0: 5 });
        expect(line.ready).toBe(true);
        expect(Math.abs(line.at(1.7e12 + 25000) - truth(25000, 5))).toBeLessThan(30e-6);
    });
});

describe("the difference between two clocks", () => {
    it("is frozen after 2.5 s of calm values within 0.5 ms, at their median", () => {
        const o = new ClockOffset();
        expect(o.value).toBeNull();
        expect(o.add(0, 0.2501, false)).toBe(false);                // not calm: the last value serves
        expect(o.value).toBe(0.2501);
        let frozen = false;
        for (let T = 500; T <= 4000 && !frozen; T += 500) frozen = o.add(T, 0.25 + (T % 1000 ? 10e-6 : -10e-6), true);
        expect(frozen).toBe(true);
        expect(Math.abs(o.frozen! - 0.25)).toBeLessThan(11e-6);
        // a jump afterwards does not move it
        o.add(5000, 0.259, true);
        expect(o.value).toBe(o.frozen);
    });

    it("waits while the values move by more than 0.5 ms", () => {
        const o = new ClockOffset();
        for (let T = 0; T <= 3000; T += 500) o.add(T, 0.25 + T * 1e-6, true);   // 0.5 ms per 500 ms
        expect(o.frozen).toBeNull();
        expect(o.value).toBeCloseTo(0.253, 9);
    });

    it("between two clocks of one card: the same δ whatever the drift, a jump compensated", () => {
        // A from 0, B opened 12.3 s later (its context 12.3 s younger); both drift by −38 ppm
        const A = new ClockLine(), B = new ClockLine();
        readings(A, 0, 60000, { seed: 4, latency: (T) => (T > 30000 ? 0.007 : 0) });       // A jumps at 30 s
        readings(B, 12300, 60000, { t0: 10 - 12.3 * (1 - 38e-6), seed: 5 });
        const T = 1.7e12 + 60000;
        expect(Math.abs(A.at(T) - B.at(T) - 12.3 * (1 - 38e-6))).toBeLessThan(30e-6);
    });
});
