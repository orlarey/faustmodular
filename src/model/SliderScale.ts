/*				SLIDERSCALE.TS
    The scale of a slider: the value of each position of its HTML range input, and back.

    - linear (default): value = min + position·step, positions 0..(max − min)/step;
    - logarithmic ([scale:log], as in faustcode and the Faust UIs), only for positive ranges
      (0 < min < max): value = min·(max/min)^(position/N), on the same number N of positions, rounded
      to the step of the widget and kept in [min, max], so always > 0. With min ≤ 0 the logarithm is
      undefined: the slider stays linear.

    A value set by the program (a recalled patch, undo, the depth of a modulation) is applied as it
    is; the position only shows it (FaustInterfaceControler.setValue).
*/

export interface SliderRange {
    min: number;
    max: number;
    step: number;
    log: boolean;
}

interface SliderItem {
    min: string | number;
    max: string | number;
    step: string | number;
    meta?: Array<{ scale?: string }>;
}

export function wantsLog(meta: SliderItem["meta"]): boolean {
    return (meta ?? []).some((m) => (m.scale ?? "").trim().toLowerCase() == "log");
}

export function sliderRange(item: SliderItem): SliderRange {
    const min = Number(item.min), max = Number(item.max);
    const step = Number(item.step) > 0 ? Number(item.step) : (max - min) / 1000 || 1;
    const log = wantsLog(item.meta) && min > 0 && max > min;
    return { min, max, step, log };
}

// Number of positions of the slider (its HTML max).
export function sliderSteps(range: SliderRange): number {
    return Math.max(1, Math.round((range.max - range.min) / range.step));
}

const clamp = (range: SliderRange, value: number) => Math.min(range.max, Math.max(range.min, value));

export function valueAt(range: SliderRange, position: number): number {
    const steps = sliderSteps(range);
    const p = Math.min(steps, Math.max(0, position));
    if (!range.log) return clamp(range, range.min + p * range.step);
    const exact = range.min * Math.pow(range.max / range.min, p / steps);
    // on the step of the widget, and never below the minimum (> 0)
    return clamp(range, range.min + Math.round((exact - range.min) / range.step) * range.step);
}

export function positionOf(range: SliderRange, value: number): number {
    const steps = sliderSteps(range);
    if (!Number.isFinite(value)) return 0;
    const v = clamp(range, value);
    if (!range.log) return Math.round((v - range.min) / range.step);
    return Math.round(steps * Math.log(v / range.min) / Math.log(range.max / range.min));
}
