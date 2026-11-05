// faust-sync (Documentation/FAUST-SYNC-SPEC.md): the timeline and its operations (continuous, taking effect LEAD ms
// later, the most recent revision winning), the Timeline core (the position at every sample, a rule switched exactly
// at its frame, the start), the reserved inputs of a module (declare sync) and their place after the modulations.
import { describe, expect, it } from "vitest";
import { apply, barBeat, beatAt, LEAD, newer, newTimeline, Timeline } from "../../src/sync/Timeline";
import { TimelineCore } from "../../src/sync/TimelineCore";
import { syncInputs } from "../../src/sync/SyncInputs";
import { modulatedCode } from "../../src/model/Modulation";

const playing = (t0: number): Timeline => ({ ...newTimeline(0, "a"), playing: true, anchor: { time: t0, beat: 0 }, revision: { time: t0, origin: "a" } });

describe("timeline", () => {
    it("gives the position at any time, 2 beats per second at 120", () => {
        const t = playing(1000);
        expect(beatAt(t, 1000)).toBe(0);
        expect(beatAt(t, 3500)).toBe(5);
        expect(beatAt({ ...t, playing: false }, 9999)).toBe(0);
        expect(barBeat(5, 4)).toEqual({ bar: 2, beat: 2 });
    });

    it("applies an operation LEAD ms later, without a jump; play from the start, stop, locate", () => {
        const t = playing(0);
        const faster = apply(t, { type: "tempo", tempo: 90 }, 2000, "b");
        expect(faster.anchor).toEqual({ time: 2000 + LEAD, beat: beatAt(t, 2000 + LEAD) });
        expect(faster.tempo).toBe(90);
        expect(faster.revision).toEqual({ time: 2000, origin: "b" });
        // continuous at the effect, then at 90
        expect(beatAt(faster, 2000 + LEAD)).toBeCloseTo(beatAt(t, 2000 + LEAD), 9);
        expect(beatAt(faster, 2000 + LEAD + 2000)).toBeCloseTo(beatAt(t, 2000 + LEAD) + 3, 9);
        const stopped = apply(faster, { type: "stop" }, 5000, "a");
        expect(stopped.playing).toBe(false);
        expect(beatAt(stopped, 99999)).toBeCloseTo(beatAt(faster, 5000 + LEAD), 9);
        expect(apply(stopped, { type: "stop" }, 6000, "a")).toBe(stopped);           // nothing to do
        expect(apply(stopped, { type: "play", fromStart: true }, 7000, "a").anchor).toEqual({ time: 7000 + LEAD, beat: 0 });
        expect(apply(stopped, { type: "locate", beat: 8 }, 7000, "a").anchor.beat).toBe(8);
    });

    it("orders the revisions: the later one, then the larger origin", () => {
        const a = { ...newTimeline(0, "a"), revision: { time: 10, origin: "a" } };
        const b = { ...newTimeline(0, "b"), revision: { time: 10, origin: "b" } };
        expect(newer(b, a)).toBe(true);
        expect(newer(a, b)).toBe(false);
        expect(newer({ ...a, revision: { time: 11, origin: "a" } }, b)).toBe(true);
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
