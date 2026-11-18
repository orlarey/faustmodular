// faustcode's Open… and Revert to saved (faustcode, spec_documents.md, « La boîte Ouvrir », « Enregistrer et
// compiler »), with faustmodular served by the same origin: the volumes, the documents of the Library, the scenes of
// faustmodular and their resources; a working copy reverted to the saved content. Skipped without faustcode.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import fs from "fs";
import path from "path";

const FAUSTCODE = path.join(process.env.FAUSTCODE_DIR ?? path.resolve(__dirname, "../../../faustcode"), "webapp", "index.html");
const present = fs.existsSync(FAUSTCODE);

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
    if (!present) return;
    server = await createServer({ root: path.resolve(__dirname, "../.."), server: { port: 0 }, logLevel: "error" });
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

const GAIN = 'import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01));';

const label = (fc: Page) => fc.evaluate(() => document.getElementById("session-label")?.textContent ?? "");
const editorText = (fc: Page) => fc.evaluate(() => document.querySelector("#view-container .cm-content")?.textContent ?? "");
const rows = (fc: Page) => fc.evaluate(() => Array.from(document.querySelectorAll(".open-dialog .open-row .store-module-name")).map((e) => e.textContent!.trim()));
const crumbs = (fc: Page) => fc.evaluate(() => document.querySelector(".open-dialog .open-crumbs")?.textContent ?? "");
const menu = async (fc: Page, item: string) => {
    await fc.click("#file-menu-btn");
    await fc.locator(".file-menu .file-menu-item", { hasText: item }).first().click();
};

describe.skipIf(!present)("faustcode: Open… and Revert to saved", () => {
    it("opens from the volumes, where the document is; reverts the working copy", async () => {
        const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push("faustmodular: " + e.message));
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        await page.evaluate(async (code) => (await (globalThis as any).faustPlayground.scene.addModuleFromCode("Gain", code, { x: 300, y: 200 })).moduleId, GAIN);
        await page.evaluate(() => (globalThis as any).faustPlayground.documents.flush());

        const fc = await context.newPage();
        fc.on("pageerror", (e) => errors.push("faustcode: " + e.message));
        fc.on("dialog", (d) => void d.accept());
        await fc.goto(url + "faustcode/");
        await fc.locator("#audio-gate:not(.hidden) #audio-gate-button").click({ timeout: 60_000 });

        // a document of the Library: New file, saved
        await menu(fc, "New file");
        await expect.poll(() => label(fc), { timeout: 30_000 }).toMatch(/^untitled.*\.dsp$/);
        const name = (await label(fc)).trim();
        if (!(await fc.locator("#view-container .cm-content").count())) await fc.selectOption("#view-select", "dsp");
        await expect.poll(() => editorText(fc), { timeout: 20_000 }).not.toBe("");
        const saved = await editorText(fc);

        // Revert to saved: the working copy goes, ● too
        await fc.click("#view-container .cm-content");
        await fc.keyboard.press("End");
        await fc.keyboard.type(" // changed");
        await expect.poll(() => label(fc)).toContain("●");
        await menu(fc, "Revert to saved");
        await expect.poll(() => label(fc)).toBe(name);
        expect(await editorText(fc)).toBe(saved);

        // Cmd/Ctrl-O: the four volumes, the Library with the open document checked
        await fc.keyboard.press("Control+o");
        await fc.waitForSelector(".open-dialog");
        expect(await fc.evaluate(() => Array.from(document.querySelectorAll(".open-volume")).map((b) => b.textContent))).toEqual(["Library", "Disk", "Stores", "faustmodular"]);
        expect(await rows(fc)).toContain(`✓ ${name}`);
        await fc.fill(".open-search", "nothing-like-this");
        expect(await rows(fc)).toEqual([]);
        await fc.fill(".open-search", "");

        // faustmodular ▸ its scene ▸ the resource Gain: opened as a document whose origin is the resource
        await fc.click(".open-volume[data-volume=faustmodular]");
        await expect.poll(() => rows(fc)).toContain("Untitled");
        await fc.locator(".open-dialog .open-row", { hasText: "Untitled" }).click();
        await expect.poll(() => rows(fc)).toEqual(["Gain"]);
        expect(await crumbs(fc)).toBe("faustmodular ▸ Untitled");
        await fc.locator(".open-dialog .open-row", { hasText: "Gain" }).click();
        await expect.poll(() => label(fc), { timeout: 30_000 }).toBe("Gain.dsp — faustmodular ▸ Untitled ▸ Gain");
        expect(await fc.locator(".open-dialog").count()).toBe(0);

        // a click on the origin in the header: Open… where the document is
        await fc.click("#session-label");
        await fc.waitForSelector(".open-dialog");
        await expect.poll(() => crumbs(fc)).toBe("faustmodular ▸ Untitled");
        await expect.poll(() => rows(fc)).toEqual(["✓ Gain"]);
        // Backspace in the empty search: up one level; Escape closes
        await fc.focus(".open-search");
        await fc.keyboard.press("Backspace");
        await expect.poll(() => crumbs(fc)).toBe("faustmodular");
        await fc.keyboard.press("Escape");
        expect(await fc.locator(".open-dialog").count()).toBe(0);

        // back to the Library document, with the search and Enter
        await fc.keyboard.press("Control+o");
        await fc.click(".open-volume[data-volume=library]");
        await fc.fill(".open-search", name.replace(/\.dsp$/, ""));
        await fc.keyboard.press("Enter");
        await expect.poll(() => label(fc), { timeout: 30_000 }).toBe(name);

        // Stores: none followed, said; Disk: Open a file of the device…
        await fc.keyboard.press("Control+o");
        await fc.click(".open-volume[data-volume=stores]");
        await expect.poll(() => fc.textContent(".open-dialog .open-list")).toContain("No store followed");
        await fc.click(".open-volume[data-volume=disk]");
        expect(await fc.textContent(".open-dialog .open-actions")).toContain("Open a file of the device…");
        await fc.keyboard.press("Escape");

        expect(errors).toEqual([]);
        await context.close();
    }, 180_000);
});
