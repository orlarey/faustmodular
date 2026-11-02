/*				MODULATION.TS
    Widget modulation: an audio signal connected to a widget (slider, button, checkbox) of a module.
    See Documentation/widget-modulation/MODULATION.md (reference) and PLAN.md (history).

    It relies on Faust's widget modulation, ["target" : circuit -> expression]: every widget matching
    "target" (a label, or a path suffix "group/label") is replaced by circuit(widget, m), where m is a
    new input of the expression, added before its own inputs (tests/faust/widget-modulation.test.ts).

    The code of a module with modulations (its "effective code") is generated from its base code:

        process = route(n+k, n+k, ...) : ["target1" : c1, ..., "targetk" : ck -> environment{ <code> }.process];

    The n audio inputs keep their ports 0..n-1, the modulation inputs get the ports n..n+k-1 of the
    module: the route moves them in front, where Faust expects them.

    Modulation types (as in modular synthesizers):
    - "modulate" (±): the slider is the rest position. With u = D·m bounded to [−1, 1], D being a
      depth slider of the circuit (−1..1, 0.5 by default, adjusted live without recompiling): u = 0 leaves the
      slider value w, u = 1 reaches the maximum, u = −1 the minimum, linearly in between:
          w + u·(max − w)  if u ≥ 0,      w + u·(w − min)  if u < 0;
      for frequencies (exponential, minimum > 0) the same in octaves:
          w·(max/w)^u      if u ≥ 0,      w·(w/min)^u      if u < 0;
    - "add" (+), for the pitch sliders ([unit:pitch], 0.1 per octave): w + A·m, A being an amount slider
      of the circuit (−1..1, 1 by default): the slider is a transposition, the signal a pitch added to it,
      as the knob and the 1 V/oct input of an oscillator (Documentation/MODULAR-LIBRARY.md);
    - "linear" (~), for the widgets declaring [mod:lin] (the frequency of an oscillator): w·(1 + D·m),
      D being a deviation slider of the circuit (−10..10, 1 by default), bounded to [−max, max] (through
      zero: a negative frequency turns the phase backwards). With a sine of gain g on the frequency fc of
      a sine oscillator, the deviation is D·g·fc and the index of classic (Chowning) FM is
      I = D·g·fc/fm; the mean frequency stays fc;
    - "scale" (×): w·m;
    - "drive" (⇐): clip(m); the widget stays in the interface but has no effect; a hidden bargraph
      ([driven:<target>]) reports the value to the interface (a button lit while it is held at 1).
*/

export type ModulationMode = "modulate" | "add" | "linear" | "scale" | "drive";

// A widget of a compiled module, from the JSON description of its factory.
export interface WidgetDescription {
    address: string;                // e.g. "/Echo/0x00/Echo_Delay"
    label: string;                  // source label, without metadata: "Echo Delay"
    path: string[];                 // labels of the groups from the root, and of the widget
    type: string;                   // hslider, vslider, nentry, button, checkbox
    min: number;
    max: number;
    meta: Record<string, string>;
}

// What a modulation needs to be generated, saved with the module.
export interface ModulationSpec {
    target: string;                 // Faust target: label or path suffix, see widgetTarget
    mode: ModulationMode;
    min: number;
    max: number;
    exponential: boolean;
}

export class ModulationError extends Error { }

// Metadata key marking the depth sliders added by the modulations (to be shown apart in the interface).
export const DEPTH_METADATA = "modulation";
// Metadata key of the hidden bargraph a "drive" modulation adds: the value the signal gives the widget,
// shown by the widget (a button lit while the signal holds it at 1).
export const DRIVEN_METADATA = "driven";
// Depth of a new ± modulation (and of a double click on its port): half the way to the bounds.
export const DEFAULT_DEPTH = 0.5;
// Amount of a new + modulation: the pitch is followed exactly.
export const DEFAULT_AMOUNT = 1;

// Deviation of a new linear modulation: with a modulator of gain g at the frequency of the carrier,
// the index of the FM is g.
export const DEFAULT_DEVIATION = 1;

// The modes whose circuit has a depth slider (shown and set on the modulation port).
export function hasDepth(mode: ModulationMode): boolean {
    return mode == "modulate" || mode == "add" || mode == "linear";
}

export function defaultDepth(mode: ModulationMode): number {
    return mode == "add" ? DEFAULT_AMOUNT : mode == "linear" ? DEFAULT_DEVIATION : DEFAULT_DEPTH;
}

// The depth slider goes from −range to range.
export function depthRange(mode: ModulationMode): number {
    return mode == "linear" ? 10 : 1;
}

