// The font of the icons of the Orbit interface (scripts/build-icon-font.mjs): a subset of Material Symbols
// Outlined served with the application, which must hold every icon faust-orbit-ui shows (after an update of
// faust-orbit-ui: npm run icon-font), and no page loads it from Google Fonts.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
// @ts-ignore: Node.js script
import { FONT_FILE, ICONS_FILE, orbitIcons } from "../../scripts/build-icon-font.mjs";

const root = path.resolve(__dirname, "../..");

describe("icon font", () => {
    it("holds the icons of faust-orbit-ui", () => {
        const icons = orbitIcons();
        expect(icons).toEqual(expect.arrayContaining(["casino", "my_location", "zoom_in"]));
        expect(JSON.parse(fs.readFileSync(ICONS_FILE, "utf8"))).toEqual(icons);
    });

    it("is a woff2 file declared by the page", () => {
        const font = fs.readFileSync(FONT_FILE);
        expect(font.subarray(0, 4).toString("latin1")).toBe("wOF2");
        const css = fs.readFileSync(path.join(root, "css/MaterialSymbols.css"), "utf8");
        expect(css).toContain(`url("fonts/${path.basename(FONT_FILE)}")`);
        const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
        expect(html).toContain('href="css/MaterialSymbols.css"');
        expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    });
});
