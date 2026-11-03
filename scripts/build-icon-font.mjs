/*				BUILD-ICON-FONT.MJS
    The icons of the Orbit interface (faust-orbit-ui) in a font of the application, not loaded from Google Fonts:
    the subset of Material Symbols Outlined (Apache License 2.0) with the icons faust-orbit-ui shows (the text of
    its elements of class material-symbols-outlined), its axes those its style uses (opsz 20..48, wght 400..500,
    FILL 0, GRAD 0). Written to css/fonts/material-symbols-outlined.woff2, with the list of its icons
    (css/fonts/material-symbols-icons.json); tests/library/icon-font.test.ts checks it is up to date with
    faust-orbit-ui.

    npm run icon-font       (after an update of faust-orbit-ui: downloads the subset from Google Fonts)
*/

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FONT_FILE = path.join(root, "css/fonts/material-symbols-outlined.woff2");
export const ICONS_FILE = path.join(root, "css/fonts/material-symbols-icons.json");
const AXES = "opsz,wght,FILL,GRAD@20..48,400..500,0,0";

// The icons of faust-orbit-ui: in its HTML (<span class="... material-symbols-outlined">name</span>) and in its
// code (an element of that class whose textContent is set to a name), sorted.
export function orbitIcons(dist = path.join(root, "node_modules/faust-orbit-ui/dist")) {
    const icons = new Set();
    for (const file of fs.readdirSync(dist).filter((f) => f.endsWith(".js"))) {
        const code = fs.readFileSync(path.join(dist, file), "utf8");
        for (const m of code.matchAll(/material-symbols-outlined"[^>]*>([a-z0-9_]+)</g)) icons.add(m[1]);
        if (!code.includes("material-symbols-outlined")) continue;
        for (const m of code.matchAll(/\.textContent\s*=\s*['"]([a-z0-9_]+)['"]/g)) icons.add(m[1]);
    }
    return [...icons].sort();
}

async function download(icons) {
    // a recent browser: Google Fonts answers with woff2
    const agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    const url = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:${AXES}&icon_names=${icons.join(",")}&display=block`;
    const css = await (await fetch(url, { headers: { "User-Agent": agent } })).text();
    const font = css.match(/src:\s*url\((https:[^)]+)\)\s*format\(['"]woff2['"]\)/);
    if (!font) throw new Error("no woff2 in the answer of Google Fonts:\n" + css);
    const bytes = Buffer.from(await (await fetch(font[1])).arrayBuffer());
    fs.writeFileSync(FONT_FILE, bytes);
    fs.writeFileSync(ICONS_FILE, JSON.stringify(icons, null, 1) + "\n");
    console.log(`${path.relative(root, FONT_FILE)}: ${icons.length} icons, ${bytes.length} bytes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    await download(orbitIcons());
}
