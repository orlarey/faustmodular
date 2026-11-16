// faustmodular and the real faustcode, served by the same origin (vite.config.mjs serves FAUSTCODE_DIR, or
// ../faustcode, under /faustcode/): the pencil opens the resource in faustcode, a save there updates every instance of
// the resource (Documentation/SCENE-RESOURCES-SPEC.md; spec_documents.md of faustcode). Skipped without faustcode.
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
const QUARTER = 'import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01)) : *(0.25);';

const codes = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().map((m: any) => m.moduleFaust.getSource().split("\n").slice(1, -1).join("\n")));

describe.skipIf(!present)("faustmodular and the real faustcode (same origin)", () => {
    it("the pencil opens the resource in faustcode; a save updates all its instances; a code with errors is not sent", async () => {
        const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push("faustmodular: " + e.message));
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        const ids: string[] = [];
        for (let i = 0; i < 2; i++) ids.push(await page.evaluate(async (code) => (await (globalThis as any).faustPlayground.scene.addModuleFromCode("Gain", code, { x: 200 + 300 * Math.random(), y: 200 })).moduleId, GAIN));
        await page.evaluate(() => (globalThis as any).faustPlayground.documents.flush());

        const [fc] = await Promise.all([context.waitForEvent("page"), page.evaluate((id) => { const s = (globalThis as any).faustPlayground.scene; s.editInFaustcode(s.getModuleById(id)); }, ids[0])]);
        fc.on("pageerror", (e) => errors.push("faustcode: " + e.message));
        expect(fc.url()).toMatch(/\/faustcode\/\?open=faustmodular%3A/);
        await fc.locator("#audio-gate:not(.hidden) #audio-gate-button").click({ timeout: 60_000 });
        const label = () => fc.evaluate(() => document.getElementById("session-label")?.textContent ?? "");
        await expect.poll(label, { timeout: 30_000 }).toBe("Gain.dsp — faustmodular ▸ Untitled ▸ Gain");
        await expect.poll(() => fc.evaluate(() => document.querySelector("#view-container .cm-content")?.textContent), { timeout: 20_000 }).toBe(GAIN.replace("\n", ""));

        // a code with errors: not sent
        await fc.click("#view-container .cm-content");
        await fc.keyboard.press("Control+a");
        await fc.keyboard.type("process = nope;");
        await fc.keyboard.press("Control+s");
        await fc.waitForTimeout(2000);
        expect(await label()).toContain("●");
        expect(await codes(page)).toEqual([GAIN, GAIN]);

        // a code that compiles: both instances updated
        await fc.keyboard.press("Control+a");
        await fc.keyboard.type(QUARTER);
        await fc.keyboard.press("Control+s");
        await expect.poll(() => codes(page), { timeout: 20_000 }).toEqual([QUARTER, QUARTER]);
        await expect.poll(label).toBe("Gain.dsp — faustmodular ▸ Untitled ▸ Gain");

        // faustcode reloaded: the document is still linked, a save still updates the scene
        await fc.reload();
        await fc.locator("#audio-gate:not(.hidden) #audio-gate-button").click({ timeout: 60_000 });
        await expect.poll(label, { timeout: 30_000 }).toBe("Gain.dsp — faustmodular ▸ Untitled ▸ Gain");
        await fc.click("#view-container .cm-content");
        await fc.keyboard.press("Control+a");
        await fc.keyboard.type(GAIN);
        await fc.keyboard.press("Control+s");
        await expect.poll(() => codes(page), { timeout: 20_000 }).toEqual([GAIN, GAIN]);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);
});
