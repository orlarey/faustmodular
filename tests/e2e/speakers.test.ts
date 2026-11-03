// The menu of an output port (Scene.outputPortMenu): a click on an output (without a drag) or a right click
// opens it; it connects the output to the speakers or unplugs it, at once, each command one step of the
// history; the module menu sends all the outputs to the speakers (the bus rule) or unplugs them; the
// microphone cannot be sent to the speakers (Larsen); a drag from an output still draws a cable.
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

// A scene with a mono module (Sine) and a stereo one (Compressor).
async function open(): Promise<{ context: BrowserContext; page: Page; errors: string[]; sine: string; comp: string }> {
    const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: "en-US" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    const ids = await page.evaluate(async () => {
        const { app, scene } = (globalThis as any).faustPlayground;
        const code = 'import("stdfaust.lib");\nprocess = vgroup("Sine", os.osc(440) * 0.1);';
        await app.compileFaust({ name: "Sine", sourceCode: code, x: 300, y: 450, callback: (f: any) => app.createModule(f, "Sine", code, 300, 450) });
        while (scene.getModules().length < 1) await new Promise((r) => setTimeout(r, 20));
        app.uploadUrl(app, null, 300, 80, location.origin + "/faust-modules/faustlib/Compressor.dsp");
        while (scene.getModules().length < 2) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 300));
        return scene.getModules().map((m: any) => m.moduleId as string);
    });
    return { context, page, errors, sine: ids[0], comp: ids[1] };
}

const toSpeakers = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.getConnections()
    .filter((c: any) => c.to.module == "output").map((c: any) => `${c.from.module}:${c.from.port}>${c.to.port}`).sort());
const menu = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll(".context-menu .context-menu-item")).map((b) => ({
    label: b.textContent!.replace("✓", "").trim(), checked: b.getAttribute("aria-checked"), enabled: !(b as HTMLButtonElement).disabled,
})));
// a command of the menu, and its history step recorded
const choose = async (page: Page, label: string) => {
    await page.locator(".context-menu .context-menu-item", { hasText: label }).first().click();
    await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
};

async function clickOutput(page: Page, id: string, port: number, button: "left" | "right" = "left"): Promise<void> {
    const sel = await page.evaluate((m) => "#" + (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
    const box = (await page.locator(`${sel} .port-output[data-port="${port}"]`).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button });
    await page.waitForSelector(".context-menu");
}

describe("output to the speakers", () => {
    it("connects a mono output to both speakers, then to one, from a click on it; undone in one step", async () => {
        const { context, page, errors, sine } = await open();
        await clickOutput(page, sine, 0);
        expect(await menu(page)).toEqual([
            { label: "Left + right speakers", checked: "false", enabled: true },
            { label: "Left speaker", checked: "false", enabled: true },
            { label: "Right speaker", checked: "false", enabled: true },
            { label: "Unplug this output (all its cables)", checked: null, enabled: false },
        ]);
        await choose(page, "Left + right speakers");
        expect(await toSpeakers(page)).toEqual([`${sine}:0>0`, `${sine}:0>1`]);
        // checked now; the left one unchecked: only the right one stays
        await clickOutput(page, sine, 0);
        expect((await menu(page)).slice(0, 3).map((i) => i.checked)).toEqual(["true", "true", "true"]);
        await choose(page, "Left speaker");
        expect(await toSpeakers(page)).toEqual([`${sine}:0>1`]);
        // one step of the history each: undone, both again
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.undo());
        expect(await toSpeakers(page)).toEqual([`${sine}:0>0`, `${sine}:0>1`]);
        // both checked: unplugged together
        await clickOutput(page, sine, 0, "right");
        await choose(page, "Left + right speakers");
        expect(await toSpeakers(page)).toEqual([]);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("sends all the outputs of a module to the speakers, and unplugs them, from its outputs or its menu", async () => {
        const { context, page, errors, comp, sine } = await open();
        await clickOutput(page, comp, 1);
        const items = (await menu(page)).map((i) => i.label);
        expect(items).toEqual(expect.arrayContaining(["Outputs → speakers", "Unplug from the speakers"]));
        await choose(page, "Outputs → speakers");
        expect(await toSpeakers(page)).toEqual([`${comp}:0>0`, `${comp}:1>1`]);
        // a cable to another module stays when the speakers are unplugged; "this output" removes it too
        await page.evaluate(([c, s]) => (globalThis as any).faustPlayground.scene.patch.connect({ module: c, port: 1 }, { module: s, port: 0 }).id, [comp, sine]).catch(() => null);
        const sel = await page.evaluate((m) => "#" + (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, comp);
        const title = (await page.locator(`${sel} h6`).boundingBox())!;
        await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2, { button: "right" });
        await choose(page, "Unplug from the speakers");
        expect(await toSpeakers(page)).toEqual([]);
        await clickOutput(page, comp, 0);
        await choose(page, "Left speaker");
        expect(await toSpeakers(page)).toEqual([`${comp}:0>0`]);
        await clickOutput(page, comp, 0);
        await choose(page, "Unplug this output");
        expect(await toSpeakers(page)).toEqual([]);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("does not send the microphone to the speakers; a drag from an output still draws a cable", async () => {
        const { context, page, errors, sine } = await open();
        const mic = (await page.locator("#moduleInput .port-output").first().boundingBox())!;
        await page.mouse.click(mic.x + mic.width / 2, mic.y + mic.height / 2);
        await page.waitForSelector(".context-menu");
        expect((await menu(page)).slice(0, 3).every((i) => !i.enabled)).toBe(true);
        await page.keyboard.press("Escape");
        // a drag from the Sine to the speaker: a cable, no menu
        const sel = await page.evaluate((m) => "#" + (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, sine);
        const from = (await page.locator(`${sel} .port-output`).first().boundingBox())!;
        const to = (await page.locator("#moduleOutput .port-input").nth(1).boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();
        expect(await page.locator(".context-menu").count()).toBe(0);
        expect(await toSpeakers(page)).toEqual([`${sine}:0>1`]);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
