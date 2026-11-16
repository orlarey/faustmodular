// The limit of modules (src/audio/ModuleLimit.ts): a tab runs about 120 Faust modules, each with a WebAssembly
// memory of its own (Chrome: about 125 memories a tab). Past it, the audio of a module fails: the module is
// outlined in red, the failures are reported in one message, and nothing is thrown; a module removed lets a
// silent one start again. From 110 modules, a warning.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
    server = await createServer({ root: path.resolve(__dirname, "../.."), server: { port: 0 }, logLevel: "error" });
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

// A page with a scene of `n` small modules (one code: compiled once).
async function open(n: number): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    await page.evaluate(async (n) => {
        const { scene } = (globalThis as any).faustPlayground;
        const file = JSON.parse(scene.saveScene(false));
        for (let i = 0; i < n; i++) {
            const id = String(i + 1);
            file.modules.push({ id, kind: "faust", name: "Osc" + id, code: 'import("stdfaust.lib");\nprocess = os.osc(440) * 0.001;', x: (i % 20) * 140, y: 60 + Math.floor(i / 20) * 120, inputs: 0, outputs: 1, params: {}, acc: [] });
        }
        await scene.recallScene(JSON.stringify(file));
    }, n);
    await page.waitForFunction((n) => (globalThis as any).faustPlayground.scene.getModules().length >= n, n, { timeout: 120_000 });
    return { page, errors };
}

const failed = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().filter((m: any) => m.audioFailed).length as number);
const messages = (page: Page) => page.locator("#dialogue .message").allTextContents();

describe("the limit of modules", () => {
    it("past the limit: silent modules outlined, one message, nothing thrown; a module removed starts one again", async () => {
        const { page, errors } = await open(130);
        await expect.poll(() => failed(page), { timeout: 10_000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1500);
        const silent = await failed(page);
        expect(silent).toBeGreaterThanOrEqual(5);                   // 130 − about 122
        expect(silent).toBeLessThanOrEqual(15);
        expect(await page.locator(".moduleFaust.audio-failed").count()).toBe(silent);
        const shown = await messages(page);
        expect(shown.filter((m) => /130/.test(m) && /120/.test(m))).toHaveLength(1);    // one message, the limit
        expect(errors).toEqual([]);                                 // faustwasm no longer throws it
        // as many modules removed as are silent: they all start again
        await page.evaluate((k) => {
            const { scene } = (globalThis as any).faustPlayground;
            scene.getModules().filter((m: any) => !m.audioFailed).slice(0, k).forEach((m: any) => m.deleteModule());
        }, silent);
        await expect.poll(() => failed(page), { timeout: 20_000 }).toBe(0);
        await page.waitForTimeout(1000);
        expect(await failed(page)).toBe(0);
        expect(await page.locator(".moduleFaust.audio-failed").count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 240_000);

    it("near the limit: a warning, and no module silent", async () => {
        const { page, errors } = await open(112);
        await page.waitForTimeout(2000);
        expect(await failed(page)).toBe(0);
        await expect.poll(async () => (await messages(page)).filter((m) => /112/.test(m) && /120/.test(m)).length, { timeout: 5000 }).toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 240_000);
});
