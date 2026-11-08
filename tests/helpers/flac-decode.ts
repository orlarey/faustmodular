// A FLAC decoder for the tests of the encoder (src/audio/Flac.ts): what it writes (STREAMINFO, fixed blocking,
// CONSTANT, VERBATIM and FIXED subframes, Rice codes with 4- or 5-bit parameters and escapes, the four stereo
// assignments), the CRC-8 of each header and the CRC-16 of each frame checked. Written from RFC 9639, apart from the
// encoder.
import { crc16, crc8 } from "../../src/audio/Flac";

class BitReader {
    pos = 0;    // in bits
    constructor(readonly bytes: Uint8Array) { }
    bit(): number {
        const b = (this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
        this.pos++;
        return b;
    }
    read(n: number): number {
        let v = 0;
        for (let i = 0; i < n; i++) v = v * 2 + this.bit();
        return v;
    }
    signed(n: number): number {
        if (n == 0) return 0;
        const v = this.read(n);
        return v >= 2 ** (n - 1) ? v - 2 ** n : v;
    }
    unary(): number {
        let q = 0;
        while (this.bit() == 0) q++;
        return q;
    }
    align(): void {
        this.pos = (this.pos + 7) & ~7;
    }
}

export interface Decoded { sampleRate: number; bits: number; channels: Int32Array[]; total: number; frames: number }

export function decodeFlac(bytes: Uint8Array): Decoded {
    const r = new BitReader(bytes);
    if (r.read(32) != 0x664c6143) throw new Error("not fLaC");
    let sampleRate = 0, nch = 0, bits = 0, total = 0;
    for (let last = 0; !last;) {
        last = r.bit();
        const type = r.read(7), length = r.read(24);
        const end = r.pos + length * 8;
        if (type == 0) {
            r.read(16); r.read(16); r.read(24); r.read(24);
            sampleRate = r.read(20);
            nch = r.read(3) + 1;
            bits = r.read(5) + 1;
            total = r.read(4) * 2 ** 32 + r.read(32);
        }
        r.pos = end;
    }
    const channels = Array.from({ length: nch }, () => new Int32Array(total));
    let at = 0, frames = 0;
    while (at < total) {
        const begin = r.pos >> 3;
        if (r.read(16) != 0xfff8) throw new Error(`sync at ${begin}`);
        const bsCode = r.read(4), srCode = r.read(4), assignment = r.read(4), ssCode = r.read(3);
        r.read(1);
        if (srCode != 0 || ssCode != 0) throw new Error("rate or size not from STREAMINFO");
        // the frame number (coded)
        let first = r.read(8), extra = 0;
        while (first & (0x80 >> extra)) extra++;
        for (let i = 1; i < extra; i++) r.read(8);
        let n: number;
        if (bsCode == 0b0111) n = r.read(16) + 1;
        else if (bsCode == 0b0110) n = r.read(8) + 1;
        else if (bsCode >= 8) n = 256 << (bsCode - 8);
        else throw new Error(`block size code ${bsCode}`);
        const headerEnd = r.pos >> 3;
        if (r.read(8) != crc8(bytes, begin, headerEnd)) throw new Error(`CRC-8 of frame ${frames}`);
        const sub: Int32Array[] = [];
        for (let c = 0; c < nch; c++) {
            const extraBit = (assignment == 8 && c == 1) || (assignment == 9 && c == 0) || (assignment == 10 && c == 1) ? 1 : 0;
            const bps = bits + extraBit;
            if (r.bit() != 0) throw new Error("padding bit");
            const type = r.read(6);
            if (r.bit() != 0) throw new Error("wasted bits");
            const x = new Int32Array(n);
            if (type == 0) x.fill(r.signed(bps));
            else if (type == 1) for (let i = 0; i < n; i++) x[i] = r.signed(bps);
            else if (type >= 8 && type <= 12) {
                const order = type - 8;
                for (let i = 0; i < order; i++) x[i] = r.signed(bps);
                const method = r.read(2), pBits = method == 0 ? 4 : 5, escapeCode = (1 << pBits) - 1;
                const po = r.read(4), parts = 1 << po;
                const e = new Array<number>(n).fill(0);
                let i = order;
                for (let p = 0; p < parts; p++) {
                    const count = (n >> po) - (p == 0 ? order : 0);
                    const k = r.read(pBits);
                    if (k == escapeCode) {
                        const width = r.read(5);
                        for (let j = 0; j < count; j++) e[i++] = r.signed(width);
                    } else {
                        for (let j = 0; j < count; j++) {
                            const v = r.unary() * 2 ** k + r.read(k);
                            e[i++] = v % 2 == 0 ? v / 2 : -(v + 1) / 2;
                        }
                    }
                }
                for (let j = order; j < n; j++) {
                    const p = [0, x[j - 1], 2 * x[j - 1] - x[j - 2], 3 * x[j - 1] - 3 * x[j - 2] + x[j - 3], 4 * x[j - 1] - 6 * x[j - 2] + 4 * x[j - 3] - x[j - 4]][order];
                    x[j] = e[j] + p;
                }
            } else throw new Error(`subframe type ${type}`);
            sub.push(x);
        }
        r.align();
        const end = r.pos >> 3;
        if (r.read(16) != crc16(bytes, begin, end)) throw new Error(`CRC-16 of frame ${frames}`);
        let out = sub;
        if (assignment == 8) out = [sub[0], sub[0].map((l, i) => l - sub[1][i])];
        else if (assignment == 9) out = [sub[1].map((rr, i) => rr + sub[0][i]), sub[1]];
        else if (assignment == 10) {
            const L = new Int32Array(n), R = new Int32Array(n);
            for (let i = 0; i < n; i++) {
                const side = sub[1][i], mid = sub[0][i] * 2 + (side & 1);
                L[i] = (mid + side) >> 1;
                R[i] = (mid - side) >> 1;
            }
            out = [L, R];
        }
        out.forEach((x, c) => channels[c].set(x, at));
        at += n;
        frames++;
    }
    return { sampleRate, bits, channels, total, frames };
}
