// faust-sync (Documentation/FAUST-SYNC-SPEC.md): the timeline and its operations (continuous, taking effect LEAD ms
// later, the most recent revision winning), the Timeline core (the position at every sample, a rule switched exactly
// at its frame, the start), the reserved inputs of a module (declare sync) and their place after the modulations.
import { describe, expect, it } from "vitest";
import { apply, barBeat, beatAt, newer, newTimeline, PPQ, rebase, Timeline } from "../../src/sync/Timeline";
import { TimelineCore } from "../../src/sync/TimelineCore";
import { processorSource } from "../../src/sync/SharedTimeline";
import { syncInputs } from "../../src/sync/SyncInputs";
import { modulatedCode } from "../../src/model/Modulation";

const SR = 48000;
// on the clock "a" (48 kHz), playing from the sample t0
const playing = (t0: number): Timeline => ({ ...newTimeline("a"), playing: true, anchor: { clock: "a", frame: t0, sampleRate: SR, tick: 0, phase: 0 }, revision: { time: 5, origin: "a" } });
// the exact position of a timeline at a sample of its clock (as the node computes it)
const exact = (t: Timeline) => (frame: number) => {
    const r = TimelineCore.rule(t.anchor.frame, t.anchor.tick, t.anchor.phase, t.tempo, t.meter, t.playing, t.anchor.sampleRate);
    const p = TimelineCore.advance(r.tick, r.rem, t.playing ? frame - r.frame : 0, r.inc, r.den);
    return { tick: p.tick, phase: p.rem / r.den };
};

describe("timeline", () => {
    it("gives the position at any sample of the clock of its anchor, 2 beats per second at 120", () => {
        const t = playing(48000);
        expect(beatAt(t, 48000)).toBe(0);
        expect(beatAt(t, 48000 * 3.5)).toBe(5);
        expect(beatAt({ ...t, playing: false }, 9e6)).toBe(0);
        expect(barBeat(5, 4)).toEqual({ bar: 2, beat: 2 });
    });

    it("applies an operation at its effect on the clock of its author, exactly, without a jump; play from the start, stop, locate", () => {
        const t = playing(0);
        // b decides at the common time 2000 ms; its clock is 0.3 s (14400 samples) behind the clock "a": its sample
        // 82560 is the sample 96960 of "a"
        const effect = { clock: "b", frame: 82560, sampleRate: SR };
        const faster = apply(t, { type: "tempo", tempo: 90 }, 2000, "b", effect, (frame) => exact(t)(frame + 14400));
        // 96960 samples at 120 BPM: 4.04 beats, 3878.4 ticks
        expect(faster.anchor.tick).toBe(3878);
        expect(faster.anchor.phase).toBeCloseTo(0.4, 9);
        expect(faster.tempo).toBe(90);
        expect(faster.revision).toEqual({ time: 2000, origin: "b" });
        // continuous at the effect, then at 90 (1.5 beats per second)
        expect(beatAt(faster, 82560 + 96000)).toBeCloseTo(4.04 + 3, 9);
        const back = rebase(faster, "a", SR, -0.3);
        expect(back.anchor).toEqual({ ...faster.anchor, clock: "a", frame: 96960 });
        const stopped = apply(faster, { type: "stop" }, 5000, "b", { clock: "b", frame: 240000, sampleRate: SR }, exact(faster));
        expect(stopped.playing).toBe(false);
        expect(beatAt(stopped, 9e6)).toBeCloseTo(beatAt(faster, 240000), 9);
        expect(apply(stopped, { type: "stop" }, 6000, "a", { clock: "a", frame: 1, sampleRate: SR }, exact(stopped))).toBe(stopped);   // nothing to do
        expect(apply(stopped, { type: "play", fromStart: true }, 7000, "a", { clock: "a", frame: 7, sampleRate: SR }, exact(stopped)).anchor).toEqual({ clock: "a", frame: 7, sampleRate: SR, tick: 0, phase: 0 });
        expect(apply(stopped, { type: "locate", beat: 8 }, 7000, "a", { clock: "a", frame: 7, sampleRate: SR }, exact(stopped)).anchor.tick).toBe(8 * PPQ);
    });

    it("rebases on a clock of another rate by the time of its sample", () => {
        const t = playing(48000);                                       // 1 s of "a"
        expect(rebase(t, "c", 44100, 0.5).anchor.frame).toBe(22050);    // 0.5 s of "c"
    });

    it("orders the revisions: the later one, then the larger origin", () => {
        const a = { ...newTimeline("a"), revision: { time: 10, origin: "a" } };
        const b = { ...newTimeline("b"), revision: { time: 10, origin: "b" } };
        expect(newer(b, a)).toBe(true);
        expect(newer(a, b)).toBe(false);
        expect(newer({ ...a, revision: { time: 11, origin: "a" } }, b)).toBe(true);
        expect(newer(a, newTimeline("c"))).toBe(true);           // a new timeline is older than any change
    });
});

