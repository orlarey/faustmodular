/*				MODULATION.TS
    Widget modulation: an audio signal connected to a widget (slider, button, checkbox) of a module.
    See Documentation/widget-modulation/PLAN.md.

    It relies on Faust's widget modulation, ["target" : circuit -> expression]: every widget matching
    "target" (a label, or a path suffix "group/label") is replaced by circuit(widget, m), where m is a
    new input of the expression, added before its own inputs (tests/faust/widget-modulation.test.ts).

    The code of a module with modulations (its "effective code") is generated from its base code:

        process = route(n+k, n+k, ...) : ["target1" : c1, ..., "targetk" : ck -> environment{ <code> }.process];

    The n audio inputs keep their ports 0..n-1, the modulation inputs get the ports n..n+k-1 of the
    module: the route moves them in front, where Faust expects them.

    Modulation types (as in modular synthesizers):
    - "modulate" (±): clip(w + D·m·(max−min)/2), or clip(w·2^(D·m·N)) for frequencies (exponential,
      N = half the range of the widget in octaves); D is a depth slider of the circuit (−1..1), so
      it is adjusted live without recompiling;
    - "scale" (×): w·m;
    - "drive" (⇐): clip(m); the widget stays in the interface but has no effect.
*/

export type ModulationMode = "modulate" | "scale" | "drive";

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

export function allowedModes(widget: WidgetDescription): ModulationMode[] {
    return widget.type == "button" || widget.type == "checkbox" ? ["drive"] : ["modulate", "scale", "drive"];
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
    if (allowedModes(widget).indexOf(mode) < 0) {
        throw new ModulationError(`mode ${mode} is not available for a ${widget.type}`);
    }
    return { target: widgetTarget(widgets, widget.address), mode, min: widget.min, max: widget.max, exponential: isExponential(widget) };
}

// Number written for Faust (always with a decimal point or an exponent: a float constant).
function float(x: number): string {
    const s = String(x);
    return /[.eE]/.test(s) ? s : s + ".0";
}

// Half of the range of a frequency widget, in octaves (5 when the minimum is not positive).
export function octaves(min: number, max: number): number {
    return min > 0 && max > min ? Math.log2(max / min) / 2 : 5;
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
            const depth = `hslider("[${DEPTH_METADATA}:${key}][style:knob]depth ${key}", 1, -1, 1, 0.01) : si.smoo`;
            return spec.exponential
                // (2.0, _ : pow) is 2^x; note that pow(2.0) would be x^2 (partial application binds the 2nd argument)
                ? `(_, (*(${float(octaves(spec.min, spec.max))} * (${depth})) : (2.0, _ : pow)) : * : ${clip})`
                : `(_, *(${float((spec.max - spec.min) / 2)} * (${depth})) : + : ${clip})`;
        }
        case "scale":
            return "*";
        case "drive":
            return `(ro.cross(2) : attach : ${clip})`;
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
