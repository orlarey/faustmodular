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

// A rule from a position in beats (its tick and phase), in this context.
const rule = (frame: number, beat: number, tempo: number, meter: number, playing: boolean) => {
    const ticks = beat * TimelineCore.PPQ, tick = Math.floor(ticks + 1e-9);
    return TimelineCore.rule(frame, tick, Math.max(0, ticks - tick), tempo, meter, playing, SR);
};

async function play(rules: TimelineRule[], length: number, params: Record<string, number> = {}, alter?: (timeline: Float32Array[]) => void) {
    const core = new TimelineCore(SR);
    rules.forEach((r) => core.schedule(r));
    const timeline = Array.from({ length: 7 }, () => new Float32Array(length));
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
        expect(syncInputs(code)).toEqual([5, 1, 2, 3, 4]);
    });

    it("gates every sixteenth note from the downbeat, exactly at its sample", async () => {
        const start = 1000;
        const { edges, resets, clock } = await play([rule(start, 0, 120, 4, true)], start + 48000);
        expect(edges).toEqual(Array.from({ length: 8 }, (_, k) => start + k * 6000));
        expect(resets).toEqual([start]);
        // Width 0.5: 120 ticks of 240, 3000 samples high
        expect(clock.slice(start, start + 6000).reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0)).toBe(3000);
    });

    it("at 44.1 kHz, every sixteenth note at the sample of its tick: 5512.5 samples, rounded up", async () => {
        // 22.96875 samples per tick: tick 240·j at the first sample where the position reaches it
        const core = new TimelineCore(44100);
        core.schedule(TimelineCore.rule(0, 0, 0, 120, 4, true, 44100));
        const t = Array.from({ length: 7 }, () => new Float32Array(44100));
        core.render(0, t, 44100);
        const ticks: number[] = [];
        t[6].forEach((v, i) => { if (v) ticks.push(i); });
        expect(ticks.length).toBe(1919);                                  // 1 s: 1920 ticks from tick 0 at sample 0
        ticks.forEach((n, i) => expect(n).toBe(Math.ceil((i + 1) * 44100 * 60 / (120 * 960))));
    });

    it("gates every bar with the bar division, and nothing once stopped", async () => {
        const rules = [rule(0, 0, 120, 3, true), rule(48000 * 4, 8, 120, 3, false)];
        const { edges } = await play(rules, 48000 * 5, { Division: 0 });
        expect(edges).toEqual([0, 72000, 144000]);                    // bars of 3 beats: 1.5 s
    });

    it("takes up the playing in the middle of a step without a gate, then at the next division", async () => {
        // stopped at 1.1, then playing again (in the high part of the step: no gate yet)
        const rules = [rule(0, 1.1, 120, 4, false), rule(100, 1.1, 120, 4, true)];
        const { edges, resets } = await play(rules, 24000, { Division: 0.5 });
        // the next eighth after 1.1: 1.5, 0.4 beat later (384 ticks, 9600 samples)
        expect(edges[0]).toBe(100 + 9600);
        expect(resets).toEqual([]);
    });

    // A block of the position slightly behind (2.7 ms back, in the middle of a step, then at a bar line): the
    // gates stay where they are, none too many.
    it("gives no gate too many for a small step back of the position", async () => {
        const r = rule(0, 0, 120, 4, true);
        // the index 128 samples (5.12 ticks → 5) back, and no tick in that block
        const back = (from: number) => (t: Float32Array[]) => {
            for (let i = from; i < from + 128; i++) { t[5][i] = (t[5][i] - 5 + 3840) % 3840; t[6][i] = 0; }
        };
        const plain = await play([r], 120000);
        const middle = await play([r], 120000, {}, back(3000 + 6000 * 3));
        expect(middle.edges).toEqual(plain.edges);
        const bar = await play([r], 120000, {}, back(96000 - 64));
        expect(bar.edges.length).toBe(plain.edges.length);
        bar.edges.forEach((e, i) => expect(Math.abs(e - plain.edges[i])).toBeLessThanOrEqual(64));
    }, 60_000);
});
