/*				SYNCINPUTS.TS
    The reserved inputs of a module (Documentation/FAUST-SYNC-SPEC.md, § 8): the last inputs of its process, named by
    a declaration, `declare sync "index; run; start; tempo; meter";` (any of the channels of the Timeline node: beat, run, start,
    tempo, meter, index, tick; in any
    order), fed by the application with the shared timeline, at every sample. They are not ports of the patch: the
    ports are the other inputs, then the modulations; the reserved inputs come after them all (modulatedCode).
*/

import { TIMELINE_CHANNELS } from "./TimelineCore";

// The channels of the Timeline node that feed the reserved inputs of a code, in the order of these inputs.
export function syncInputs(code: string): number[] {
    const m = /^\s*declare\s+sync\s+"([^"]*)"\s*;/m.exec(code ?? "");
    if (!m) return [];
    return m[1].split(/[;,\s]+/).filter(Boolean).map((name) => TIMELINE_CHANNELS.indexOf(name.trim())).filter((i) => i >= 0);
}
