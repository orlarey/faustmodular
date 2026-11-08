// Recording from the transport (src/audio/Recording.ts): the samples where it starts and ends, exact, the very ones
// where the Timeline node (TimelineCore) sees the bar begin; the WAV 24 bits; the name of the file.
import { describe, expect, it } from "vitest";
import { barsEnd, barStart, encodePcm24Wav, frameOfTick, joinBlocks, recordingName, ticksPerBar } from "../../src/audio/Recording";
import { TimelineCore } from "../../src/sync/TimelineCore";

const PPQ = TimelineCore.PPQ;

// The first sample where the core sees a tick (integer position) reach `tick`, by stepping it sample by sample.
function crossing(core: TimelineCore, from: number, tick: number, limit = 10_000_000): number {
    for (let f = from; f < from + limit; f++) {
        if (core.positionOf(core.current, f).tick >= tick) return f;
    }
    throw new Error("not reached");
}

describe("recording: its samples", () => {
    it("the sample of a tick is the first one where the position reaches it, at any tempo and phase", () => {
        for (const [tempo, sampleRate, phase, frame] of [[120, 48000, 0, 0], [97.53, 44100, 0.37, 12345], [133.33, 48000, 0.999, 777], [60, 96000, 0, 5]] as const) {
            const rule = TimelineCore.rule(frame, 10, phase, tempo, 4, true, sampleRate);
            const core = new TimelineCore(sampleRate);
            core.current = rule;
            for (const tick of [11, 960, 3840, 3840 * 3 + 1]) {
                expect(frameOfTick(rule, tick), `${tempo} ${tick}`).toBe(crossing(core, frame, tick));
            }
        }
    });

    it("starts at the first start of a bar at or after a sample; the anchor itself when it is one", () => {
        const rule = TimelineCore.rule(1000, 0, 0, 120, 4, true, 48000);
        // stopped at 1:1, then played: the recording starts with the transport
        expect(barStart(rule, 0)).toEqual({ tick: 0, frame: 1000 });
        // 120 BPM: a beat every 24000 samples, a bar every 96000
        expect(barStart(rule, 1001)).toEqual({ tick: ticksPerBar(4), frame: 1000 + 96000 });
        expect(barStart(rule, 1000 + 96000)).toEqual({ tick: ticksPerBar(4), frame: 1000 + 96000 });
        expect(barStart(TimelineCore.rule(0, 0, 0, 120, 3, true, 48000), 1)).toEqual({ tick: 3 * PPQ, frame: 72000 });
        // stopped: no start
        expect(barStart(TimelineCore.rule(0, 0, 0, 120, 4, false, 48000), 0)).toBeNull();
    });

    it("lasts exactly its bars: 1 bar of 4/4 at 120 BPM is 2 s, at any rate", () => {
        for (const sampleRate of [44100, 48000, 96000]) {
            const rule = TimelineCore.rule(0, 0, 0, 120, 4, true, sampleRate);
            const start = barStart(rule, 0)!;
            expect(barsEnd(rule, start.tick, 1)! - start.frame).toBe(2 * sampleRate);
            expect(barsEnd(rule, start.tick, 8)! - start.frame).toBe(16 * sampleRate);
        }
        // a tempo that does not divide the rate: the bars do not have a whole number of samples, but their sum is exact
        const rule = TimelineCore.rule(0, 0, 0, 133.33, 4, true, 44100);
        const length = barsEnd(rule, 0, 7)!;
        expect(length).toBe(Math.ceil(7 * 4 * 60 / 133.33 * 44100 - 1e-9));
    });
});

describe("recording: the file", () => {
    it("WAV PCM 24 bits: header, interleaved samples, clipping counted", () => {
        const l = new Float32Array([0, 1, -1, 2]);
        const r = new Float32Array([0.5, -0.5, NaN, -3]);
        const { bytes, clipped } = encodePcm24Wav([l, r], 48000);
        const v = new DataView(bytes.buffer);
        const text = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
        expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
        expect(v.getUint16(20, true)).toBe(1);          // PCM
        expect(v.getUint16(22, true)).toBe(2);
        expect(v.getUint32(24, true)).toBe(48000);
        expect(v.getUint16(34, true)).toBe(24);
        expect(v.getUint32(40, true)).toBe(4 * 2 * 3);
        const sample = (i: number) => { const o = 44 + i * 3; const x = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16); return x & 0x800000 ? x - 0x1000000 : x; };
        expect([0, 1, 2, 3, 4, 5, 6, 7].map(sample)).toEqual([0, 4194304, 8388607, -4194303, -8388607, 0, 8388607, -8388607]);
        expect(clipped).toBe(2);
        // beyond 2 channels: WAVE_FORMAT_EXTENSIBLE
        const many = encodePcm24Wav([l, l, l], 44100).bytes;
        expect(new DataView(many.buffer).getUint16(20, true)).toBe(0xfffe);
    });

    it("the blocks put end to end; the name of the file", () => {
        const joined = joinBlocks([[new Float32Array([1, 2]), new Float32Array([3, 4])], [new Float32Array([5]), new Float32Array([6])]], 2);
        expect(joined.map((c) => [...c])).toEqual([[1, 2, 5], [3, 4, 6]]);
        expect(recordingName("Ma scène 2", new Date(2026, 10, 8, 9, 5, 7))).toBe("Ma-scene-2-20261108-090507.wav");
        expect(recordingName("", new Date(2026, 0, 1, 0, 0, 0))).toBe("faustmodular-20260101-000000.wav");
    });
});
