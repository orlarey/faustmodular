/*				SCOPEDRAW.TS
    The oscilloscope and the spectrum of the Scope module (Displays.ts), after the display of faustcode
    (webapp/views/run.js, webapp/views/shared/run-scope-utils.js): a triggered waveform (auto or normal,
    rising or falling slope, threshold) on a grid of 4 × 5 divisions; a spectrum in dB (a level per column of pixels: the peaks keep their height), on a
    logarithmic axis with a musical grid (a line per semitone, octaves named) or a linear one, with the
    frequencies written along the axis. Added here: the duration shown (Time, scrolling beyond the buffer
    of the analyser), the levels in dB, and the strongest peak (frequency, note, level).

    The drawing functions take a context set to CSS pixels (width × height) and only draw.
*/

export type Slope = "rising" | "falling";

// The start of the last window of `shown` samples that begins on a crossing of `threshold` with the
// slope, -1 if there is none (the newest image of a periodic signal: it does not lag).
export function triggerIndex(data: ArrayLike<number>, shown: number, threshold: number, slope: Slope): number {
    for (let i = data.length - shown; i >= 1; i--) {
        const a = data[i - 1], b = data[i];
        if (slope == "rising" ? a < threshold && b >= threshold : a > threshold && b <= threshold) return i;
    }
    return -1;
}

// Spectrum axis: fmin..fmax on 0..width, logarithmic or linear.
export interface FreqAxis {
    log: boolean;
    fmin: number;
    fmax: number;
    width: number;
}

export function freqAxis(log: boolean, sampleRate: number, width: number): FreqAxis {
    return { log, fmin: log ? 20 : 0, fmax: sampleRate / 2, width };
}

export function xOfFreq(axis: FreqAxis, f: number): number {
    if (!axis.log) return ((f - axis.fmin) / (axis.fmax - axis.fmin)) * axis.width;
    return (Math.log(f / axis.fmin) / Math.log(axis.fmax / axis.fmin)) * axis.width;
}

export function freqOfX(axis: FreqAxis, x: number): number {
    if (!axis.log) return axis.fmin + (x / axis.width) * (axis.fmax - axis.fmin);
    return axis.fmin * Math.pow(axis.fmax / axis.fmin, x / axis.width);
}

// The frequencies written along the axis (faustcode).
export function freqTicks(axis: FreqAxis): number[] {
    const ticks = axis.log ? [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] : [0, 1000, 2000, 5000, 10000, 15000, 20000];
    return ticks.filter((f) => f >= axis.fmin && f <= axis.fmax);
}

export function freqLabel(f: number): string {
    return f >= 1000 ? `${f / 1000}k` : `${f}`;
}

