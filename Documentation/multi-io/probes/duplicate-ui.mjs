// Shows that two instances of the same module, wrapped as the current export does,
// share a single control, and that unique group labels fix it.
// Usage: node Documentation/multi-io/probes/duplicate-ui.mjs
import { compiler } from "./faust-env.mjs";

const M = 'vgroup("Echo", environment{ process = *(hslider("gain",1,0,1,0.1)); }.process)';
for (const code of [`process = ${M}, ${M};`, `process = vgroup("Echo#1",${M}), vgroup("Echo#2",${M});`]) {
    const j = JSON.parse((await compiler.createMonoDSPFactory("t", code, "")).json);
    const addr = [];
    const walk = l => l.forEach(w => w.items ? walk(w.items) : addr.push(w.address));
    walk(j.ui);
    console.log(`${j.inputs}x${j.outputs}`, addr);
}
