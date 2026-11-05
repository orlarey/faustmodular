/*				CLOCKLINE.TS
    The audio clock of an application (Documentation/FAUST-SYNC-SPEC.md, § 7.1): the time of its audio context that
    comes out of the speaker (t, s) at a time of the common clock (T, ms), from the readings of getOutputTimestamp.
    Pure: tested under Node.js (tests/model/clock.test.ts).

    - The line t(T): its rate (the drift between the quartz of the card and the clock of the system) over the last
      30 s, its offset from the median of the last second (a reading is precise to about 40 µs).
    - The first readings after the context starts are off by tens of ms: ignored for 2 s (WARMUP).
    - A jump: the output latency announced by the system changes at once (a microphone opened, the output
      reconfigured). While the clock settles (SETTLE), the line follows it; afterwards it is compensated, and the clock
      stays continuous: the sound of an application does not move in a system that works (§ 12), only the latency it
      announces. The jumps are kept, for the diagnosis.
*/

export interface ClockReading { T: number; t: number }

// What an application publishes of its clock: t(T) = t + rate · (T' − T).
export interface ClockLineMessage { T: number; t: number; rate: number; settled: boolean }

export const WARMUP = 2000;         // ms
export const SETTLE = 5000;         // ms after the warmup: the jumps are followed, then compensated
export const JUMP = 0.00025;        // s
const SLOPE_WINDOW = 30000;         // ms
const OFFSET_WINDOW = 1000;         // ms
const NOW_WINDOW = 500;             // ms: a jump, the last half second against the two seconds before
const BEFORE_WINDOW = 2000;         // ms
const NOMINAL_RATE = 0.001;         // s of the context per ms

function median(a: number[]): number {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Least squares of y against x, without the points further than 5 robust deviations; null without spread.
function slopeOf(xs: number[], ys: number[]): number | null {
    const fit = (x: number[], y: number[]) => {
        const n = x.length;
        if (n < 2) return null;
        let mx = 0, my = 0;
        for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
        mx /= n; my /= n;
        let sxx = 0, sxy = 0;
        for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
        return sxx > 0 ? { mx, my, slope: sxy / sxx } : null;
    };
    const first = fit(xs, ys);
    if (!first) return null;
    const r = ys.map((y, i) => y - (first.my + first.slope * (xs[i] - first.mx)));
    const mad = median(r.map(Math.abs)) * 1.4826;
    const keep = r.map((v) => Math.abs(v) <= Math.max(5 * mad, 1e-12));
    return fit(xs.filter((_, i) => keep[i]), ys.filter((_, i) => keep[i]))?.slope ?? first.slope;
}

export class ClockLine {
    private fReadings: Array<{ T: number; c: number }> = [];   // c: the time of the context, jumps compensated
    private fFirst: number | null = null;                       // the first reading (ms)
    private fSegment = 0;                                       // the start of the readings in use (ms)
    private fSettled = false;
    private fCorrection = 0;                                    // the sum of the jumps compensated (s)
    private fRate: number | null = null;
    private fSinceRate = 0;
    private fLine: { T: number; t: number; rate: number } | null = null;
    readonly jumps: Array<{ T: number; size: number; compensated: boolean }> = [];

    // A reading: at the common time T (ms), the time t (s) of the context came out of the speaker.
    add(T: number, t: number): void {
        const last = this.fReadings[this.fReadings.length - 1];
        if (last && T <= last.T) return;
        if (this.fFirst === null) {
            this.fFirst = T;
            this.fSegment = T + WARMUP;
        }
        if (T < this.fSegment) return;
        this.fReadings.push({ T, c: t - this.fCorrection });
        while (this.fReadings.length && this.fReadings[0].T < T - SLOPE_WINDOW - 5000) this.fReadings.shift();
        if (!this.fSettled && T - this.fSegment >= SETTLE) this.fSettled = true;
        this.detect(T);
        if (++this.fSinceRate >= 10 || this.fRate === null) this.updateRate(T);
        this.updateLine(T);
    }

    // The readings of the last second give the time now: one at least.
    get ready(): boolean {
        return this.fLine !== null;
    }

    // Settled: the jumps are compensated from now on; the differences with the other clocks can be measured.
    get settled(): boolean {
        return this.fSettled;
    }

    // The time of the context that comes out of the speaker at the common time T (s), the jumps compensated.
    at(T: number): number {
        const l = this.fLine!;
        return l.t + l.rate * (T - l.T);
    }

    message(): ClockLineMessage | null {
        return this.fLine && { ...this.fLine, settled: this.fSettled };
    }

    // After a suspension of the context: its time stopped; everything starts again.
    reset(): void {
        this.fReadings = [];
        this.fFirst = null;
        this.fSettled = false;
        this.fCorrection = 0;
        this.fRate = null;
        this.fLine = null;
    }

    private rate(): number {
        return this.fRate ?? NOMINAL_RATE;
    }

    private detect(T: number): void {
        // not before the drift is known: over the 1.25 s between the two windows, a drift of 300 ppm would look like a
        // jump of 0.4 ms
        if (this.fRate === null) return;
        const rate = this.fRate;
        const offset = (r: { T: number; c: number }) => r.c - rate * (r.T - T);
        const now = this.fReadings.filter((r) => r.T > T - NOW_WINDOW);
        const before = this.fReadings.filter((r) => r.T > T - NOW_WINDOW - BEFORE_WINDOW && r.T <= T - NOW_WINDOW);
        if (now.length < 5 || before.length < 20) return;
        const a = median(before.map(offset)), b = median(now.map(offset));
        const jump = b - a;
        if (Math.abs(jump) <= JUMP) return;
        // the whole half second at the new level (otherwise its median falls between the two, and the jump would be
        // taken in two halves)
        if (now.some((r) => Math.abs(offset(r) - b) > Math.abs(offset(r) - a))) return;
        if (this.fSettled) {
            // compensated: the readings after the jump (the closer to the new level) brought back to the old one
            for (const r of this.fReadings) {
                if (r.T > T - 2 * NOW_WINDOW && Math.abs(offset(r) - b) < Math.abs(offset(r) - a)) r.c -= jump;
            }
            this.fCorrection += jump;
            this.jumps.push({ T: T - NOW_WINDOW, size: jump, compensated: true });
        } else {
            // followed: the readings before it are forgotten
            this.fSegment = T - NOW_WINDOW;
            this.fReadings = this.fReadings.filter((r) => Math.abs(offset(r) - b) < Math.abs(offset(r) - a));
            this.jumps.push({ T: T - NOW_WINDOW, size: jump, compensated: false });
        }
        this.updateRate(T);
    }

    private updateRate(T: number): void {
        this.fSinceRate = 0;
        const recent = this.fReadings.filter((r) => r.T > T - SLOPE_WINDOW);
        if (recent.length < 30 || recent[recent.length - 1].T - recent[0].T < 2000) return;
        const slope = slopeOf(recent.map((r) => r.T - T), recent.map((r) => r.c - recent[0].c));
        if (slope !== null) this.fRate = slope;
    }

    private updateLine(T: number): void {
        const rate = this.rate();
        const recent = this.fReadings.filter((r) => r.T > T - OFFSET_WINDOW);
        if (recent.length == 0) return;
        this.fLine = { T, t: median(recent.map((r) => r.c - rate * (r.T - T))), rate };
    }
}

// The time of a clock published by another application, at the common time T.
export const lineAt = (line: ClockLineMessage, T: number) => line.t + line.rate * (T - line.T);
