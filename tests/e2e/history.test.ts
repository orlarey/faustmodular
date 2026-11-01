// Undo and redo of every change of the scene (src/Scenes/History.ts, Scene.restoreSnapshot), and the
// selection of several modules moved together (PatchView).
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
    browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

async function openWithPatch(): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => (globalThis as any).faustmodular?.documents?.current, null, { timeout: 60_000 });
    // 2 SOscillator -> 1 Echo -> 3 Volume (2x2) -> output
    const json = await page.evaluate(async () => (await fetch("/tests/fixtures/v1/patch_light.json")).text());
    await page.evaluate((j) => (globalThis as any).faustmodular.scene.recallScene(j), json);
    return { page, errors };
}

// The state compared by the tests: modules (id, name, position, parameters, modulations) and connections.
const state = (page: Page) => page.evaluate(async () => {
    const s = (globalThis as any).faustmodular.scene;
    await s.history.flush();
    return JSON.parse(await s.captureSnapshot());
});
const flush = (page: Page) => page.evaluate(() => (globalThis as any).faustmodular.scene.history.flush());
const undo = (page: Page) => page.evaluate(() => (globalThis as any).faustmodular.scene.undo());
const redo = (page: Page) => page.evaluate(() => (globalThis as any).faustmodular.scene.redo());

describe("undo and redo", () => {
    it("undoes and redoes connections, parameter values, positions and module removals", async () => {
        const { page, errors } = await openWithPatch();
        const initial = await state(page);
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.history.canUndo())).toBe(false);

        // a disconnection
        await page.evaluate(() => { const s = (globalThis as any).faustmodular.scene; s.patch.disconnect(s.patch.getConnections()[0].id); });
        await flush(page);
        const disconnected = await state(page);
        expect(disconnected.connections.length).toBe(initial.connections.length - 1);
        await undo(page);
        expect(await state(page)).toEqual(initial);
        await redo(page);
        expect(await state(page)).toEqual(disconnected);
        await undo(page);

        // a slider moved through the interface: several input events make one step
        await page.evaluate(() => {
            const c = (globalThis as any).faustmodular.scene.getModuleById("3").moduleControles[0];
            for (const v of ["10", "40", "70"]) {
                c.faustInterfaceView.slider.value = v;
                c.faustInterfaceView.slider.dispatchEvent(new Event("input"));
            }
        });
        const moved = await state(page);
        expect(moved).not.toEqual(initial);
        await undo(page);
        expect(await state(page)).toEqual(initial);
        await redo(page);
        expect(await state(page)).toEqual(moved);
        await undo(page);

        // a module removed: undo creates it again, with its id, parameters and connections
        await page.evaluate(() => (globalThis as any).faustmodular.scene.getModuleById("1").deleteModule());
        await flush(page);
        expect((await state(page)).modules.map((m: any) => m.id)).toEqual(["2", "3"]);
        await undo(page);
        expect(await state(page)).toEqual(initial);
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.audioGraph.getWireCount().wires)).toBe(initial.connections.length);
        expect(await page.locator("#svgCanvas path.cable").count()).toBe(initial.connections.length);

        // a new change after an undo clears the redo list
        await page.evaluate(() => (globalThis as any).faustmodular.scene.patch.updateModule("2", { x: 40, y: 40 }));
        await flush(page);
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.history.canRedo())).toBe(false);
        expect(errors).toEqual([]);
        await page.close();
    }, 180_000);

    it("undoes and redoes a widget modulation and its depth, with Ctrl-Z and Ctrl-Shift-Z", async () => {
        const { page, errors } = await openWithPatch();
        const initial = await state(page);
        // the oscillator (2) modulates the level of the Volume module (3)
        await page.evaluate(async () => {
            const s = (globalThis as any).faustmodular.scene;
            const widget = s.widgetsOf(s.getModuleById("3")).find((w: any) => w.type.endsWith("slider")).address;
            await s.modulate({ module: "2", port: 0 }, "3", widget, "modulate");
        });
        await flush(page);
        const modulated = await state(page);
        expect(modulated.modules.find((m: any) => m.id == "3").modulations).toHaveLength(1);
        // the depth, set as the modulation port does
        await page.evaluate(() => {
            const s = (globalThis as any).faustmodular.scene;
            s.setDepth("3", s.patch.getModule("3").modulations[0].id, -0.4);
        });
        const deep = await state(page);
        expect(deep).not.toEqual(modulated);

        await page.mouse.click(5, 300);                      // the stage has the focus
        await page.keyboard.press("Control+z");             // depth
        await page.waitForFunction(() => !(globalThis as any).faustmodular.scene.history.restoring);
        expect(await state(page)).toEqual(modulated);
        await page.keyboard.press("Control+z");             // modulation
        await page.waitForFunction((n) => (globalThis as any).faustmodular.scene.getModuleById("3").moduleFaust.getDSP().getNumInputs() == n, initial.modules.find((m: any) => m.id == "3").numInputs);
        expect(await state(page)).toEqual(initial);
        await page.keyboard.press("Control+Shift+z");
        await page.keyboard.press("Control+Shift+z");
        await page.waitForFunction(() => (globalThis as any).faustmodular.scene.patch.getModule("3").modulations.length == 1);
        await flush(page);
        await page.waitForFunction(() => !(globalThis as any).faustmodular.scene.history.restoring);
        expect(await state(page)).toEqual(deep);
        expect(await page.locator(".modulation-port").count()).toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 180_000);
});

