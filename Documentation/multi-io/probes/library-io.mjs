// Compiles every module of public/faust-modules and tabulates (inputs x outputs).
// Usage: node Documentation/multi-io/probes/library-io.mjs
import fs from "fs";
import path from "path";
import { compiler } from "./faust-env.mjs";

const root = path.join(process.cwd(), "public/faust-modules");
const hist = {};
for (const sub of ["generators", "effects", "combined"]) {
    for (const f of fs.readdirSync(path.join(root, sub)).filter(f => f.endsWith(".dsp"))) {
        const src = fs.readFileSync(path.join(root, sub, f), "utf8");
        let key;
        try {
            const j = JSON.parse((await compiler.createMonoDSPFactory(f, src, "-ftz 2")).json);
            key = `${sub} ${j.inputs}x${j.outputs}`;
        } catch (e) {
            key = `${sub} ERROR`;
        }
        (hist[key] ??= []).push(f.replace(".dsp", ""));
    }
}
for (const k of Object.keys(hist).sort()) console.log(k.padEnd(18), String(hist[k].length).padStart(3), hist[k].length < 8 ? hist[k].join(", ") : "");
