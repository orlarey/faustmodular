/*				RECORDING.TS
    Recording from the transport (Documentation/STORE-SPEC.md, "Enregistrer depuis faustmodular"): the samples where a
    recording starts and ends, exact, from the rule of the shared timeline (src/sync/TimelineCore.ts) in this context:

        position(f) = tick0 + (rem0 + (f − frame0)·inc) / den        (inc = tempo·100·PPQ, den = 6000·sampleRate)

    - It starts at the first start of a bar at or after a sample: the bar start T = the smallest multiple of
      meter·PPQ ≥ the position there, and its sample is the first f with position(f) ≥ T,
          f = frame0 + ⌈((T − tick0)·den − rem0) / inc⌉,
      the very sample where the Sync Clocks see the bar begin (their index crosses it). In big integers: exact.
    - It lasts a number of bars (the same formula for the tick of its end), or until it is stopped.
    - The file: WAV, PCM 24 bits (Faust computes in floats; 16 bits would need a dither), as in faustcode
      (spec_record_wav.md), WAVE_FORMAT_EXTENSIBLE beyond 2 channels.
    Pure.
*/

import { TimelineCore, TimelineRule } from "../sync/TimelineCore";

const PPQ = TimelineCore.PPQ;

// The ticks of a bar.
export const ticksPerBar = (meter: number) => Math.max(1, Math.round(meter)) * PPQ;

// The first sample whose position is at or after `tick`, for a rule that plays (null if it does not).
export function frameOfTick(rule: TimelineRule, tick: number): number | null {
    if (!rule.playing || rule.inc <= 0) return null;
    const needed = BigInt(tick - rule.tick) * BigInt(rule.den) - BigInt(rule.rem);
    if (needed <= 0n) return rule.frame + Number(needed / BigInt(rule.inc));       // at or before the anchor
    const inc = BigInt(rule.inc);
    return rule.frame + Number((needed + inc - 1n) / inc);
}

// The start of a recording: the first start of a bar at or after the sample `from` (and after the anchor of the rule).
export function barStart(rule: TimelineRule, from: number): { tick: number; frame: number } | null {
    if (!rule.playing) return null;
    const f = Math.max(from, rule.frame);
    const p = TimelineCore.advance(rule.tick, rule.rem, f - rule.frame, rule.inc, rule.den);
    const bar = ticksPerBar(rule.meter);
    const exact = p.tick + (p.rem > 0 ? 1 : 0);                 // the first whole tick at or after f
    const tick = Math.ceil(exact / bar) * bar;
    const frame = frameOfTick(rule, tick);
    return frame === null ? null : { tick, frame };
}

// The end of a recording of `bars` bars started at the tick `start`.
export function barsEnd(rule: TimelineRule, start: number, bars: number): number | null {
    return frameOfTick(rule, start + bars * ticksPerBar(rule.meter));
}

// ---------------------------------------------------------------------------------------------------------------
// The file

const RIFF = 0x46464952, WAVE = 0x45564157, FMT = 0x20746d66, DATA = 0x61746164;
const PCM = 1, EXTENSIBLE = 0xfffe;
const PCM24 = 8388607;

// WAV, PCM 24 bits, interleaved; the samples bounded to [−1, 1] (NaN: 0). `clipped`: how many were beyond.
export function encodePcm24Wav(channels: Float32Array[], sampleRate: number): { bytes: Uint8Array; clipped: number } {
    const n = channels.length;
    const frames = n > 0 ? channels[0].length : 0;
    const blockAlign = n * 3;
    const dataSize = frames * blockAlign;
    const extensible = n > 2;
    const fmtSize = extensible ? 40 : 16;
    const header = 12 + 8 + fmtSize + 8;
    const total = header + dataSize + (dataSize & 1);
    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, RIFF, true);
    view.setUint32(4, total - 8, true);
    view.setUint32(8, WAVE, true);
    view.setUint32(12, FMT, true);
    view.setUint32(16, fmtSize, true);
    view.setUint16(20, extensible ? EXTENSIBLE : PCM, true);
    view.setUint16(22, n, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 24, true);
    if (extensible) {
        view.setUint16(36, 22, true);           // cbSize
        view.setUint16(38, 24, true);           // valid bits
        view.setUint32(40, 0, true);            // no speaker mapping: the outputs are discrete
        view.setUint32(44, PCM, true);          // KSDATAFORMAT_SUBTYPE_PCM
        view.setUint16(48, 0x0000, true);
        view.setUint16(50, 0x0010, true);
        bytes.set([0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 52);
    }
    view.setUint32(header - 8, DATA, true);
    view.setUint32(header - 4, dataSize, true);
    let o = header, clipped = 0;
    for (let i = 0; i < frames; i++) {
        for (let c = 0; c < n; c++) {
            let x = channels[c][i];
            if (x > 1) { x = 1; clipped++; } else if (x < -1) { x = -1; clipped++; } else if (x !== x) x = 0;
            const v = Math.round(x * PCM24);
            bytes[o] = v & 0xff;
            bytes[o + 1] = (v >> 8) & 0xff;
            bytes[o + 2] = (v >> 16) & 0xff;
            o += 3;
        }
    }
    return { bytes, clipped };
}

// `<scene>-YYYYMMDD-HHMMSS.wav`, local time; the name of the scene kept to letters, digits, "-" and "_".
export function recordingName(scene: string, date: Date, extension = "wav"): string {
    const base = (scene ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
        .replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "faustmodular";
    const p = (k: number) => String(k).padStart(2, "0");
    return `${base}-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.${extension}`;
}

// The blocks of a recording put end to end, one array per channel.
export function joinBlocks(blocks: Float32Array[][], channels: number): Float32Array[] {
    const frames = blocks.reduce((n, b) => n + (b[0]?.length ?? 0), 0);
    const out = Array.from({ length: channels }, () => new Float32Array(frames));
    let at = 0;
    for (const b of blocks) {
        const len = b[0]?.length ?? 0;
        for (let c = 0; c < channels; c++) if (b[c]) out[c].set(b[c], at);
        at += len;
    }
    return out;
}