describe("Timeline core", () => {
    const render = (core: TimelineCore, start: number, length: number) => {
        const out = Array.from({ length: 7 }, () => new Float32Array(length));
        core.render(start, out, length);
        return out;
    };
    const rule = (frame: number, beat: number, tempo: number, meter: number, playing: boolean, sr = SR) =>
        TimelineCore.rule(frame, Math.round(beat * PPQ), 0, tempo, meter, playing, sr);

    it("counts the ticks in integers: exact, the same as computed from the start, over an hour", () => {
        // 44.1 kHz, 133.33 BPM: 48.38… ticks per... a tick every 20.67… samples; one hour by blocks of 128
        const core = new TimelineCore(44100);
        const r = TimelineCore.rule(0, 0, 0, 133.33, 4, true, 44100);
        core.schedule(r);
        const out = Array.from({ length: 7 }, () => new Float32Array(128));
        const blocks = Math.floor(44100 * 3600 / 128);
        for (let b = 0; b < blocks; b++) core.render(b * 128, out, 128);
        const last = blocks * 128 - 1;
        expect(core.k).toBe(TimelineCore.advance(0, 0, last, r.inc, r.den).tick);
        expect(core.r).toBe(TimelineCore.advance(0, 0, last, r.inc, r.den).rem);
        expect(core.jumps).toBe(0);
    });

    it("switches to a rule exactly at its frame, with a start, and gives the position, the index and the ticks", () => {
        const core = new TimelineCore(SR);
        core.schedule(rule(100, 0, 120, 4, true));
        const [beat, run, start, tempo, meter, index, tick] = render(core, 0, 256);
        expect(Array.from(run.slice(0, 100)).every((v) => v == 0)).toBe(true);
        expect(run[100]).toBe(1);
        expect(start[100]).toBe(1);
        expect(start.reduce((n, v) => n + v, 0)).toBe(1);                         // one sample
        expect(beat[100]).toBe(0);
        expect(beat[200]).toBeCloseTo(100 * 120 / 60 / SR, 9);
        expect([tempo[200], meter[200]]).toEqual([120, 4]);
        // a tick every 25 samples at 48 kHz and 120 BPM
        expect(index[124]).toBe(0);
        expect(index[125]).toBe(1);
        expect(Array.from(tick).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([125, 150, 175, 200, 225, 250]);
        // 2.5 s later: 5 beats, bar 2, beat 2: index 960
        const later = render(core, 100 + SR * 2.5, 1);
        expect(later[5][0]).toBe(960);
        expect(later[0][0]).toBeCloseTo(1, 6);
    });

    it("applies a late rule at once, and drops the waiting rules a newer one replaces", () => {
        const core = new TimelineCore(SR);
        render(core, 0, 128);
        core.schedule(rule(64, 4, 60, 4, true));                                // already rendered
        const [beat] = render(core, 128, 1);
        expect(beat[0]).toBeCloseTo((4 + 64 / SR) % 4, 9);
        core.schedule(rule(10000, 0, 120, 4, false));
        core.schedule(rule(5000, 2, 90, 3, true));                               // replaces the one at 10000
        expect(core.pending.map((r) => r.frame)).toEqual([5000]);
    });

    it("computes again the position after a block that does not follow the one before", () => {
        const core = new TimelineCore(SR);
        core.schedule(rule(0, 0, 120, 4, true));
        render(core, 0, 128);
        const [, , , , , index] = render(core, 1000, 1);                         // 872 samples skipped
        expect(index[0]).toBe(40);                                                // 1000 / 25
        expect(core.jumps).toBe(1);
    });
});

describe("Timeline core: corrections", () => {
    const run = (core: TimelineCore, start: number, n: number) => {
        const out = Array.from({ length: 7 }, () => new Float32Array(n));
        core.render(start, out, n);
        return out;
    };

    it("does not go back for a small correction: the position waits, then follows the new rule", () => {
        const core = new TimelineCore(SR);
        core.schedule(TimelineCore.rule(0, 0, 0, 120, 4, true, SR));
        run(core, 0, 48000);                                    // 2 beats
        // the same rule, 0.5 ms later (24 samples): at sample 48000 it gives 24 samples (0.96 tick) less
        core.schedule(TimelineCore.rule(24, 0, 0, 120, 4, true, SR));
        const [beat, , , , , index, tick] = run(core, 48000, 128);
        for (let i = 1; i < 128; i++) expect(beat[i]).toBeGreaterThanOrEqual(beat[i - 1]);
        expect(beat[0]).toBeCloseTo(2, 4);
        expect(beat[23]).toBeCloseTo(2, 4);                     // held 24 samples
        expect(beat[127]).toBeCloseTo((48000 + 127 - 24) * 2 / 48000, 4);
        // the index never goes back, and no tick is counted twice
        for (let i = 1; i < 128; i++) expect(index[i]).toBeGreaterThanOrEqual(index[i - 1]);
        // ticks 1920 (at 48000, by the rule before) to 1924, each once
        expect(Array.from(tick).map((v, i) => (v ? 48000 + i : -1)).filter((i) => i >= 0)).toEqual([48000, 48049, 48074, 48099, 48124]);
    });

    it("goes back for a real move: from the start, or a locate", () => {
        const core = new TimelineCore(SR);
        core.schedule(TimelineCore.rule(0, 0, 0, 120, 4, true, SR));
        run(core, 0, 48000);
        core.schedule(TimelineCore.rule(48000, 960, 0, 120, 4, true, SR));      // back by a beat (0.5 s)
        expect(run(core, 48000, 4)[0][0]).toBeCloseTo(1, 6);
    });
});

describe("reserved inputs", () => {
    it("are read from declare sync, as channels of the Timeline node", () => {
        expect(syncInputs('declare sync "beat; run; start; tempo; meter";\nprocess = _;')).toEqual([0, 1, 2, 3, 4]);
        expect(syncInputs('declare sync "index; tick";')).toEqual([5, 6]);
        expect(syncInputs('declare sync "tempo beat";')).toEqual([3, 0]);
        expect(syncInputs("process = _;")).toEqual([]);
    });

    it("come after the audio inputs and the modulations in the effective code", () => {
        const code = modulatedCode('process(a, b, c) = a + b + c;', 1, [{ target: "x", mode: "add", min: 0, max: 1, exponential: false }], 2);
        // 1 audio port, 1 modulation port, 2 reserved: route(4, 4, …): the modulation to the widget, the audio and the
        // reserved inputs to the process
        expect(code).toContain("route(4,4,(2,1),(1,2),(3,3),(4,4))");
    });
});

// The script of the AudioWorklet, from the source of TimelineCore: named (`class TimelineCore {…}`, the development
// server) or anonymous (`class {…}`, the production build, where the class is assigned to a variable).
describe("the Timeline processor", () => {
    const run = (core: string) => {
        let Processor: any = null;
        class AudioWorkletProcessor { port = { onmessage: null as any, posted: [] as any[], postMessage(m: any) { this.posted.push(m); } }; }
        const register = (name: string, p: any) => { if (name == "faust-sync-timeline") Processor = p; };
        new Function("registerProcessor", "AudioWorkletProcessor", "sampleRate", "currentFrame", processorSource(core))(register, AudioWorkletProcessor, 48000, 0);
        const node = new Processor();
        node.port.onmessage({ data: TimelineCore.rule(0, 0, 0, 120, 4, true, 48000) });
        const out = Array.from({ length: 7 }, () => new Float32Array(128));
        expect(node.process([], [out])).toBe(true);
        // a correction backwards (held): all the code of the core runs, with nothing outside the class
        node.port.onmessage({ data: TimelineCore.rule(24, 0, 0, 120, 4, true, 48000) });
        const next = Array.from({ length: 7 }, () => new Float32Array(128));
        expect(node.process([], [next])).toBe(true);
        expect(next[1][0]).toBe(1);
        // the second block started at the frame of the first (currentFrame stays 0 here): a jump, reported
        expect(node.port.posted).toEqual([{ jumps: 1 }]);
        return out;
    };

    it("runs from the source of the class, named or anonymous", () => {
        const named = TimelineCore.toString();
        const anonymous = named.replace(/^class\s+TimelineCore\s*/, "class ");
        expect(anonymous.startsWith("class {")).toBe(true);
        for (const core of [named, anonymous]) {
            const out = run(core);
            expect(out[1][0]).toBe(1);                       // running
            expect(out[2][0]).toBe(1);                       // the start
            expect(out[0][127]).toBeCloseTo(127 * 2 / 48000, 9);
        }
    });
});
