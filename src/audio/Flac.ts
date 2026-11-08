/*				FLAC.TS
    A FLAC encoder (RFC 9639), for the recordings (Documentation/STORE-SPEC.md, "Les médias": lossless, about half the
    size of a WAV). Pure, without dependency; what it writes:

    - the stream: "fLaC", STREAMINFO (its MD5 left at 0: "not computed", allowed by the format);
    - frames of 4096 samples (the last one shorter), fixed blocking, numbered; header CRC-8, frame CRC-16;
    - each channel: a FIXED subframe (predictors of order 0 to 4: the differences of order k of the signal), the
      residual in partitioned Rice codes (5-bit parameters, partition order 0 to 8, an escape when it is better),
      or CONSTANT (silence), or VERBATIM when nothing is smaller;
    - stereo: the best of left/right, left/side, side/right, mid/side (side = L − R on one bit more,
      mid = (L + R) >> 1), by the exact size of each.

    The samples: floats bounded to [−1, 1], times 2^(bits−1) − 1, rounded (as the WAV 24 bits).
*/

class BitWriter {
    bytes = new Uint8Array(1 << 16);
    length = 0;         // bytes complete
    private acc = 0;    // bits pending (fewer than 8)
    private count = 0;

    private grow(extra: number): void {
        if (this.length + extra <= this.bytes.length) return;
        let size = this.bytes.length * 2;
        while (size < this.length + extra) size *= 2;
        const b = new Uint8Array(size);
        b.set(this.bytes.subarray(0, this.length));
        this.bytes = b;
    }

    // `n` bits of `value` (n ≤ 32; value as an unsigned integer of n bits).
    write(value: number, n: number): void {
        if (n > 24) {
            this.write(Math.floor(value / 0x1000000) % (1 << (n - 24)), n - 24);
            this.write(value % 0x1000000, 24);
            return;
        }
        this.grow(4);
        this.acc = (this.acc << n) | (value & ((1 << n) - 1));
        this.count += n;
        while (this.count >= 8) {
            this.count -= 8;
            this.bytes[this.length++] = (this.acc >>> this.count) & 0xff;
        }
        this.acc &= (1 << this.count) - 1;
    }

    signed(value: number, n: number): void {
        this.write(value < 0 ? value + 2 ** n : value, n);
    }

    // q zeros, then a one.
    unary(q: number): void {
        while (q >= 24) { this.write(0, 24); q -= 24; }
        this.write(1, q + 1);
    }

    align(): void {
        if (this.count > 0) this.write(0, 8 - this.count);
    }

    get bitLength(): number {
        return this.length * 8 + this.count;
    }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    CRC8[i] = c;
    let d = i << 8;
    for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
    CRC16[i] = d;
}

export function crc8(bytes: Uint8Array, from: number, to: number): number {
    let c = 0;
    for (let i = from; i < to; i++) c = CRC8[c ^ bytes[i]];
    return c;
}

export function crc16(bytes: Uint8Array, from: number, to: number): number {
    let c = 0;
    for (let i = from; i < to; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ bytes[i]];
    return c;
}

const BLOCK = 4096;
const MAX_PARTITION_ORDER = 8;
const MAX_RICE = 30;            // 5-bit parameters; 31 is the escape

// The residual of the fixed predictor of order `order` (0..4), for the samples from `order` on.
function residual(x: Int32Array, order: number, out: Float64Array): void {
    const n = x.length;
    for (let i = order; i < n; i++) {
        let e: number;
        switch (order) {
            case 0: e = x[i]; break;
            case 1: e = x[i] - x[i - 1]; break;
            case 2: e = x[i] - 2 * x[i - 1] + x[i - 2]; break;
            case 3: e = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
            default: e = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]; break;
        }
        out[i] = e;
    }
}

// The cheapest Rice parameter for a partition, from the sum and the largest of its folded residuals u (u = 2e for
// e ≥ 0, −2e − 1 otherwise) and its count: the cost of k is count·(1 + k) + Σ⌊u / 2^k⌋, estimated by ⌊Σu / 2^k⌋ (as
// the reference encoder; the bits written are exact whatever the choice), or the escape (the residuals as they are,
// on the signed width of the largest).
function riceCost(sum: number, max: number, count: number): { k: number; bits: number } {
    if (count == 0) return { k: 0, bits: 5 };
    const mean = sum / count;
    const k0 = mean > 1 ? Math.floor(Math.log2(mean)) : 0;
    let best = { k: 0, bits: Infinity };
    for (let k = Math.max(0, k0 - 1); k <= Math.min(MAX_RICE, k0 + 1); k++) {
        const bits = 5 + count * (1 + k) + Math.floor(sum / 2 ** k);
        if (bits < best.bits) best = { k, bits };
    }
    const width = max == 0 ? 0 : Math.floor(Math.log2(max)) + 2;
    const escape = 5 + 5 + count * width;
    return escape < best.bits ? { k: -width - 1, bits: escape } : best;
}

