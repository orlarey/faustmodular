// The Sync Clock module (public/faust-modules/modular/SyncClock.dsp), fed by the Timeline core as the application
// feeds its reserved inputs: a gate exactly at the sample where the position crosses a division (the downbeat at the
// start, every sixteenth note at 120 BPM: 6000 samples at 48 kHz), Width of its period, the reset at the start,
// nothing when stopped; the bar division; the playing taken up again in the middle of a step.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as fw from "@grame/faustwasm/dist/esm/index.js";
import { getCompiler, TEST_OPTIONS } from "../helpers/faust";
import { TimelineCore, TimelineRule } from "../../src/sync/TimelineCore";
import { syncInputs } from "../../src/sync/SyncInputs";

const code = fs.readFileSync(path.resolve(__dirname, "../../public/faust-modules/modular/SyncClock.dsp"), "utf8");
const SR = 48000;

async function play(rules: TimelineRule[], length: number, params: Record<string, number> = {}, alter?: (timeline: Float32Array[]) => void) {
    const core = new TimelineCore(SR);
    rules.forEach((r) => core.schedule(r));
    const timeline = Array.from({ length: 5 }, () => new Float32Array(length));
    core.render(0, timeline, length);
    alter?.(timeline);
    const generator = new fw.FaustMonoDspGenerator();
    await generator.compile(await getCompiler(), "syncclock", code, TEST_OPTIONS);
    const p = (await generator.createOfflineProcessor(SR, 128))!;
    for (const [k, v] of Object.entries(params)) p.setParamValue("/SyncClock/" + k, v);
    const inputs = syncInputs(code).map((channel) => timeline[channel]);
    const [clock, reset, run] = p.render(inputs, length);
    const rising = (x: Float32Array) => { const r: number[] = []; x.forEach((v, i) => { if (v > 0.5 && (i == 0 || x[i - 1] <= 0.5)) r.push(i); }); return r; };
    return { clock, reset, run, edges: rising(clock), resets: rising(reset) };
}

describe("Sync Clock module", () => {
    it("has 5 reserved inputs and no port", async () => {
        expect(syncInputs(code)).toEqual([0, 1, 2, 3, 4]);
    });

    it("gates every sixteenth note from the downbeat, exactly at its sample", async () => {
        const start = 1000;
        const { edges, resets, clock } = await play([{ frame: start, beat: 0, tempo: 120, meter: 4, playing: true }], start + 48000);
        expect(edges).toEqual(Array.from({ length: 8 }, (_, k) => start + k * 6000));
        expect(resets).toEqual([start]);
        // Width 0.5: 3000 samples high
        expect(clock.slice(start, start + 6000).reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0)).toBe(3000);
    });

    it("gates every bar with the bar division, and nothing once stopped", async () => {
        const rules = [
            { frame: 0, beat: 0, tempo: 120, meter: 3, playing: true },
            { frame: 48000 * 4, beat: 8, tempo: 120, meter: 3, playing: false },
        ];
        const { edges } = await play(rules, 48000 * 5, { Division: 0 });
        expect(edges).toEqual([0, 72000, 144000]);                    // bars of 3 beats: 1.5 s
    });

    it("takes up the playing in the middle of a step without a gate, then at the next division", async () => {
        // stopped at 1.1, then playing again
        const rules = [{ frame: 0, beat: 1.1, tempo: 120, meter: 4, playing: false }, { frame: 100, beat: 1.1, tempo: 120, meter: 4, playing: true }];
        const { edges, resets } = await play(rules, 24000, { Division: 0.5 });
        // the next eighth after 1.1: 1.5, 0.4 beat later (9600 samples)
        expect(edges[0]).toBe(100 + 9600);
        expect(resets).toEqual([]);
    });

    // A block of the position slightly behind (2.7 ms back, in the middle of a step, then at a bar line): the
    // gates stay where they are, none too many.
    it("gives no gate too many for a small step back of the position", async () => {
        const rule = { frame: 0, beat: 0, tempo: 120, meter: 4, playing: true };
        const back = (from: number) => (t: Float32Array[]) => { for (let i = from; i < from + 128; i++) t[0][i] = ((t[0][i] - 128 * 2 / SR) + 4) % 4; };
        const plain = await play([rule], 120000);
        const middle = await play([rule], 120000, {}, back(3000 + 6000 * 3));
        expect(middle.edges).toEqual(plain.edges);
        // across the bar line at 2 s (beat 4 → 0, sample 96000): the gate of the bar line comes when the position
        // has crossed it, the block late; none too many
        const bar = await play([rule], 120000, {}, back(96000 - 64));
        expect(bar.edges.length).toBe(plain.edges.length);
        bar.edges.forEach((e, i) => expect(Math.abs(e - plain.edges[i])).toBeLessThanOrEqual(64));
    }, 60_000);
});