describe("selection", () => {
    const center = async (page: Page, id: string) => {
        const box = (await page.locator(`#${await page.evaluate((m) => (globalThis as any).faustmodular.scene.getModuleById(m).moduleView.fModuleContainer.id, id)} h6`).boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const position = (page: Page, id: string) => page.evaluate((m) => { const v = (globalThis as any).faustmodular.scene.getModuleById(m).moduleView; return [v.x, v.y]; }, id);

    it("moves the selected modules together (Shift-click, rectangle), in one undo step", async () => {
        const { page, errors } = await openWithPatch();
        const [p1, p2, p3] = [await position(page, "1"), await position(page, "2"), await position(page, "3")];
        // Shift-click selects 1 and 2
        const c1 = await center(page, "1"), c2 = await center(page, "2");
        await page.mouse.click(c1.x, c1.y);
        await page.keyboard.down("Shift");
        await page.mouse.click(c2.x, c2.y);
        await page.keyboard.up("Shift");
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.patchView.getSelection().sort())).toEqual(["1", "2"]);
        // dragging one of them moves both
        await page.mouse.move(c1.x, c1.y);
        await page.mouse.down();
        await page.mouse.move(c1.x + 40, c1.y + 30, { steps: 5 });
        await page.mouse.up();
        expect(await position(page, "1")).toEqual([p1[0] + 40, p1[1] + 30]);
        expect(await position(page, "2")).toEqual([p2[0] + 40, p2[1] + 30]);
        expect(await position(page, "3")).toEqual(p3);
        // one undo step brings both back
        await flush(page);
        await undo(page);
        expect([await position(page, "1"), await position(page, "2")]).toEqual([p1, p2]);

        // a click on the stage clears the selection; a rectangle selects what it touches
        await page.mouse.click(700, 860);
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.patchView.getSelection())).toEqual([]);
        const box = (await page.locator(`#${await page.evaluate(() => (globalThis as any).faustmodular.scene.getModuleById("3").moduleView.fModuleContainer.id)}`).boundingBox())!;
        await page.mouse.move(box.x - 20, box.y - 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 10, box.y + 10, { steps: 4 });
        expect(await page.locator(".selection-band").count()).toBe(1);
        await page.mouse.up();
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.patchView.getSelection())).toEqual(["3"]);
        expect(await page.locator(".moduleFaust.selected").count()).toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