// Address of the depth slider of a ± modulation: ".../depth_<key>" (label "depth <key>"), of a +
// modulation: ".../amount_<key>". The value of a depth whose modulation is removed is kept with the
// module's parameters: it is used again when the widget is modulated again, by the same source or another.
export function isDepthAddress(address: string): boolean {
    return /(^|\/)(depth|amount|deviation)_[^/]*$/.test(address);
}

// Default value of the depth slider at this address (a remembered depth equal to it is not kept).
export function defaultDepthAt(address: string): number {
    if (/(^|\/)amount_[^/]*$/.test(address)) return DEFAULT_AMOUNT;
    if (/(^|\/)deviation_[^/]*$/.test(address)) return DEFAULT_DEVIATION;
    return DEFAULT_DEPTH;
}

// Labels Faust gives to groups without a label ("h:[1]/x" → group "0x00"): they are not in the source.
const GENERATED_GROUP = /^0x[0-9a-f]+$/i;

export function listWidgets(ui: any[]): WidgetDescription[] {
    const widgets: WidgetDescription[] = [];
    const walk = (items: any[], path: string[]) => {
        for (const item of items) {
            if (item.items) {
                walk(item.items, path.concat(item.label));
            } else if (item.address) {
                const meta: Record<string, string> = {};
                (item.meta ?? []).forEach((m: Record<string, string>) => Object.assign(meta, m));
                widgets.push({
                    address: item.address, label: item.label, path: path.concat(item.label), type: item.type,
                    min: Number(item.min ?? 0), max: Number(item.max ?? 1), meta,
                });
            }
        }
    };
    walk(ui, []);
    return widgets;
}

// Input widgets that can be modulated (not bargraphs, not the depth sliders of modulations).
export function isModulable(widget: WidgetDescription): boolean {
    return ["hslider", "vslider", "nentry", "button", "checkbox"].indexOf(widget.type) >= 0 && !(DEPTH_METADATA in widget.meta);
}

// The mode offered for a new modulation: one per kind of widget, so no choice to make. Sliders are
// modulated from their value (the slider is the rest position, the depth the excursion), which also
// gives the effect of "scale" (slider at its minimum, unipolar signal) and of "drive" (slider at its
// minimum, depth 1); pitch sliders add the signal to their value; buttons and checkboxes are driven
// by the signal.
export function allowedModes(widget: WidgetDescription): ModulationMode[] {
    return isSwitch(widget) ? ["drive"] : isLinear(widget) ? ["linear"] : isPitch(widget) ? ["add"] : ["modulate"];
}

// The modes accepted (patches saved before 2.8.0 may have "scale" and "drive" on sliders).
export function supportedModes(widget: WidgetDescription): ModulationMode[] {
    if (isSwitch(widget)) return ["drive"];
    const first: ModulationMode[] = isLinear(widget) ? ["linear"] : isPitch(widget) ? ["add"] : [];
    return [...first, "modulate", "scale", "drive"];
}

// The mode a slider declares: [mod:lin] (linear), [mod:add] (added, as a pitch).
function declaredMode(widget: WidgetDescription): string | undefined {
    return widget.meta["mod"]?.trim().toLowerCase();
}

// Pitch sliders: [unit:pitch], 0.1 per octave (Documentation/MODULAR-LIBRARY.md), or [mod:add].
export function isPitch(widget: WidgetDescription): boolean {
    return widget.meta["unit"]?.toLowerCase() == "pitch" || declaredMode(widget) == "add";
}

// Sliders modulated linearly: [mod:lin] (the frequency of an oscillator, for classic FM).
export function isLinear(widget: WidgetDescription): boolean {
    return declaredMode(widget) == "lin";
}

function isSwitch(widget: WidgetDescription): boolean {
    return widget.type == "button" || widget.type == "checkbox";
}

// Frequencies are modulated exponentially: widgets with [scale:log] or [unit:Hz].
export function isExponential(widget: WidgetDescription): boolean {
    return widget.meta["scale"]?.toLowerCase() == "log" || widget.meta["unit"]?.toLowerCase() == "hz";
}

// Shortest suffix of the label path that designates this widget only, without generated group labels.
export function widgetTarget(widgets: WidgetDescription[], address: string): string {
    const widget = widgets.find((w) => w.address == address);
    if (!widget) {
        throw new ModulationError(`no widget ${address}`);
    }
    const others = widgets.filter((w) => w !== widget);
    const endsWith = (path: string[], suffix: string[]) =>
        path.length >= suffix.length && suffix.every((label, i) => path[path.length - suffix.length + i] == label);
    for (let length = 1; length <= widget.path.length; length++) {
        const suffix = widget.path.slice(-length);
        if (suffix.slice(0, -1).some((label) => GENERATED_GROUP.test(label))) {
            break;          // would go through a group without label: not expressible
        }
        if (!others.some((w) => endsWith(w.path, suffix))) {
            return suffix.join("/");
        }
    }
    throw new ModulationError(`the widget ${address} cannot be designated without ambiguity (groups without label)`);
}

