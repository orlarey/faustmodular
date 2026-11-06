// faust-sync (Documentation/FAUST-SYNC-SPEC.md): the timeline and its operations (continuous, taking effect LEAD ms
// later, the most recent revision winning), the Timeline core (the position at every sample, a rule switched exactly
// at its frame, the start), the reserved inputs of a module (declare sync) and their place after the modulations.
import { describe, expect, it } from "vitest";
import { apply, barBeat, beatAt, newer, newTimeline, rebase, Timeline } from "../../src/sync/Timeline";
import { TimelineCore } from "../../src/sync/TimelineCore";
import { processorSource } from "../../src/sync/SharedTimeline";
import { syncInputs } from "../../src/sync/SyncInputs";
import { modulatedCode } from "../../src/model/Modulation";

// on the clock "a", playing from 1 s
const playing = (t0: number): Timeline => ({ ...newTimeline("a"), playing: true, anchor: { clock: "a", time: t0, beat: 0 }, revision: { time: 5, origin: "a" } });
const position = (t: Timeline) => (time: number) => beatAt(t, time);

describe("timeline", () => {
    it("gives the position at any time of the clock of its anchor, 2 beats per second at 120", () => {
        const t = playing(1);
        expect(beatAt(t, 1)).toBe(0);
        expect(beatAt(t, 3.5)).toBe(5);
        expect(beatAt({ ...t, playing: false }, 99)).toBe(0);
        expect(barBeat(5, 4)).toEqual({ bar: 2, beat: 2 });
    });

    it("applies an operation at its effect on the clock of its author, without a jump; play from the start, stop, locate", () => {
        const t = playing(0);
        // b decides at the common time 2000 ms; its clock is 0.3 s behind the clock "a": the effect at 1.72 s of "b"
        // is 2.02 s of "a"
        const effect = { clock: "b", time: 1.72 };
        const faster = apply(t, { type: "tempo", tempo: 90 }, 2000, "b", effect, (time) => beatAt(t, time + 0.3));
        expect(faster.anchor).toEqual({ clock: "b", time: 1.72, beat: beatAt(t, 2.02) });
        expect(faster.tempo).toBe(90);
        expect(faster.revision).toEqual({ time: 2000, origin: "b" });
        // on the clock "b", continuous at the effect, then at 90
        expect(beatAt(faster, 1.72 + 2)).toBeCloseTo(beatAt(t, 2.02) + 3, 9);
        const back = rebase(faster, "a", -0.3);
        expect(back.anchor).toEqual({ clock: "a", time: 2.02, beat: faster.anchor.beat });
        expect(beatAt(back, 4.02)).toBeCloseTo(beatAt(faster, 3.72), 9);
        const stopped = apply(faster, { type: "stop" }, 5000, "b", { clock: "b", time: 5 }, position(faster));
        expect(stopped.playing).toBe(false);
        expect(beatAt(stopped, 99)).toBeCloseTo(beatAt(faster, 5), 9);
        expect(apply(stopped, { type: "stop" }, 6000, "a", { clock: "a", time: 6 }, position(stopped))).toBe(stopped);   // nothing to do
        expect(apply(stopped, { type: "play", fromStart: true }, 7000, "a", { clock: "a", time: 7 }, position(stopped)).anchor).toEqual({ clock: "a", time: 7, beat: 0 });
        expect(apply(stopped, { type: "locate", beat: 8 }, 7000, "a", { clock: "a", time: 7 }, position(stopped)).anchor.beat).toBe(8);
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
        const out = Array.from({ length: 5 }, () => new Float32Array(length));
        core.render(start, out, length);
        return out;
    };

    it("switches to a rule exactly at its frame, with a start, and gives the position in the bar", () => {
        const core = new TimelineCore(48000);
        core.schedule({ frame: 100, beat: 0, tempo: 120, meter: 4, playing: true });
        const [beat, run, start, tempo, meter] = render(core, 0, 256);
        expect(Array.from(run.slice(0, 100)).every((v) => v == 0)).toBe(true);
        expect(run[100]).toBe(1);
        expect(start[100]).toBe(1);
        expect(start.reduce((n, v) => n + v, 0)).toBe(1);                         // one sample
        expect(beat[100]).toBe(0);
        expect(beat[200]).toBeCloseTo(100 * 120 / 60 / 48000, 9);
        expect([tempo[200], meter[200]]).toEqual([120, 4]);
        // two bars later (4 s at 120): the position wraps in the bar
        const later = render(core, 100 + 48000 * 2.5, 1)[0][0];
        expect(later).toBeCloseTo(1, 4);                                        // 5 beats: bar 2, beat 2
    });

    it("applies a late rule at once, and drops the waiting rules a newer one replaces", () => {
        const core = new TimelineCore(48000);
        render(core, 0, 128);
        core.schedule({ frame: 64, beat: 4, tempo: 60, meter: 4, playing: true });     // already rendered
        const [beat] = render(core, 128, 1);
        expect(beat[0]).toBeCloseTo((4 + 64 / 48000) % 4, 9);
        core.schedule({ frame: 10000, beat: 0, tempo: 120, meter: 4, playing: false });
        core.schedule({ frame: 5000, beat: 2, tempo: 90, meter: 3, playing: true });     // replaces the one at 10000
        expect(core.pending.map((r) => r.frame)).toEqual([5000]);
    });
});

describe("Timeline core: corrections", () => {
    const run = (core: TimelineCore, start: number, n: number) => {
        const out = [0, 1, 2, 3, 4].map(() => new Float32Array(n));
        core.render(start, out, n);
        return out[0];
    };

    it("does not go back for a small correction: the position waits, then follows the new rule", () => {
        const core = new TimelineCore(48000);
        core.schedule({ frame: 0, beat: 0, tempo: 120, meter: 4, playing: true });
        run(core, 0, 48000);                                    // 2 beats
        // the same rule, 0.5 ms later (24 samples): at frame 48000 it gives 2 − 0.001 beat
        core.schedule({ frame: 24, beat: 0, tempo: 120, meter: 4, playing: true });
        const beat = run(core, 48000, 128);
        for (let i = 1; i < 128; i++) expect(beat[i]).toBeGreaterThanOrEqual(beat[i - 1]);
        expect(beat[0]).toBeCloseTo(2, 4);
        expect(beat[23]).toBeCloseTo(2, 4);                     // held 24 samples
        expect(beat[127]).toBeCloseTo((48000 + 127 - 24) * 2 / 48000, 4);
    });

    it("goes back for a real move: from the start, or a locate", () => {
        const core = new TimelineCore(48000);
        core.schedule({ frame: 0, beat: 0, tempo: 120, meter: 4, playing: true });
        run(core, 0, 48000);
        core.schedule({ frame: 48000, beat: 1, tempo: 120, meter: 4, playing: true });   // back by a beat (0.5 s)
        expect(run(core, 48000, 4)[0]).toBeCloseTo(1, 6);
    });
});

describe("reserved inputs", () => {
    it("are read from declare sync, as channels of the Timeline node", () => {
        expect(syncInputs('declare sync "beat; run; start; tempo; meter";\nprocess = _;')).toEqual([0, 1, 2, 3, 4]);
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
        node.port.onmessage({ data: { frame: 0, beat: 0, tempo: 120, meter: 4, playing: true } });
        const out = [0, 1, 2, 3, 4].map(() => new Float32Array(128));
        expect(node.process([], [out])).toBe(true);
        // a correction backwards (held): all the code of the core runs, with nothing outside the class
        node.port.onmessage({ data: { frame: 24, beat: 0, tempo: 120, meter: 4, playing: true } });
        const next = [0, 1, 2, 3, 4].map(() => new Float32Array(128));
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
