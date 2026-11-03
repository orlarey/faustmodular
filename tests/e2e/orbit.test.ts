// The Orbit interface of a module (faust-orbit-ui, src/Modules/OrbitPanel.ts) in the application: shown in
// place of the classic interface; its gestures set the values as the sliders do, at every zoom of the
// stage (the workaround of faust-orbit-ui 0.4.1); undone, saved with the document; the modulation ports
// in a column, a cable dropped on a point; its dropdowns where they belong; its keys kept to itself.
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

async function open(context?: BrowserContext): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    context ??= await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    return { context, page, errors };
}

function add(page: Page, file: string, x: number, y: number): Promise<string> {
    return page.evaluate(async ([f, xx, yy]) => {
        const { app, scene } = (globalThis as any).faustPlayground;
        const n = scene.getModules().length;
        app.uploadUrl(app, null, xx, yy, location.origin + "/faust-modules/" + f);
        while (scene.getModules().length == n) await new Promise((r) => setTimeout(r, 20));
        return scene.getModules()[n].moduleId as string;
    }, [file, x, y] as [string, number, number]);
}

const containerOf = (page: Page, id: string) => page.evaluate((m) => "#" + (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);

// A point of the Orbit of a module: where it is on the screen, the value of its widget (its controller, the
// Orbit). (The DSP of an AudioWorklet node reports its parameters late: not read here.)
function point(page: Page, id: string, label: string) {
    return page.evaluate(([m, l]) => {
        const module = (globalThis as any).faustPlayground.scene.getModuleById(m);
        const inner = module.orbit.orbit.inner;
        const state = inner.getOrbitState();
        const path = Object.keys(state.controls).find((p) => p.endsWith("/" + l))!;
        const c = state.controls[path];
        const canvas = inner.canvas, r = canvas.getBoundingClientRect(), s = r.width / canvas.offsetWidth;
        const controler = module.moduleControles.find((k: any) => k.itemParam.address == path);
        return {
            path, x: r.left + (c.x * inner.renderScale + inner.renderOffsetX) * s, y: r.top + (c.y * inner.renderScale + inner.renderOffsetY) * s,
            value: parseFloat(controler.value), orbit: inner.paramValues[path] as number,
        };
    }, [id, label] as [string, string]);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
    await page.mouse.up();
}

describe("the Orbit interface of a module", () => {
    it("◎ shows it in place of the classic interface, and back; no ◎ for a module without settings", async () => {
        const { context, page, errors } = await open();
        const vcf = await add(page, "modular/VCF.dsp", 400, 120);
        const sel = await containerOf(page, vcf);
        await page.locator(sel + " .orbit-toggle").click();
        await page.waitForSelector(sel + ".orbit-mode .orbit-frame");
        expect(await page.locator(sel + " > .content").isVisible()).toBe(false);
        expect(await page.evaluate((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).view, vcf)).toEqual({ orbit: { width: 360, height: 360 } });
        // the widgets of the module, as points
        const labels = await page.evaluate((m) => Object.values((globalThis as any).faustPlayground.scene.getModuleById(m).orbit.orbit.inner.getOrbitState().controls).map((c: any) => c.label), vcf);
        expect(labels.sort()).toEqual(["Cutoff", "Mode", "Pitch", "Resonance"]);
        await page.locator(sel + " .orbit-toggle").click();
        expect(await page.locator(sel + " .orbit-frame").count()).toBe(0);
        expect(await page.locator(sel + " > .content").isVisible()).toBe(true);
        // a module whose code has no setting
        const plain = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            await app.compileFaust({ name: "Thru", sourceCode: "process = _;", x: 100, y: 500, callback: (f: any) => app.createModule(f, "Thru", "process = _;", 100, 500) });
            while (scene.getModules().length < 2) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[1].moduleId;
        });
        expect(await page.locator(await containerOf(page, plain) + " .orbit-toggle").isVisible()).toBe(false);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("a gesture moves its point under the pointer at every zoom of the stage, and sets the value as a slider does", async () => {
        const { context, page, errors } = await open();
        const vcf = await add(page, "modular/VCF.dsp", 300, 100);
        await page.locator(await containerOf(page, vcf) + " .orbit-toggle").click();
        for (const zoom of [1, 0.75, 1.5]) {
            await page.evaluate((z) => (globalThis as any).faustPlayground.scene.setView(z, 0, 0), zoom);
            await page.waitForTimeout(300);
            const before = await point(page, vcf, "Resonance");
            await drag(page, before, 25, -15);
            await page.waitForTimeout(200);
            const after = await point(page, vcf, "Resonance");
            expect(after.x - before.x, `zoom ${zoom}`).toBeCloseTo(25, 0);
            expect(after.y - before.y, `zoom ${zoom}`).toBeCloseTo(-15, 0);
            expect(after.value, `zoom ${zoom}`).not.toBe(before.value);
            expect(after.orbit, `zoom ${zoom}`).toBeCloseTo(after.value, 6);
        }
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("undo and redo: the values pushed back into it, its showing undone", async () => {
        const { context, page, errors } = await open();
        const vcf = await add(page, "modular/VCF.dsp", 300, 100);
        const sel = await containerOf(page, vcf);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        await page.locator(sel + " .orbit-toggle").click();
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        const before = await point(page, vcf, "Cutoff");
        await drag(page, before, -40, 30);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        const moved = await point(page, vcf, "Cutoff");
        expect(moved.value).not.toBe(before.value);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await page.waitForFunction(([m, v]) => parseFloat((globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => c.itemParam.label == "Cutoff").value) == v, [vcf, before.value] as [string, number]);
        const undone = await point(page, vcf, "Cutoff");
        expect(undone.orbit).toBeCloseTo(before.value, 6);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.redo());
        await page.waitForFunction(([m, v]) => parseFloat((globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => c.itemParam.label == "Cutoff").value) == v, [vcf, moved.value] as [string, number]);
        expect((await point(page, vcf, "Cutoff")).orbit).toBeCloseTo(moved.value, 6);
        // the Orbit shown: undone, the classic interface back
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await page.waitForFunction((s) => !document.querySelector(s + ".orbit-mode"), sel);
        expect(await page.locator(sel + " > .content").isVisible()).toBe(true);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("saved with the document: shown again after a reload, with its size and the layout of its points", async () => {
        const { context, page, errors } = await open();
        const vcf = await add(page, "modular/VCF.dsp", 300, 100);
        const sel = await containerOf(page, vcf);
        await page.locator(sel + " .orbit-toggle").click();
        // larger, by its grip
        const grip = (await page.locator(sel + " .orbit-grip").boundingBox())!;
        await drag(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, 80, 40);
        const before = await point(page, vcf, "Pitch");
        await drag(page, before, 20, 20);
        const saved = await point(page, vcf, "Pitch");
        const size = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).orbitSettings(), vcf);
        expect(size.width).toBe(440);
        expect(size.height).toBe(400);
        await page.evaluate(async () => {
            const { scene, documents } = (globalThis as any).faustPlayground;
            scene.history.flush();
            await documents.flush();
        });
        await page.close();
        const { page: again } = await open(context);
        await again.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules()[0]?.orbit, null, { timeout: 60_000 });
        const id = await again.evaluate(() => (globalThis as any).faustPlayground.scene.getModules()[0].moduleId);
        const settings = await again.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).orbitSettings(), id);
        expect([settings.width, settings.height]).toEqual([440, 400]);
        const restored = await point(again, id, "Pitch");
        expect(restored.value).toBeCloseTo(saved.value, 6);
        expect(restored.orbit).toBeCloseTo(saved.value, 6);
        const st = await again.evaluate(([m, p]) => (globalThis as any).faustPlayground.scene.getModuleById(m).orbit.orbit.inner.getOrbitState().controls[p], [id, saved.path]);
        const old = size.state.controls[saved.path];
        expect(st.x).toBeCloseTo(old.x, 3);
        expect(st.y).toBeCloseTo(old.y, 3);
        expect(errors).toEqual([]);
        await context.close();
    }, 180_000);

    it("a cable dropped on one of its points modulates that widget; the modulation ports in a column under the title", async () => {
        const { context, page, errors } = await open();
        const lfo = await add(page, "modular/LFO.dsp", 60, 120);
        const vcf = await add(page, "modular/VCF.dsp", 520, 120);
        const sel = await containerOf(page, vcf);
        await page.locator(sel + " .orbit-toggle").click();
        await page.waitForTimeout(300);
        const target = await point(page, vcf, "Cutoff");
        const port = (await page.locator(`.port[data-module="${lfo}"][data-dir="out"][data-port="0"]`).boundingBox())!;
        await drag(page, { x: port.x + port.width / 2, y: port.y + port.height / 2 }, target.x - port.x - port.width / 2, target.y - port.y - port.height / 2);
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).modulations.length == 1, vcf, { timeout: 30_000 });
        const modulation = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).modulations[0], vcf);
        expect(modulation.widget).toBe(target.path);
        expect(modulation.spec.mode).toBe("modulate");
        // still in the Orbit after the recompilation, its port on the left edge, under the title
        await page.waitForSelector(sel + ".orbit-mode .orbit-frame");
        const box = (await page.locator(sel).boundingBox())!;
        const title = (await page.locator(sel + " h6").boundingBox())!;
        const p = (await page.locator(sel + " .modulation-port").boundingBox())!;
        expect(p.x + p.width / 2).toBeCloseTo(box.x, -1);
        expect(p.y).toBeGreaterThan(title.y + title.height);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("its dropdowns under their button at a zoom of the stage; its keys (Delete) do not delete the module", async () => {
        const { context, page, errors } = await open();
        const vcf = await add(page, "modular/VCF.dsp", 300, 100);
        const sel = await containerOf(page, vcf);
        await page.locator(sel + " .orbit-toggle").click();
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.setView(1.5, 0, 0));
        await page.waitForTimeout(300);
        // the zoom selector of the Orbit (a select whose menu is the dropdown of the library), then its menu
        const [button, menu] = await page.evaluate(async (s) => {
            const shadow = document.querySelector(s + " .orbit-host")!.shadowRoot!;
            const select = shadow.querySelector("select.orbit-zoom") as HTMLElement;
            select.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            await new Promise((r) => setTimeout(r, 300));
            const m = shadow.querySelector(".orbit-dropdown-menu") as HTMLElement | null;
            const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, bottom: r.bottom, top: r.top }; };
            return [rect(select), m ? rect(m) : null];
        }, sel);
        expect(menu).not.toBeNull();
        expect(Math.abs(menu!.left - button.left)).toBeLessThan(3);
        expect(menu!.top - button.bottom).toBeGreaterThan(0);
        expect(menu!.top - button.bottom).toBeLessThan(12);
        await page.keyboard.press("Escape");
        // Delete typed in the Orbit (its presets), the module selected
        await page.evaluate((m) => (globalThis as any).faustPlayground.scene.patchView.select([m]), vcf);
        await page.evaluate((s) => (document.querySelector(s + " .orbit-host") as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, composed: true })), sel);
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().length)).toBe(1);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
