// × multiplier (Documentation/widget-modulation/MODULATION.md, 3.60.0): a cable on a slider declaring [mod:mul] is
// offered no other mode; the gain is the slider times the signal (D = 1), and the amount, set on the port live,
// doses it: w·(1 − D + D·m).
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

const add = (page: Page, name: string, code: string) => page.evaluate(async ([n, c]) =>
    (await (globalThis as any).faustPlayground.scene.addModuleFromCode(n, c, { x: 200 + Math.random() * 500, y: 250 })).moduleId as string, [name, code]);

// The last sample of the output of a module.
const outputOf = (page: Page, id: string) => page.evaluate(async (moduleId) => {
    const s = (globalThis as any).faustPlayground.scene;
    const node = s.audioGraph.getNode(moduleId);
    await node.context.resume();
    const analyser = node.context.createAnalyser();
    node.connect(analyser);
    await new Promise((r) => setTimeout(r, 400));
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    node.disconnect(analyser);
    return buffer[buffer.length - 1];
}, id);

describe("× multiplier ([mod:mul])", () => {
    it("multiplies the slider by the signal, dosed by the amount of the port", async () => {
        const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        const one = await add(page, "One", "process = 1;");
        const env = await add(page, "Env", "process = 0.5;");
        const vca = await add(page, "VCA", 'process = *(hslider("Gain[mod:mul]", 1, 0, 1, 0.01));');
        await page.evaluate(([from, to]) => (globalThis as any).faustPlayground.scene.patch.connect({ module: from, port: 0 }, { module: to, port: 0 }), [one, vca]);
        const address = await page.evaluate((m) => { const s = (globalThis as any).faustPlayground.scene; return s.widgetsOf(s.getModuleById(m)).find((w: any) => w.label == "Gain").address; }, vca);
        expect(await page.evaluate(([m, a]) => (globalThis as any).faustPlayground.scene.allowedModesOf(m, a), [vca, address])).toEqual(["multiply"]);
        expect(await page.evaluate(([from, to, a]) => (globalThis as any).faustPlayground.scene.modulate({ module: from, port: 0 }, to, a, "multiply"), [env, vca, address])).toBe(true);
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 2, vca);
        expect(await outputOf(page, vca)).toBeCloseTo(0.5, 4);                     // w = 1: the envelope
        // the slider at 0.4: 0.4 × 0.5
        await page.evaluate(([m, a]) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().setParamValue(a, 0.4), [vca, address]);
        await expect.poll(() => outputOf(page, vca)).toBeCloseTo(0.2, 3);
        // the amount set on the port, live: 0.4·(1 − 0.5 + 0.5·0.5) = 0.3
        await page.evaluate((m) => { const s = (globalThis as any).faustPlayground.scene; s.setDepth(m, s.patch.getModule(m).modulations[0].id, 0.5); }, vca);
        await expect.poll(() => outputOf(page, vca)).toBeCloseTo(0.3, 3);
        // its port: the × icon, the amount in its title
        const title = await page.evaluate(() => (document.querySelector(".modulation-port") as HTMLElement | null)?.title ?? "");
        expect(title).toMatch(/^× multiply/);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