interface Plan { kind: "constant" | "verbatim" | "fixed"; order: number; bits: number; partitionOrder: number; params: number[] }

const PARTS = 1 << MAX_PARTITION_ORDER;
const partSum = new Float64Array(PARTS), partMax = new Float64Array(PARTS);

// The best way to code a channel of a block of `bps` bits per sample, and its size (estimated for the residual).
function planChannel(x: Int32Array, bps: number, e: Float64Array): Plan {
    const n = x.length;
    let constant = true;
    for (let i = 1; i < n && constant; i++) if (x[i] !== x[0]) constant = false;
    if (constant) return { kind: "constant", order: 0, bits: 8 + bps, partitionOrder: 0, params: [] };
    let best: Plan = { kind: "verbatim", order: 0, bits: 8 + n * bps, partitionOrder: 0, params: [] };
    // the finest partitioning that divides the block
    let top = 0;
    while (top < MAX_PARTITION_ORDER && n % (1 << (top + 1)) == 0) top++;
    for (let order = 0; order <= 4 && order < n; order++) {
        residual(x, order, e);
        // the sums and largest u of the finest partitions (the first one without the warm-up samples)
        const fine = 1 << top, size = n >> top;
        for (let p = 0; p < fine; p++) {
            let sum = 0, max = 0;
            for (let i = Math.max(p * size, order); i < (p + 1) * size; i++) {
                const v = e[i] >= 0 ? 2 * e[i] : -2 * e[i] - 1;
                sum += v;
                if (v > max) max = v;
            }
            partSum[p] = sum;
            partMax[p] = max;
        }
        // each partition order, from the finest up (two partitions summed into one)
        for (let po = top, count = fine; po >= 0; po--, count >>= 1) {
            const psize = n >> po;
            if (psize > order) {
                let bits = 8 + order * bps + 2 + 4;
                const params: number[] = [];
                for (let p = 0; p < count; p++) {
                    const c = riceCost(partSum[p], partMax[p], psize - (p == 0 ? order : 0));
                    bits += c.bits;
                    params.push(c.k);
                }
                if (bits < best.bits) best = { kind: "fixed", order, bits, partitionOrder: po, params };
            }
            if (po > 0) {
                for (let p = 0; p < count >> 1; p++) {
                    partSum[p] = partSum[2 * p] + partSum[2 * p + 1];
                    partMax[p] = Math.max(partMax[2 * p], partMax[2 * p + 1]);
                }
            }
        }
    }
    return best;
}

function writeChannel(w: BitWriter, x: Int32Array, bps: number, plan: Plan, e: Float64Array): void {
    const n = x.length;
    w.write(0, 1);
    if (plan.kind == "constant") {
        w.write(0b000000, 6);
        w.write(0, 1);
        w.signed(x[0], bps);
        return;
    }
    if (plan.kind == "verbatim") {
        w.write(0b000001, 6);
        w.write(0, 1);
        for (let i = 0; i < n; i++) w.signed(x[i], bps);
        return;
    }
    const order = plan.order;
    w.write(0b001000 | order, 6);
    w.write(0, 1);
    for (let i = 0; i < order; i++) w.signed(x[i], bps);
    residual(x, order, e);
    w.write(0b01, 2);                   // Rice codes with 5-bit parameters
    w.write(plan.partitionOrder, 4);
    const size = n >> plan.partitionOrder;
    plan.params.forEach((k, p) => {
        const from = p == 0 ? order : p * size, to = (p + 1) * size;
        if (k < 0) {
            const width = -k - 1;
            w.write(31, 5);
            w.write(width, 5);
            if (width > 0) for (let i = from; i < to; i++) w.signed(e[i], width);
            return;
        }
        w.write(k, 5);
        const div = 2 ** k;
        for (let i = from; i < to; i++) {
            const v = e[i] >= 0 ? 2 * e[i] : -2 * e[i] - 1;
            const q = Math.floor(v / div);
            w.unary(q);
            if (k > 0) w.write(v - q * div, k);
        }
    });
}

// The frame number, "UTF-8" coded.
function codedNumber(w: BitWriter, value: number): void {
    if (value < 0x80) { w.write(value, 8); return; }
    let bytes = 2;
    while (value >= 2 ** (5 * bytes + 1)) bytes++;
    const lead = (0xff00 >> bytes) & 0xff;
    w.write(lead | Math.floor(value / 2 ** (6 * (bytes - 1))), 8);
    for (let i = bytes - 2; i >= 0; i--) w.write(0x80 | (Math.floor(value / 2 ** (6 * i)) & 0x3f), 8);
}

