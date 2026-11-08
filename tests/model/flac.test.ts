// The FLAC encoder (src/audio/Flac.ts): lossless, bit for bit, on signals that take each of its ways (silence,
// tones, noise, a square wave, clipping, a stereo field correlated or not, odd lengths, 1 to 8 channels, 16 and 24
// bits); checked by a decoder written from the RFC (CRCs included), and by ffmpeg when it is installed (its CRC
// checks on). Smaller than the WAV of the same samples.
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { encodeFlac } from "../../src/audio/Flac";
import { encodePcm24Wav } from "../../src/audio/Recording";
import { decodeFlac } from "../helpers/flac-decode";

function noise(seed: number) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 31 - 1; };
}

function signal(kind: string, n: number, sr = 48000, seed = 1): Float32Array {
    const x = new Float32Array(n), rnd = noise(seed);
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        switch (kind) {
            case "silence": x[i] = 0; break;
            case "sine": x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * t); break;
            case "chord": x[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 331 * t) + 0.1 * Math.sin(2 * Math.PI * 1761 * t); break;
            case "noise": x[i] = 0.9 * rnd(); break;
            case "square": x[i] = Math.sin(2 * Math.PI * 100 * t) >= 0 ? 0.8 : -0.8; break;
            case "clip": x[i] = 1.5 * Math.sin(2 * Math.PI * 50 * t); break;
            case "decay": x[i] = Math.exp(-t * 3) * Math.sin(2 * Math.PI * 880 * t) * (rnd() * 0.01 + 1); break;
        }
    }
    return x;
}

// The integers the encoder codes (as the WAV 24 bits).
function ints(x: Float32Array, bits: number): Int32Array {
    const scale = 2 ** (bits - 1) - 1;
    return Int32Array.from(x, (v) => Math.round(Math.max(-1, Math.min(1, v)) * scale));
}

function hasFfmpeg(): boolean {
    try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

// ffmpeg's decoding, as signed 32-bit samples (24 bits shifted left by 8), interleaved; errors fatal (CRC checks on).
function ffmpegDecode(bytes: Uint8Array): Int32Array {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flac-")), "x.flac");
    fs.writeFileSync(file, bytes);
    const out = execFileSync("ffmpeg", ["-v", "error", "-xerror", "-err_detect", "crccheck+bitstream+buffer+explode", "-i", file, "-f", "s32le", "-"], { maxBuffer: 1 << 28 });
    return new Int32Array(out.buffer, out.byteOffset, out.byteLength / 4);
}

const cases: Array<{ name: string; channels: Float32Array[]; bits?: 16 | 24; sr?: number }> = [
    { name: "silence, stereo", channels: [signal("silence", 9000), signal("silence", 9000)] },
    { name: "a tone, mono", channels: [signal("sine", 4096 * 3)] },
    { name: "a chord, stereo, the same in both channels", channels: [signal("chord", 20000), signal("chord", 20000)] },
    { name: "a chord and noise, stereo", channels: [signal("chord", 12345), signal("noise", 12345)] },
    { name: "noise, stereo", channels: [signal("noise", 10000, 48000, 1), signal("noise", 10000, 48000, 2)] },
    { name: "a square wave", channels: [signal("square", 7777)] },
    { name: "clipping", channels: [signal("clip", 5000), signal("sine", 5000)] },
    { name: "a decay, 16 bits", channels: [signal("decay", 30000), signal("decay", 30000, 48000, 3)], bits: 16 },
    { name: "a few samples", channels: [signal("sine", 5), signal("noise", 5)] },
    { name: "3 channels at 44.1 kHz", channels: [signal("sine", 6000, 44100), signal("noise", 6000, 44100), signal("silence", 6000, 44100)], sr: 44100 },
    { name: "8 channels", channels: Array.from({ length: 8 }, (_, c) => signal(["sine", "noise", "chord", "square"][c % 4], 4500, 48000, c + 1)) },
];

describe("FLAC encoder", () => {
    for (const c of cases) {
        it(`is lossless: ${c.name}`, () => {
            const bits = c.bits ?? 24, sr = c.sr ?? 48000;
            const flac = encodeFlac(c.channels, sr, { bits });
            const d = decodeFlac(flac);
            expect(d.sampleRate).toBe(sr);
            expect(d.bits).toBe(bits);
            expect(d.total).toBe(c.channels[0].length);
            d.channels.forEach((x, k) => expect(Array.from(x)).toEqual(Array.from(ints(c.channels[k], bits))));
        });
    }

    it.skipIf(!hasFfmpeg())("is read by ffmpeg, bit for bit, its CRC checks on", () => {
        for (const c of cases.filter((x) => (x.bits ?? 24) == 24)) {
            const out = ffmpegDecode(encodeFlac(c.channels, c.sr ?? 48000));
            const n = c.channels.length, frames = c.channels[0].length;
            expect(out.length, c.name).toBe(n * frames);
            const expected = c.channels.map((x) => ints(x, 24));
            for (let i = 0; i < frames; i++) for (let k = 0; k < n; k++) {
                if (out[i * n + k] !== expected[k][i] * 256) throw new Error(`${c.name}: sample ${i} channel ${k}: ${out[i * n + k] / 256} instead of ${expected[k][i]}`);
            }
        }
    });

    it("is smaller than the WAV: a chord by half at least, silence almost nothing", () => {
        const chord = [signal("chord", 48000 * 4), signal("chord", 48000 * 4, 48000, 2)];
        const wav = encodePcm24Wav(chord, 48000).bytes.length;
        expect(encodeFlac(chord, 48000).length).toBeLessThan(wav / 2);
        const silence = [signal("silence", 48000 * 4), signal("silence", 48000 * 4)];
        expect(encodeFlac(silence, 48000).length).toBeLessThan(2000);
    });
});
