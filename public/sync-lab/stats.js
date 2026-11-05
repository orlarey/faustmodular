/*				SYNC-LAB/STATS.JS
    The computations of the synchronization lab (index.html), pure and tested (tests/model/sync-lab.test.ts):
    statistics, the line of a clock against another, the onsets of the clicks in a recording and their groups.
*/

export function mean(a) {
    return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
}

export function std(a) {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// The quantile q (0 to 1), linear between the order statistics.
export function quantile(a, q) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const p = (s.length - 1) * q;
    const i = Math.floor(p);
    return i + 1 < s.length ? s[i] + (p - i) * (s[i + 1] - s[i]) : s[i];
}

export const median = (a) => quantile(a, 0.5);

// Least squares: y = y0 + slope·(x − x0), x0 and y0 the means (the large values of the clocks stay exact).
export function fitLine(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const x0 = mean(xs), y0 = mean(ys);
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
        sxx += (xs[i] - x0) ** 2;
        sxy += (xs[i] - x0) * (ys[i] - y0);
    }
    if (sxx == 0) return null;
    const slope = sxy / sxx;
    const residuals = ys.map((y, i) => y - (y0 + slope * (xs[i] - x0)));
    return { x0, y0, slope, residuals, n };
}

// The line again without the readings further than 5 robust deviations (median of |r| · 1.4826): a stale or late
// reading does not bend it.
export function robustFit(xs, ys) {
    const first = fitLine(xs, ys);
    if (!first) return null;
    const mad = median(first.residuals.map(Math.abs)) * 1.4826;
    const limit = Math.max(5 * mad, 1e-9);
    const keep = first.residuals.map((r) => Math.abs(r) <= limit);
    const kx = xs.filter((_, i) => keep[i]), ky = ys.filter((_, i) => keep[i]);
    const fit = fitLine(kx, ky) ?? first;
    return { ...fit, outliers: xs.length - kx.length };
}

export const at = (fit, x) => fit.y0 + fit.slope * (x - fit.x0);

// The onsets of the clicks in a recording (in samples, with a fraction): a sample above the threshold after
// `quiet` seconds below it starts a click; its onset is where the signal first reaches `relative` of the peak of the
// click, interpolated between two samples. The same click everywhere: the bias of the detection cancels in the
// differences.
export function onsets(x, sr, { quiet = 0.03, factor = 8, relative = 0.3 } = {}) {
    let peak = 0;
    const abs = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
        abs[i] = Math.abs(x[i]);
        if (abs[i] > peak) peak = abs[i];
    }
    if (peak == 0) return [];
    // the noise: the median of |x| over a decimated copy (the clicks are rare)
    const step = Math.max(1, Math.floor(x.length / 20000));
    const sample = [];
    for (let i = 0; i < x.length; i += step) sample.push(abs[i]);
    const threshold = Math.max(factor * median(sample), 0.02 * peak, 1e-4);
    const result = [];
    let last = -Infinity;
    const before = Math.round(0.0005 * sr), after = Math.round(0.005 * sr);
    for (let i = 0; i < x.length; i++) {
        if (abs[i] <= threshold) continue;
        if (i - last > quiet * sr) {
            let p = 0;
            for (let j = i; j < Math.min(x.length, i + after); j++) p = Math.max(p, abs[j]);
            const level = relative * p;
            let j = Math.max(1, i - before);
            while (j < x.length && abs[j] < level) j++;
            const a = abs[j - 1], b = abs[j];
            result.push(j - 1 + (b > a ? (level - a) / (b - a) : 1));
        }
        last = i;
    }
    return result;
}

// The groups of clicks: the tabs click one after the other, `gap` seconds apart (rank 0, the reference, first),
// every period. A new group after a silence longer than 1.5 gaps. For the groups of the usual size, the error of each
// rank: its distance to the first click, less rank · gap (ms).
export function groupClicks(onsetSamples, sr, gap) {
    const groups = [];
    let current = [];
    for (const o of onsetSamples) {
        if (current.length && (o - current[current.length - 1]) > 1.5 * gap * sr) {
            groups.push(current);
            current = [];
        }
        current.push(o);
    }
    if (current.length) groups.push(current);
    const sizes = {};
    for (const g of groups) sizes[g.length] = (sizes[g.length] ?? 0) + 1;
    const size = Number(Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
    const errors = Array.from({ length: Math.max(0, size - 1) }, () => []);
    const times = Array.from({ length: Math.max(0, size - 1) }, () => []);       // the first click of the group (samples)
    for (const g of groups) {
        if (g.length != size) continue;
        for (let r = 1; r < size; r++) {
            errors[r - 1].push(((g[r] - g[0]) / sr - r * gap) * 1000);
            times[r - 1].push(g[0]);
        }
    }
    return { groups: groups.length, sizes, size, errors, times };
}

// A summary of a series: count, median, mean, standard deviation, quantiles, extremes.
export function summary(a) {
    return {
        n: a.length, median: median(a), mean: mean(a), std: std(a),
        p05: quantile(a, 0.05), p95: quantile(a, 0.95), min: a.length ? Math.min(...a) : NaN, max: a.length ? Math.max(...a) : NaN,
    };
}
