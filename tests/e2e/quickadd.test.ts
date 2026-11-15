// The quick add (src/view/QuickAdd.ts): a double click on the empty stage, or Tab with the pointer over it,
// opens a search field there; typing finds the modules as the Modules menu does, Enter adds the one chosen
// where the field was opened; before anything is typed, the field offers the modules added last
// (src/model/RecentModules.ts); Escape closes it; a double click on a module does not open it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
    server = await createServer({ root: path.resolve(__dirname, "../.."), server: { port: 0 }, logLevel: "error" });
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

async function open(): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    await page.waitForTimeout(300);
    return { context, page, errors };
}

const count = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().length as number);
const names = (page: Page) => page.locator(".quick-add-item .quick-add-name").allTextContents();

describe("quick add", () => {
    it("opens on a double click on the empty stage, finds a module, and adds it there with Enter", async () => {
        const { context, page, errors } = await open();
        const before = await count(page);
        await page.mouse.dblclick(650, 450);
        await expect.poll(() => page.locator(".quick-add").count()).toBe(1);
        expect(await page.evaluate(() => document.activeElement?.className)).toBe("quick-add-input");
        await page.keyboard.type("compressor");
        expect((await names(page))[0]).toBe("Compressor");
        await page.keyboard.press("Enter");
        expect(await page.locator(".quick-add").count()).toBe(0);
        await expect.poll(() => count(page), { timeout: 60_000 }).toBe(before + 1);
        const placed = await page.evaluate(() => {
            const { scene } = (globalThis as any).faustPlayground;
            const m = scene.getModules()[scene.getModules().length - 1];
            return { at: scene.toStage(650, 450), x: m.moduleView.x, y: m.moduleView.y };
        });
        expect(placed.x).toBeCloseTo(placed.at.x, 0);
        expect(placed.y).toBeCloseTo(placed.at.y, 0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("offers the modules added last before anything is typed; Tab opens it, Escape closes it", async () => {
        const { context, page, errors } = await open();
        await page.mouse.dblclick(650, 450);
        await page.keyboard.type("echo");
        const echo = (await names(page))[0];
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().some((m: any) => /echo/i.test(m.moduleView.fTitle?.textContent ?? "")), null, { timeout: 60_000 });
        // Tab, the pointer over the empty stage
        await page.mouse.move(400, 650);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press("Tab");
        await expect.poll(() => page.locator(".quick-add").count()).toBe(1);
        expect(await page.locator(".quick-add-title").count()).toBe(1);
        expect((await names(page))[0]).toBe(echo);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("faustmodular:recent-modules") ?? "[]"));
        expect(stored[0]).toMatch(/\.dsp$/);
        await page.keyboard.press("Escape");
        expect(await page.locator(".quick-add").count()).toBe(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("does not open on a double click on a module", async () => {
        const { context, page, errors } = await open();
        const sel = await page.evaluate(() => "#" + (globalThis as any).faustPlayground.scene.fAudioOutput.moduleView.fModuleContainer.id);
        const box = (await page.locator(sel).boundingBox())!;
        await page.mouse.dblclick(box.x + box.width / 2, box.y + 12);
        await page.waitForTimeout(200);
        expect(await page.locator(".quick-add").count()).toBe(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
