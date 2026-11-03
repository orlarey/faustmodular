/*				STARTER.TS
    The scene of the first visit (no document yet): a SineVCO connected to the left and right outputs, so that
    the application does not open on an empty stage. Its Gate plays it (Freq, Gain and Volume as in the first
    program of faustcode, with a sine). Not modified, it is replaced by a new scene or a file opened, as an empty
    one (Documents.dropIfBlank). `?starter=0` in the address opens on an empty scene, as faustcode opening
    faustmodular (`?link=faustcode`).
*/

import { wrapModuleCode } from "../model/ModuleCode";
import { ModuleFileV2, PatchFileV2 } from "../model/PatchFormat";

export const STARTER_MODULE = "SineVCO";

export const STARTER_CODE = `import("stdfaust.lib");

process = os.osc(freq) * gain * gate * volume
with {
    freq = hslider("freq", 440, 40, 8000, 1);
    gain = hslider("gain", 0.5, 0, 1, 0.01);
    gate = button("gate") : fi.lowpass(1, 1);
    volume = hslider("volume", 0.25, 0, 1, 0.01);
};
`;

// The corner of the SineVCO (about 220 × 300 px) for its center at a point.
export const STARTER_CENTERED = (center: { x: number; y: number }) => ({ x: Math.round(center.x - 110), y: Math.round(center.y - 150) });

// Not with ?starter=0, nor when faustcode opens faustmodular (?link=faustcode): its code comes then.
export function starterWanted(search: string): boolean {
    const params = new URLSearchParams(search);
    return params.get("starter") != "0" && params.get("link") != "faustcode";
}

// The scene of the first visit, from the empty scene (its input and output modules, where they are): the
// SineVCO at `at`, its output to the first two inputs of the output module (one if it has one).
export function starterPatch(empty: PatchFileV2, at: { x: number; y: number }): PatchFileV2 {
    const output = empty.modules.find((m) => m.kind == "output");
    const id = "1";
    const module: ModuleFileV2 = { id, kind: "faust", name: STARTER_MODULE, code: wrapModuleCode(STARTER_MODULE, STARTER_CODE), x: at.x, y: at.y, inputs: 0, outputs: 1, params: {}, acc: [] };
    const ports = Math.min(2, output?.inputs ?? 2);
    const connections = output ? Array.from({ length: ports }, (_, port) => ({ from: { module: id, port: 0 }, to: { module: output.id, port } })) : [];
    return { ...empty, modules: [...empty.modules, module], connections: [...empty.connections, ...connections] };
}
