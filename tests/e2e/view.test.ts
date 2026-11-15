// The view of a document (src/Scenes/SceneClass.ts, ZOOM): its zoom and position, remembered by the browser
// for each document, shown again when the page is opened again.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser } from "playwright";
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

describe("the view of a document", () => {
    it("is shown again when the page is opened again", async () => {
        const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const ready = () => page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        await page.goto(url + "?starter=0");
        await ready();
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.view)).toEqual({ zoom: 1, x: 0, y: 0 });
        // zoomed out and moved, the view written once it stops changing
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.setView(0.42, -130, 75));
        await page.waitForTimeout(600);
        await page.reload();
        await ready();
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.view)).toEqual({ zoom: 0.42, x: -130, y: 75 });
        // a value that cannot be a view is ignored
        await page.evaluate(() => {
            const id = (globalThis as any).faustPlayground.documents.current.id;
            localStorage.setItem("faustmodular:view:" + id, '{"zoom":"big"}');
        });
        await page.reload();
        await ready();
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.view)).toEqual({ zoom: 1, x: 0, y: 0 });
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
