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
    console.log(`${output}: ${Object.keys(modules).length} modules, ${Object.keys(history).length} past versions`);
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) build();
