/*				CLOCKOFFSET.TS
    The difference between the clock of another application and this one (Documentation/FAUST-SYNC-SPEC.md, § 7.2):
    δ = t_other(T) − t_self(T), the times of their contexts that come out of the speaker at the same common time
    (s). On one sound card, their samples advance together: δ is constant. It is measured once, calm (both clocks
    settled, the values within 0.5 ms for 2.5 s), and frozen; before, the last value serves. Without such a calm
    within 10 s (a loaded machine, a noisy clock), it is frozen anyway, at the median of the last 5 s: a value that
    no longer moves is better than corrections that never end. Pure.
*/

export const FREEZE_SPAN = 2500;        // ms
export const FREEZE_SPREAD = 0.0005;    // s
const FREEZE_COUNT = 5;
export const FREEZE_LATEST = 10000;     // ms of calm measures: frozen anyway
const FREEZE_LAST = 5000;               // ms: then at the median of these

export class ClockOffset {
    private fSamples: Array<{ T: number; d: number }> = [];
    private fLast: number | null = null;
    private fCalm: Array<{ T: number; d: number }> = [];   // the values since the clocks are settled
    frozen: number | null = null;

    // A value of δ at the common time T (ms); `calm`: both clocks settled. True when δ is frozen by it.
    add(T: number, d: number, calm: boolean): boolean {
        this.fLast = d;
        if (this.frozen !== null) return false;
        if (!calm) {
            this.fSamples = [];
            this.fCalm = [];
            return false;
        }
        this.fSamples.push({ T, d });
        this.fCalm.push({ T, d });
        if (T - this.fCalm[0].T >= FREEZE_LATEST) {
            const ds = this.fCalm.filter((s) => s.T >= T - FREEZE_LAST).map((s) => s.d).sort((a, b) => a - b);
            const m = ds.length >> 1;
            this.frozen = ds.length % 2 ? ds[m] : (ds[m - 1] + ds[m]) / 2;
            return true;
        }
        // the values within the spread: the older ones that leave it are dropped
        const spread = () => {
            const ds = this.fSamples.map((s) => s.d);
            return Math.max(...ds) - Math.min(...ds);
        };
        while (this.fSamples.length > 1 && spread() > FREEZE_SPREAD) this.fSamples.shift();
        while (this.fSamples.length > 1 && this.fSamples[0].T < T - 2 * FREEZE_SPAN) this.fSamples.shift();
        const span = T - this.fSamples[0].T;
        if (this.fSamples.length >= FREEZE_COUNT && span >= FREEZE_SPAN) {
            const ds = this.fSamples.map((s) => s.d).sort((a, b) => a - b);
            const m = ds.length >> 1;
            this.frozen = ds.length % 2 ? ds[m] : (ds[m - 1] + ds[m]) / 2;
            return true;
        }
        return false;
    }

    // δ: frozen, or the last value; null before any.
    get value(): number | null {
        return this.frozen ?? this.fLast;
    }

    reset(): void {
        this.fSamples = [];
        this.fCalm = [];
        this.fLast = null;
        this.frozen = null;
    }
}
