// The ports lit by their signal (src/view/PortMeters.ts): an output that leads to the speakers glows (--level), the
// inputs it feeds too; a module nobody hears is not metered (an analyser would make Web Audio compute it); a
// modulation port follows its source; turned off, nothing is lit.
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

const add = (page: Page, name: string, code: string, x: number) => page.evaluate(async ([n, c, xx]) =>
    (await (globalThis as any).faustPlayground.scene.addModuleFromCode(n, c, { x: xx, y: 250 })).moduleId as string, [name, code, x] as [string, string, number]);
const connect = (page: Page, from: string, to: string, port = 0) => page.evaluate(([f, t, p]) =>
    (globalThis as any).faustPlayground.scene.patch.connect({ module: f, port: 0 }, { module: t, port: p }), [from, to, port] as [string, string, number]);
const level = (page: Page, id: string, dir: string, port = 0) => page.evaluate(([m, d, p]) => {
    const el = document.querySelector(`.port[data-module="${m}"][data-dir="${d}"][data-port="${p}"]`) as HTMLElement | null;
    return el ? Number(el.style.getPropertyValue("--level") || 0) : -1;
}, [id, dir, port] as [string, string, number]);
const metered = (page: Page) => page.evaluate(() => Array.from((globalThis as any).faustPlayground.scene.audioGraph.meterPeaks().keys()));

describe("the ports lit by their signal", () => {
    it("lights what is heard, never meters what is not, follows a modulation, turns off", async () => {
        const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.portMeters.setEnabled(true));
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.audioGraph.getNode("output")?.context.resume());
        const osc = await add(page, "Osc", 'import("stdfaust.lib");\nprocess = os.osc(220) * hslider("gain", 0.5, 0, 1, 0.01);', 200);
        const alone = await add(page, "Alone", 'import("stdfaust.lib");\nprocess = os.osc(330) * 0.5;', 200);
        const lfo = await add(page, "LFO", 'process = 0.25;', 200);
        await connect(page, osc, "output");
        await expect.poll(() => level(page, osc, "out"), { timeout: 10_000 }).toBeGreaterThan(0.8);         // −6 dB
        await expect.poll(() => level(page, "output", "in")).toBeGreaterThan(0.8);
        expect(await level(page, alone, "out")).toBe(0);
        // the module nobody hears is not metered: the meters add no computation
        expect(await metered(page)).not.toContain(alone);
        expect(await metered(page)).not.toContain(lfo);
        // a modulation from the LFO: it is now computed, its port and the modulation port light up
        const address = await page.evaluate((m) => { const s = (globalThis as any).faustPlayground.scene; return s.widgetsOf(s.getModuleById(m)).find((w: any) => w.label == "gain").address; }, osc);
        await page.evaluate(([from, to, a]) => (globalThis as any).faustPlayground.scene.modulate({ module: from, port: 0 }, to, a, "modulate"), [lfo, osc, address]);
        await expect.poll(() => metered(page), { timeout: 10_000 }).toContain(lfo);
        await expect.poll(() => page.evaluate(() => Number((document.querySelector(".modulation-port") as HTMLElement | null)?.style.getPropertyValue("--level") || 0)), { timeout: 10_000 }).toBeGreaterThan(0.6);   // −12 dB
        // off: nothing lit, nothing metered
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.portMeters.setEnabled(false));
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".port")).filter((p) => p.style.getPropertyValue("--level")).length)).toBe(0);
        expect(await metered(page)).toEqual([]);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.portMeters.setEnabled(true));
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