// The semitones within the axis: their frequency, and the octave for a C (MIDI 0 = C-1).
export function semitones(axis: FreqAxis): Array<{ freq: number; octave: number | null }> {
    const lo = Math.ceil(69 + 12 * Math.log2(Math.max(axis.fmin, 1) / 440));
    const hi = Math.floor(69 + 12 * Math.log2(axis.fmax / 440));
    const out: Array<{ freq: number; octave: number | null }> = [];
    for (let m = lo; m <= hi; m++) out.push({ freq: 440 * Math.pow(2, (m - 69) / 12), octave: m % 12 == 0 ? Math.floor(m / 12) - 1 : null });
    return out;
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// The nearest note of a frequency and the deviation in cents: "A4 +2¢".
export function noteOf(f: number): string {
    const m = 69 + 12 * Math.log2(f / 440);
    const n = Math.round(m);
    const cents = Math.round((m - n) * 100);
    return `${NOTES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1} ${cents >= 0 ? "+" : "−"}${Math.abs(cents)}¢`;
}

// The level drawn in each column of pixels: the maximum of the bins the column covers, so that a peak
// keeps its height (faustcode averages 5 bins in dB, which lowers the main lobe of the window by about
// 10 dB at 8192 points); between two bins (low frequencies on a log axis), interpolated.
export function columnLevels(data: ArrayLike<number>, sampleRate: number, axis: FreqAxis, columns: number, floorDb: number): Float32Array {
    const binHz = sampleRate / 2 / data.length;
    const at = (i: number) => Number.isFinite(data[i]) ? Math.max(floorDb, data[i]) : floorDb;
    const out = new Float32Array(columns);
    for (let x = 0; x < columns; x++) {
        const f0 = freqOfX(axis, (x / columns) * axis.width), f1 = freqOfX(axis, ((x + 1) / columns) * axis.width);
        const i0 = Math.max(1, Math.ceil(f0 / binHz)), i1 = Math.min(data.length - 1, Math.floor(f1 / binHz));
        if (i1 >= i0) {
            let max = floorDb;
            for (let i = i0; i <= i1; i++) max = Math.max(max, at(i));
            out[x] = max;
        } else {
            const p = Math.min(data.length - 1, Math.max(1, ((f0 + f1) / 2) / binHz));
            const k = Math.floor(p), t = p - k;
            out[x] = at(k) * (1 - t) + at(Math.min(data.length - 1, k + 1)) * t;
        }
    }
    return out;
}

// The strongest bin (from fmin), its frequency refined by a parabola through the dB of its neighbours.
export function strongestPeak(data: ArrayLike<number>, sampleRate: number, fmin: number): { freq: number; db: number } | null {
    const binHz = sampleRate / 2 / data.length;
    let best = -1;
    for (let i = Math.max(1, Math.ceil(fmin / binHz)); i < data.length - 1; i++) {
        if (Number.isFinite(data[i]) && (best < 0 || data[i] > data[best])) best = i;
    }
    if (best < 0) return null;
    const a = data[best - 1], b = data[best], c = data[best + 1];
    const d = Number.isFinite(a) && Number.isFinite(c) && a - 2 * b + c != 0 ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
    return { freq: (best + d) * binHz, db: b - 0.25 * (a - c) * d };
}

export interface Colors {
    line: string;
    grid: string;
    text: string;
}

// The oscilloscope grid: 4 major divisions each way, 5 minor ones in each (faustcode).
export function drawScopeGrid(g: CanvasRenderingContext2D, width: number, height: number, colors: Colors): void {
    g.save();
    g.lineWidth = 1;
    for (let i = 1; i < 20; i++) {
        g.strokeStyle = i % 5 == 0 ? colors.grid : "rgba(255, 255, 255, 0.03)";
        const x = Math.round((i / 20) * width) + 0.5, y = Math.round((i / 20) * height) + 0.5;
        g.beginPath();
        g.moveTo(x, 0); g.lineTo(x, height);
        g.moveTo(0, y); g.lineTo(width, y);
        g.stroke();
    }
    g.restore();
}

// y of a sample value in [-1, 1]: 0.45 of the height on each side (faustcode).
export const yOfSample = (v: number, height: number) => (0.5 - Math.max(-1, Math.min(1, v)) * 0.45) * height;

export function drawWave(g: CanvasRenderingContext2D, width: number, height: number, data: ArrayLike<number>, colors: Colors, threshold: number | null): void {
    drawScopeGrid(g, width, height, colors);
    if (threshold !== null) {
        g.strokeStyle = "rgba(255, 255, 255, 0.2)";
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(0, yOfSample(threshold, height));
        g.lineTo(width, yOfSample(threshold, height));
        g.stroke();
        g.setLineDash([]);
    }
    g.strokeStyle = colors.line;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = (i / Math.max(1, data.length - 1)) * width, y = yOfSample(data[i], height);
        if (i == 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
}

export const FLOOR_DB = -110;

// The analyser (Web Audio) windows with a Blackman window (coherent gain a0 = 0.42) and divides by N:
// a sine of amplitude A peaks at 20·log10(0.21·A). Added to its dB, a sine of amplitude A reads
// 20·log10(A): 0 dB at full scale (dBFS of a sine).
export const SINE_DB = -20 * Math.log10(0.42 / 2);

// The spectrum of the analyser in dB of a sine (SINE_DB added).
export function calibrated(data: ArrayLike<number>): Float32Array {
    return Float32Array.from(data as ArrayLike<number>, (v) => v + SINE_DB);
}

// The spectrum: levels every 20 dB, the musical grid (log) or 10 columns (linear), the frequencies
// along the bottom, the curve, and the strongest peak.
// `data`: the analyser's dB (getFloatFrequencyData), calibrated here.
// Returns the strongest peak written (null if none stands out).
export function drawSpectrum(g: CanvasRenderingContext2D, width: number, height: number, raw: ArrayLike<number>, sampleRate: number, log: boolean, colors: Colors): { freq: number; db: number } | null {
    const data = calibrated(raw);
    const axis = freqAxis(log, sampleRate, width);
    const yOfDb = (db: number) => (Math.min(0, Math.max(FLOOR_DB, db)) / FLOOR_DB) * height;
    g.save();
    g.lineWidth = 1;
    g.font = "10px system-ui, sans-serif";
    // levels
    g.textAlign = "left";
    g.textBaseline = "bottom";
    for (let db = -20; db > FLOOR_DB; db -= 20) {
        const y = Math.round(yOfDb(db)) + 0.5;
        g.strokeStyle = "rgba(255, 255, 255, 0.06)";
        g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke();
        g.fillStyle = colors.text;
        g.fillText(`${db} dB`, 3, y - 1);
    }
    // frequencies
    if (log) {
        const notes = semitones(axis);
        const spacing = width / Math.max(1, notes.length);
        g.textBaseline = "top";
        for (const n of notes) {
            if (n.octave === null && spacing < 3) continue;     // too narrow for the semitones
            const x = Math.round(xOfFreq(axis, n.freq)) + 0.5;
            g.strokeStyle = n.octave !== null ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.05)";
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke();
            if (n.octave !== null) {
                g.fillStyle = colors.text;
                g.fillText(`C${n.octave}`, x + 2, 2);
            }
        }
    } else {
        g.strokeStyle = "rgba(255, 255, 255, 0.08)";
        for (let i = 1; i < 10; i++) {
            const x = Math.round((i / 10) * width) + 0.5;
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke();
        }
    }
    g.textAlign = "center";
    g.textBaseline = "bottom";
    for (const f of freqTicks(axis)) {
        const x = xOfFreq(axis, f);
        g.fillStyle = colors.text;
        g.fillText(freqLabel(f), Math.min(width - 10, Math.max(10, x)), height - 1);
    }
    // the curve: a level per column of pixels
    const columns = Math.max(1, Math.round(width));
    const levels = columnLevels(data, sampleRate, axis, columns, FLOOR_DB);
    g.strokeStyle = colors.line;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x < columns; x++) {
        const px = ((x + 0.5) / columns) * width, py = yOfDb(levels[x]);
        if (x == 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    // the strongest peak, if it stands out
    const found = strongestPeak(data, sampleRate, Math.max(axis.fmin, 20));
    const peak = found && found.db > FLOOR_DB + 30 ? found : null;
    if (peak) {
        const x = xOfFreq(axis, peak.freq), y = yOfDb(peak.db);
        g.fillStyle = colors.line;
        g.beginPath(); g.arc(x, y, 3, 0, 2 * Math.PI); g.fill();
        g.fillStyle = colors.text;
        g.textAlign = "right";
        g.textBaseline = "top";
        g.fillText(peakText(peak), width - 4, 14);
    }
    g.restore();
    return peak;
}

export function peakText(peak: { freq: number; db: number }): string {
    return `${peak.freq < 1000 ? peak.freq.toFixed(1) : peak.freq.toFixed(0)} Hz · ${noteOf(peak.freq)} · ${peak.db.toFixed(1)} dB`;
}