export function modulationSpec(widget: WidgetDescription, widgets: WidgetDescription[], mode: ModulationMode): ModulationSpec {
    if (!isModulable(widget)) {
        throw new ModulationError(`the widget ${widget.address} cannot be modulated`);
    }
    if (supportedModes(widget).indexOf(mode) < 0) {
        throw new ModulationError(`mode ${mode} is not available for a ${widget.type}`);
    }
    return { target: widgetTarget(widgets, widget.address), mode, min: widget.min, max: widget.max, exponential: isExponential(widget) };
}

// Number written for Faust (always with a decimal point or an exponent: a float constant).
function float(x: number): string {
    const s = String(x);
    return /[.eE]/.test(s) ? s : s + ".0";
}

// Name of the depth slider of a modulation, from its target: stable when other modulations of the
// module are added or removed, and when the patch is saved and recalled. Characters that Faust
// would interpret in a label ("/" makes groups, "[" metadata...) are replaced by "_".
export function depthKey(spec: ModulationSpec): string {
    return spec.target.replace(/[^A-Za-z0-9_ -]/g, "_");
}

// The depth slider of a modulation among the widgets of the module's DSP.
export function depthWidget(widgets: WidgetDescription[], spec: ModulationSpec): WidgetDescription | undefined {
    return widgets.find((w) => w.meta[DEPTH_METADATA] == depthKey(spec));
}

// Faust circuit replacing the widget w by f(w, m).
export function circuit(spec: ModulationSpec): string {
    const clip = `max(${float(spec.min)}) : min(${float(spec.max)})`;
    switch (spec.mode) {
        case "modulate": {
            const key = depthKey(spec);
            // step 0.001: the fine adjustment of the modulation port (Shift)
            const depth = `hslider("[${DEPTH_METADATA}:${key}][style:knob]depth ${key}", ${DEFAULT_DEPTH}, -1, 1, 0.001) : si.smoo`;
            // u = D·m, bounded: the excursion around the slider value, as a fraction of the way to a bound
            const u = `(*(${depth}) : max(-1.0) : min(1.0))`;
            const [lo, hi] = [float(spec.min), float(spec.max)];
            return spec.exponential && spec.min > 0
                ? `(_, ${u} : \\(w, u).(w * pow(select2(u < 0, ${hi} / w, w / ${lo}), u)) : ${clip})`
                : `(_, ${u} : \\(w, u).(w + u * select2(u < 0, ${hi} - w, w - ${lo})) : ${clip})`;
        }
        case "add": {
            const amount = `hslider("[${DEPTH_METADATA}:${depthKey(spec)}][style:knob]amount ${depthKey(spec)}", ${float(DEFAULT_AMOUNT)}, -1, 1, 0.001) : si.smoo`;
            return `(_, *(${amount}) : + : ${clip})`;
        }
        case "linear": {
            const deviation = `hslider("[${DEPTH_METADATA}:${depthKey(spec)}][style:knob]deviation ${depthKey(spec)}", ${float(DEFAULT_DEVIATION)}, -10, 10, 0.001) : si.smoo`;
            const hi = float(Math.max(Math.abs(spec.min), Math.abs(spec.max)));
            return `(_, *(${deviation}) : \\(w, u).(w * (1 + u)) : max(-${hi}) : min(${hi}))`;
        }
        case "scale":
            return "*";
        case "drive": {
            // the value given to the widget, reported to the interface by a hidden bargraph
            const shown = `hbargraph("[${DRIVEN_METADATA}:${depthKey(spec)}][hidden:1]driven ${depthKey(spec)}", ${float(spec.min)}, ${float(spec.max)})`;
            return `(ro.cross(2) : attach : ${clip} <: attach(_, ${shown}))`;
        }
    }
}

// Effective code of a module with n audio inputs and the given modulations (base code if none).
export function modulatedCode(code: string, numInputs: number, modulations: ModulationSpec[]): string {
    const k = modulations.length;
    if (k == 0) {
        return code;
    }
    // modulation ports n..n+k-1 → Faust inputs 1..k; audio ports 0..n-1 → Faust inputs k+1..k+n
    const pairs: string[] = [];
    for (let i = 0; i < k; i++) pairs.push(`(${numInputs + i + 1},${i + 1})`);
    for (let i = 0; i < numInputs; i++) pairs.push(`(${i + 1},${k + i + 1})`);
    const targets = modulations.map((spec) => `${JSON.stringify(spec.target)} : ${circuit(spec)}`).join(",\n    ");
    return `import("stdfaust.lib");\n`
        + `process = route(${numInputs + k},${numInputs + k},${pairs.join(",")})\n`
        + `  : [${targets}\n    -> environment{\n${code}\n}.process];\n`;
}
