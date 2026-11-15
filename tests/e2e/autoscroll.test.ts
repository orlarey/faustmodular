// The autoscroll (src/view/AutoScroll.ts): a module moved near an edge of the window scrolls the stage, and stays
// under the pointer (its place on the stage follows; written in the patch when it is released); a selection
// rectangle drawn near an edge scrolls it too; a magnified module moved keeps its size while the stage scrolls.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";

let server: ViteDevServer;
let browser: Browser;
let url: string;
const W = 1300, H = 800;

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

// A scene with a Compressor at (300, 200), at `zoom`.
async function open(zoom: number): Promise<{ context: BrowserContext; page: Page; errors: string[]; sel: string; id: string }> {
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    const id = await page.evaluate(async (z) => {
        const { app, scene } = (globalThis as any).faustPlayground;
        app.uploadUrl(app, null, 300, 200, location.origin + "/faust-modules/faustlib/Compressor.dsp");
        while (scene.getModules().length < 1) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 300));
        scene.setView(z, 0, 0);
        return scene.getModules()[0].moduleId as string;
    }, zoom);
    const sel = await page.evaluate((m) => "#" + (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
    await page.waitForTimeout(200);
    return { context, page, errors, sel, id };
}

const view = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.view as { zoom: number; x: number; y: number });
const place = (page: Page, id: string) => page.evaluate((m) => {
    const { scene } = (globalThis as any).faustPlayground;
    const v = scene.getModuleById(m).moduleView;
    const p = scene.patch.getModule(m);
    return { x: v.x as number, y: v.y as number, patchX: p.x as number, patchY: p.y as number };
}, id);

describe("autoscroll", () => {
    it("a module moved to the right edge scrolls the stage, the module staying under the pointer", async () => {
        const { context, page, errors, sel, id } = await open(1);
        const box = (await page.locator(sel).boundingBox())!;
        const grab = { x: box.x + 60, y: box.y + 14 };
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(W / 2, grab.y, { steps: 5 });
        await page.waitForTimeout(300);
        const still = await view(page);
        expect(still.x).toBe(0);                                // in the middle: no scroll
        await page.mouse.move(W - 5, grab.y, { steps: 5 });
        await page.waitForTimeout(600);
        const moved = await view(page);
        expect(moved.x).toBeLessThan(-200);                    // ~1000 px/s near the edge
        const at = await place(page, id);
        // the point grabbed stays under the pointer: on the stage, at the pointer minus the view
        const grabbed = await page.locator(sel).boundingBox();
        expect(grabbed!.x + 60).toBeCloseTo(W - 5, -1);
        await page.mouse.up();
        await page.waitForTimeout(100);
        const after = await view(page);
        await page.waitForTimeout(200);
        expect((await view(page)).x).toBe(after.x);             // released: it stops
        const end = await place(page, id);
        expect(end.patchX).toBeCloseTo(end.x, 3);              // written in the patch
        expect(end.x).toBeGreaterThan(at.x - 1);
        expect(end.x).toBeCloseTo(W - 5 - 60 - after.x, -1);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("a selection rectangle drawn to the bottom edge scrolls the stage", async () => {
        const { context, page, errors } = await open(1);
        await page.mouse.move(1000, 300);
        await page.mouse.down();
        await page.mouse.move(1050, H - 3, { steps: 6 });
        await page.waitForTimeout(500);
        expect((await view(page)).y).toBeLessThan(-150);
        await page.mouse.up();
        expect(await page.locator(".selection-band").count()).toBe(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("a magnified module moved keeps its size while the stage scrolls", async () => {
        const { context, page, errors, sel } = await open(0.45);
        const box = (await page.locator(sel).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 3 });
        await page.waitForTimeout(500);
        expect(await page.locator(sel).evaluate((e) => e.classList.contains("magnified"))).toBe(true);
        const big = (await page.locator(sel).boundingBox())!;
        // by the middle of its title (its icons are on the left)
        await page.mouse.move(big.x + big.width / 2, big.y + 12);
        await page.mouse.down();
        await page.mouse.move(big.x + big.width / 2, H - 4, { steps: 6 });
        await page.waitForTimeout(400);
        expect((await view(page)).y).toBeLessThan(-100);
        expect(await page.locator(sel).evaluate((e) => e.classList.contains("magnified"))).toBe(true);
        expect((await page.locator(sel).boundingBox())!.width).toBeCloseTo(big.width, 0);
        await page.mouse.up();
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
