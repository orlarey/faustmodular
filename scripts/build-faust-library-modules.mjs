// Writes the modules taken from the Faust libraries (faust-library-modules.mjs) in
// public/faust-modules/faustlib/, and their list in index.json ("faustlib"). Then `npm run library-index`
// puts them in the catalog.
//
//     node scripts/build-faust-library-modules.mjs        (npm run faustlib-modules)
//
// A module is the function of the library, which has its own interface. A MIDI instrument of
// physmodels.lib (pitch: true) gets a Pitch slider, 0.1 per octave from C4, in place of its freq widget (Hz):
// Faust's widget modulation replaces the widget by the frequency of the pitch, so that a pitch dropped on it
// (a sequencer) plays in tune, as on the VCO (Documentation/widget-modulation/MODULATION.md, "+ additionner").

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAUST_LIBRARY_MODULES } from "./faust-library-modules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public/faust-modules/faustlib");

export function moduleCode(m) {
    const lines = [...m.summary];
    if (m.pitch) {
        lines.push("Pitch: 0.1 per octave, 0 = C4 (261.63 Hz), in place of the frequency of the instrument: a pitch dropped on it (a sequencer) plays in tune; Gate: the note");
    }
    lines.push(`From the Faust libraries: ${m.expr} (${m.lib})`);
    const process = m.pitch
        ? `// the freq widget (Hz) of the instrument replaced by the frequency of a pitch, 0.1 per octave from C4
process = ["freq" : (!, hz) -> ${m.expr}]
with {
    hz = hslider("Pitch[unit:pitch]", 0, -1, 1, 0.0001) : \\(p).(261.6256 * pow(2, 10 * p));
};`
        : `process = ${m.expr};`;
    return `declare name "${m.name}";
declare author "Faust libraries";
declare source "${m.expr} (${m.lib})";
import("stdfaust.lib");

/* =============== DESCRIPTION ================

${lines.map((l) => "- " + l).join("\n")}

*/

${process}
`;
}

export function modulePath(m) {
    return `faust-modules/faustlib/${m.file}.dsp`;
}

function build() {
    mkdirSync(dir, { recursive: true });
    for (const m of FAUST_LIBRARY_MODULES) writeFileSync(path.join(root, "public", modulePath(m)), moduleCode(m));
    // their list in index.json, one line as the other lists
    const indexPath = path.join(root, "public/faust-modules/index.json");
    let index = readFileSync(indexPath, "utf8");
    const line = `\t"faustlib" : [${FAUST_LIBRARY_MODULES.map((m) => JSON.stringify(modulePath(m))).join(", ")}]`;
    if (/\n\t"faustlib" : \[[^\n]*\]/.test(index)) {
        index = index.replace(/\n\t"faustlib" : \[[^\n]*\]/, "\n" + line);
    } else {
        index = index.replace(/\]\s*\n\}\s*$/, "],\n" + line + "\n}\n");
    }
    JSON.parse(index);
    writeFileSync(indexPath, index);
    console.log(`${FAUST_LIBRARY_MODULES.length} modules in ${path.relative(root, dir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) build();
