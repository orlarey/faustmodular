// The magnifier (src/view/Magnifier.ts): zoomed out under 75 %, the module under the pointer is shown at its
// real size after 250 ms, above the others, and goes back when the pointer leaves it; it stays usable (a
// slider moved, even out of it); a module moved is no longer magnified; while a cable is drawn, the module
// under it is magnified, so that a widget can be aimed at (a modulation).
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

// A scene with a SineVCO and a Compressor, zoomed out at `zoom`.
async function open(zoom: number): Promise<{ context: BrowserContext; page: Page; errors: string[]; sine: string; comp: string }> {
    const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    const ids = await page.evaluate(async (z) => {
        const { app, scene } = (globalThis as any).faustPlayground;
        const code = 'process = vgroup("Sine", os.osc(hslider("freq", 440, 40, 8000, 1)) * 0.1);';
        await app.compileFaust({ name: "Sine", sourceCode: 'import("stdfaust.lib");\n' + code, x: 900, y: 500, callback: (f: any) => app.createModule(f, "Sine", 'import("stdfaust.lib");\n' + code, 900, 500) });
        while (scene.getModules().length < 1) await new Promise((r) => setTimeout(r, 20));
        app.uploadUrl(app, null, 200, 120, location.origin + "/faust-modules/faustlib/Compressor.dsp");
        while (scene.getModules().length < 2) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 300));
        scene.setView(z, 100, 100);
        return scene.getModules().map((m: any) => m.moduleId as string);
    }, zoom);
    await page.waitForTimeout(200);
    return { context, page, errors, sine: ids[0], comp: ids[1] };
}

const selector = (page: Page, id: string) => page.evaluate((m) => "#" + (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
const shown = (page: Page, sel: string) => page.evaluate((s) => {
    const e = document.querySelector(s) as HTMLElement;
    const r = e.getBoundingClientRect();
    return { magnified: e.classList.contains("magnified"), width: r.width, height: r.height, real: e.offsetWidth, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}, sel);

describe("magnifier", () => {
    it("does nothing at 75 % and more", async () => {
        const { context, page, errors, comp } = await open(0.8);
        const sel = await selector(page, comp);
        const box = (await page.locator(sel).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
        await page.waitForTimeout(500);
        expect((await shown(page, sel)).magnified).toBe(false);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("shows the module under the pointer at its real size after 250 ms, inside the window, until the pointer leaves", async () => {
        const { context, page, errors, comp } = await open(0.45);
        const sel = await selector(page, comp);
        const small = await shown(page, sel);
        await page.mouse.move(small.left + small.width / 2, small.top + 40, { steps: 3 });
        await page.waitForTimeout(120);
        expect((await shown(page, sel)).magnified).toBe(false);
        await page.waitForTimeout(400);
        const big = await shown(page, sel);
        expect(big.magnified).toBe(true);
        expect(big.width).toBeCloseTo(big.real, 0);         // 100 % on the screen
        expect(big.left).toBeGreaterThanOrEqual(8 - 0.5);
        expect(big.top).toBeGreaterThanOrEqual(48 + 8 - 0.5);
        expect(big.right).toBeLessThanOrEqual(1300 - 8 + 0.5);
        expect(big.bottom).toBeLessThanOrEqual(800 - 8 + 0.5);
        // out of it: back
        await page.mouse.move(1250, 760, { steps: 4 });
        await page.waitForTimeout(400);
        const back = await shown(page, sel);
        expect(back.magnified).toBe(false);
        expect(back.width).toBeCloseTo(small.width, 0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("stays usable: a slider moved, even out of the module; a module moved is no longer magnified", async () => {
        const { context, page, errors, comp } = await open(0.45);
        const sel = await selector(page, comp);
        const small = await shown(page, sel);
        await page.mouse.move(small.left + small.width / 2, small.top + small.height / 2, { steps: 3 });
        await page.waitForTimeout(450);
        expect((await shown(page, sel)).magnified).toBe(true);
        // the Makeup Gain slider, dragged to the left and out of the module
        const slider = page.locator(`${sel} .control-group:not(.control-knob) input[type=range]`).last();
        const s = (await slider.boundingBox())!;
        const value = () => page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => /makeup/i.test(c.itemParam.label)).value, comp);
        const before = await value();
        await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
        await page.mouse.down();
        await page.mouse.move(s.x + s.width * 0.1, s.y + s.height / 2, { steps: 4 });
        await page.mouse.move(s.x + s.width * 0.1, s.y + 400, { steps: 4 });      // out of the module
        expect((await shown(page, sel)).magnified).toBe(true);
        await page.mouse.up();
        expect(Number(await value())).toBeLessThan(Number(before));
        // moved by its title: back to its size, moved by the drag on the stage
        await page.waitForTimeout(100);
        const big = await shown(page, sel);
        const x0 = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.x, comp);
        await page.mouse.move(big.left + big.width / 2, big.top + 14, { steps: 2 });
        await page.waitForTimeout(50);
        await page.mouse.down();
        await page.mouse.move(big.left + big.width / 2 + 45, big.top + 14, { steps: 5 });
        expect((await shown(page, sel)).magnified).toBe(false);
        await page.mouse.up();
        const x1 = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.x, comp);
        expect(x1 - x0).toBeCloseTo(45 / 0.45, -1);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("magnifies the module under a cable being drawn: a knob aimed at, a modulation", async () => {
        const { context, page, errors, sine, comp } = await open(0.45);
        const sineSel = await selector(page, sine), compSel = await selector(page, comp);
        const port = (await page.locator(`${sineSel} .port-output`).first().boundingBox())!;
        const target = await shown(page, compSel);
        await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.left + target.width / 2, target.top + target.height / 2, { steps: 8 });
        await page.mouse.move(target.left + target.width / 2 + 2, target.top + target.height / 2, { steps: 2 });
        await page.waitForTimeout(450);
        expect((await shown(page, compSel)).magnified).toBe(true);
        // the Ratio knob, at its real size
        const knob = (await page.locator(`${compSel} .control-knob svg.knob`).first().boundingBox())!;
        expect(knob.width).toBeGreaterThan(40);
        await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).modulations.length == 1, comp, { timeout: 60_000 });
        const widget = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).modulations[0].widget as string, comp);
        expect(widget.toLowerCase()).toContain("ratio");
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
