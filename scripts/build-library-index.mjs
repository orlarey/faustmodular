// Builds public/faust-modules/library-index.json: the hash of the code of each module of the library
// (Documentation/DOCUMENT-SPEC.md, "Le statut se déduit du contenu"), and the hashes of their past
// versions, found in the git history and kept from the previous index (the history only grows).
//
//     node scripts/build-library-index.mjs        (npm run library-index)
//
// The hash is the SHA-1 of the file in UTF-8, line endings normalized to \n (src/documents/Sha1.ts).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAUSTPLAYGROUND_FAMILIES } from "./library-families.mjs";
import { FAUST_LIBRARY_FAMILIES } from "./faust-library-modules.mjs";
import { LIBRARY_MODULES } from "./build-faust-library-modules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public/faust-modules/library-index.json");

export function hashOf(text) {
    return createHash("sha1").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

// The paths of the library, as index.json lists them ("faust-modules/generators/Kisana.dsp").
export function libraryPaths() {
    const index = JSON.parse(readFileSync(path.join(root, "public/faust-modules/index.json"), "utf8"));
    return Object.values(index).filter(Array.isArray).flat().filter((p) => typeof p == "string" && p.endsWith(".dsp"));
}

export function currentHashes() {
    const modules = {};
    for (const p of libraryPaths()) modules[p] = hashOf(readFileSync(path.join(root, "public", p), "utf8"));
    return modules;
}

function git(...args) {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Past versions of a file: { hash: date when it was replaced }.
function pastVersions(p, current) {
    const past = {};
    let commits;
    try {
        commits = git("log", "--format=%H %cI", "--", `public/${p}`).trim().split("\n").filter(Boolean).map((l) => l.split(" "));
    } catch {
        return past;
    }
    // newest first: a version is replaced at the date of the commit before it in this list
    let replacedAt = null;
    for (const [commit, date] of commits) {
        let text;
        try {
            text = git("show", `${commit}:public/${p}`);
        } catch {
            replacedAt = date;          // removed or renamed in this commit
            continue;
        }
        const hash = hashOf(text);
        if (hash != current && !(hash in past)) past[hash] = replacedAt ?? date;
        replacedAt = date;
    }
    return past;
}

// The catalog of the library, shown in one view (a family, its modules, the description of a module): the
// modular library (Documentation/MODULAR-LIBRARY.md) and the displays, with their functions (as ModularGrid
// names them), family, summary and description, read from their declarations (declare function "...",
// declare function2 "...", declare summary "...") and from their DESCRIPTION comment; then the
// FaustPlayground modules, in the families of library-families.mjs; then the modules taken from the Faust
// libraries (faust-library-modules.mjs).
export const FAMILIES = [
    ["Sources", ["Oscillator", "Noise", "Drum", "Voice", "Synth", "Resonator", "Sampling"]],
    ["Timbre", ["Filter", "Low Pass Gate", "Waveshaper", "Distortion", "Fuzz", "Ring Modulator", "Equalizer", "Phase Shifter", "Pitch Shifter"]],
    ["Level", ["VCA", "Mixer", "Panning", "Dynamics", "Attenuator", "Polarizer", "Precision Adder"]],
    ["Control", ["Envelope Generator", "Function Generator", "LFO", "Envelope Follower", "Slew Limiter", "CV Modulation"]],
    ["Time", ["Clock Generator", "Clock Modulator", "Frequency Divider", "Sequencer", "Shift Register", "Logic", "Comparator", "Switch"]],
    ["Random and pitch", ["Random", "Sample and Hold", "Quantizer"]],
    ["Effects", ["Delay", "Reverb", "Looper", "Effect"]],
    ["Measure", ["Display"]],
];

export function familyOf(func) {
    return FAMILIES.find(([, functions]) => functions.includes(func))?.[0] ?? null;
}

function declared(code, key) {
    const m = new RegExp(`^\\s*declare\\s+${key}\\s+"([^"]*)"\\s*;`, "m").exec(code);
    return m ? m[1] : null;
}

export function catalogEntry(p, code) {
    const functions = [declared(code, "function"), declared(code, "function2")].filter(Boolean);
    if (functions.length == 0 && p.includes("/display/")) functions.push("Display");
    // the lines of the DESCRIPTION comment, without the empty ones nor those of punctuation alone (":")
    const description = /={3,}\s*DESCRIPTION\s*={3,}([\s\S]*?)\*\//.exec(code)?.[1].trim().split("\n").map((l) => l.trim()).filter((l) => /[\p{L}\p{N}]/u.test(l)).join("\n") ?? "";
    return {
        path: p,
        name: declared(code, "name") ?? path.basename(p, ".dsp"),
        functions,
        family: familyOf(functions[0]),
        summary: declared(code, "summary") ?? description.split("\n")[0]?.replace(/^- /, "") ?? "",
        description,
        inlets: (declared(code, "inlets") ?? "").split(";").map((s) => s.trim()).filter(Boolean),
        outlets: (declared(code, "outlets") ?? "").split(";").map((s) => s.trim()).filter(Boolean),
    };
}

export function libraryCatalog() {
    const index = JSON.parse(readFileSync(path.join(root, "public/faust-modules/index.json"), "utf8"));
    const paths = [...(index.modular ?? []), ...(index.affichage ?? [])];
    const entry = (p) => catalogEntry(p, readFileSync(path.join(root, "public", p), "utf8"));
    const modular = paths.map(entry);
    const others = FAUSTPLAYGROUND_FAMILIES.flatMap(([family, modules]) => modules.map((p) => ({ ...entry(p), family })));
    const faustlib = LIBRARY_MODULES.map((m) => ({ ...entry(`faust-modules/faustlib/${m.file}.dsp`), family: m.family }));
    return {
        format: "faustmodular-library-catalog",
        groups: [
            { name: "Modular", families: FAMILIES.map(([name]) => name) },
            { name: "FaustPlayground", families: FAUSTPLAYGROUND_FAMILIES.map(([name]) => name) },
            { name: "Faust libraries", families: FAUST_LIBRARY_FAMILIES },
        ],
        modules: [...modular, ...others, ...faustlib],
    };
}

function build() {
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : { modules: {}, history: {} };
    const modules = currentHashes();
    const history = { ...previous.history };
    // a version shipped before and replaced since
    for (const [p, hash] of Object.entries(previous.modules ?? {})) {
        if (modules[p] != hash && !(hash in history)) history[hash] = { path: p, until: version };
    }
    for (const [p, hash] of Object.entries(modules)) {
        for (const [old, date] of Object.entries(pastVersions(p, hash))) {
            if (!(old in history) && !Object.values(modules).includes(old)) history[old] = { path: p, until: date };
        }
    }
    for (const hash of Object.values(modules)) delete history[hash];     // shipped again
    const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(output, JSON.stringify({ format: "faustmodular-library-index", version, modules: sorted(modules), history: sorted(history) }, null, 1) + "\n");
    const catalog = libraryCatalog();
    writeFileSync(path.join(root, "public/faust-modules/library-catalog.json"), JSON.stringify(catalog, null, 1) + "\n");
    console.log(`library catalog: ${catalog.modules.length} modules`);
    console.log(`${output}: ${Object.keys(modules).length} modules, ${Object.keys(history).length} past versions`);
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) build();