export interface FlacOptions { bits?: 16 | 24 }

// The samples of a channel as integers of `bits` bits.
function toIntegers(channel: Float32Array, bits: number): Int32Array {
    const scale = 2 ** (bits - 1) - 1;
    const out = new Int32Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
        let x = channel[i];
        if (x > 1) x = 1; else if (x < -1) x = -1; else if (x !== x) x = 0;
        out[i] = Math.round(x * scale);
    }
    return out;
}

// A FLAC file of these channels (1 to 8), 24 bits by default.
export function encodeFlac(channels: Float32Array[], sampleRate: number, options: FlacOptions = {}): Uint8Array {
    const run = frames(channels, sampleRate, options);
    for (let step = run.next(); ; step = run.next()) if (step.done) return step.value;
}

// The same, giving the hand back to the page every 50 frames (about 4 s of sound): a long recording does not freeze it.
export async function encodeFlacAsync(channels: Float32Array[], sampleRate: number, options: FlacOptions = {}): Promise<Uint8Array> {
    const run = frames(channels, sampleRate, options);
    for (let step = run.next(), k = 0; ; step = run.next(), k++) {
        if (step.done) return step.value;
        if (k % 50 == 49) await new Promise((r) => setTimeout(r, 0));
    }
}

function* frames(channels: Float32Array[], sampleRate: number, options: FlacOptions): Generator<number, Uint8Array> {
    const bps = options.bits ?? 24;
    const nch = channels.length;
    if (nch < 1 || nch > 8) throw new Error(`FLAC: ${nch} channels (1 to 8)`);
    if (sampleRate < 1 || sampleRate > 655350) throw new Error(`FLAC: sample rate ${sampleRate}`);
    const total = nch ? channels[0].length : 0;
    const ints = channels.map((c) => toIntegers(c, bps));
    const w = new BitWriter();
    // "fLaC", STREAMINFO (last metadata block)
    w.write(0x664c6143, 32);
    w.write(1, 1);
    w.write(0, 7);
    w.write(34, 24);
    w.write(Math.min(BLOCK, Math.max(16, total)), 16);
    w.write(Math.min(BLOCK, Math.max(16, total)), 16);
    w.write(0, 24);
    w.write(0, 24);
    w.write(sampleRate, 20);
    w.write(nch - 1, 3);
    w.write(bps - 1, 5);
    w.write(Math.floor(total / 2 ** 32) % 16, 4);
    w.write(total % 2 ** 32, 32);
    for (let i = 0; i < 4; i++) w.write(0, 32);     // MD5: not computed
    const e = new Float64Array(BLOCK + 1);
    let frame = 0;
    for (let start = 0; start < total; start += BLOCK, frame++) {
        const n = Math.min(BLOCK, total - start);
        const block = ints.map((c) => c.subarray(start, start + n));
        // the channels to code, and how (stereo: the four ways, by their size)
        let assignment = nch - 1;
        let coded: Array<{ x: Int32Array; bps: number; plan: Plan }>;
        const plan = (x: Int32Array, b: number) => ({ x, bps: b, plan: planChannel(x, b, e) });
        if (nch == 2) {
            const [l, r] = block;
            const side = new Int32Array(n), mid = new Int32Array(n);
            for (let i = 0; i < n; i++) { side[i] = l[i] - r[i]; mid[i] = (l[i] + r[i]) >> 1; }
            const L = plan(l, bps), R = plan(r, bps), S = plan(side, bps + 1), M = plan(mid, bps);
            const ways: Array<[number, typeof L, typeof L]> = [[1, L, R], [8, L, S], [9, S, R], [10, M, S]];
            const best = ways.reduce((a, b) => (b[1].plan.bits + b[2].plan.bits < a[1].plan.bits + a[2].plan.bits ? b : a));
            assignment = best[0];
            coded = [best[1], best[2]];
        } else {
            coded = block.map((x) => plan(x, bps));
        }
        // the header
        const begin = w.length;
        w.write(0xfff8, 16);                            // sync, fixed blocking
        w.write(0b0111, 4);                             // block size: 16 bits at the end of the header
        w.write(0b0000, 4);                             // sample rate: STREAMINFO
        w.write(assignment, 4);
        w.write(0b000, 3);                              // sample size: STREAMINFO
        w.write(0, 1);
        codedNumber(w, frame);
        w.write(n - 1, 16);
        w.write(crc8(w.bytes, begin, w.length), 8);
        for (const c of coded) writeChannel(w, c.x, c.bps, c.plan, e);
        w.align();
        w.write(crc16(w.bytes, begin, w.length), 16);
        yield frame;
    }
    return w.bytes.slice(0, w.length);
}
