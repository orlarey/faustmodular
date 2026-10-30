// End-to-end tests of the application in Chromium (Playwright), served by a Vite dev server.
// Fake microphone and autoplay flags let the page run without user interaction.
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
    browser = await chromium.launch({
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

interface PageState {
    modules: string[];          // "id:name:inputsxoutputs" of the Faust modules
    connections: string[];      // "from:port>to:port"
    wires: number;              // connections wired in Web Audio
    paths: number;              // connectors drawn
}

async function openApp(): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.scene, null, { timeout: 60_000 });
    return { page, errors };
}

function state(page: Page): Promise<PageState> {
    return page.evaluate(() => {
        const s = (globalThis as any).faustPlayground.scene;
        return {
            modules: s.patch.getModules().filter((m: any) => m.kind == "faust").map((m: any) => `${m.id}:${m.name}:${m.numInputs}x${m.numOutputs}`),
            connections: s.patch.getConnections().map((c: any) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`).sort(),
            wires: s.audioGraph.getWireCount().wires,
            paths: document.querySelectorAll("#svgCanvas path").length,
        };
    });
}

async function loadExample(page: Page, file: string): Promise<void> {
    const json = await page.evaluate(async (f) => (await fetch("json/" + f)).text(), file);
    await page.evaluate((j) => (globalThis as any).faustPlayground.scene.recallScene(j), json);
}

const cleanScene = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.app.menu.cleanScene(() => { }));

describe("application", () => {
    it("starts with stereo physical input and output modules", async () => {
        const { page, errors } = await openApp();
        const io = await page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.getModules().map((m: any) => `${m.kind}:${m.numInputs}x${m.numOutputs}`));
        expect(io).toEqual(["output:2x0", "input:0x2"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("loads a v1 example with bus connections and produces sound", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "Small_Exemple.json");
        expect(await state(page)).toEqual({
            modules: ["1:SAtonalSoftHarp:0x1", "2:Freeverb:1x1"],
            connections: ["1:0>2:0", "2:0>output:0", "2:0>output:1"],
            wires: 3,
            paths: 2,
        });
        // RMS of the reverb output (the harp plays by itself)
        const rms = await page.evaluate(async () => {
            const s = (globalThis as any).faustPlayground.scene;
            const node = s.audioGraph.getNode(s.getModules()[1].moduleId);
            await node.context.resume();
            const analyser = node.context.createAnalyser();
            node.connect(analyser);
            await new Promise((r) => setTimeout(r, 1500));
            const buffer = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(buffer);
            return Math.sqrt(buffer.reduce((a, x) => a + x * x, 0) / buffer.length);
        });
        expect(rms).toBeGreaterThan(1e-4);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("saves as v2 and reloads the same patch (with precompiled factories)", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "Big_Exemple_Precompile.json");
        const before = await state(page);
        expect(before.modules).toHaveLength(6);
        expect(before.wires).toBe(9);
        const saved = await page.evaluate(() => (globalThis as any).faustPlayground.scene.saveScene(true));
        expect(JSON.parse(saved)).toMatchObject({ format: "faustplayground-patch", version: 2 });
        await cleanScene(page);
        expect(await state(page)).toEqual({ modules: [], connections: [], wires: 0, paths: 0 });
        await page.evaluate((j) => (globalThis as any).faustPlayground.scene.recallScene(j), saved);
        const after = await state(page);
        // same patch up to the renumbering of the modules (1..6 -> 7..12)
        const shift = (s: string) => s.replace(/(^|>)(\d+)(?=:)/g, (_, p, n) => p + (Number(n) - 6));
        expect(after.modules.map(shift)).toEqual(before.modules);
        expect(after.connections.map(shift).sort()).toEqual(before.connections);
        expect(after.wires).toBe(9);
        expect(after.paths).toBe(6);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("drops the modules that no longer compile, with a warning", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_big.json");
        const s = await state(page);
        expect(s.modules.map((m) => m.split(":")[1])).toEqual(["Kisana", "SBird", "CombFilter", "Echo", "Flanger", "Freeverb"]);
        const shown = await page.evaluate(() => document.getElementById("dialogue")!.textContent);
        expect(shown).toMatch(/module 2 \(SAtonalSoftHarp\) could not be created/);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("deletes a connector by click and recreates it by mouse drag", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");   // SOscillator -> Echo -> Volume (2x2) -> output
        const all = ["1:0>3:0", "1:0>3:1", "2:0>1:0", "3:0>output:0", "3:1>output:1"];
        expect((await state(page)).connections).toEqual(all);
        const volume = await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            const m = s.getModules().find((m: any) => m.moduleFaust.getName() == "Volume");
            const shape = m.moduleFaust.getOutputConnections()[0].connectorShape;
            const p = shape.getPointAtLength(shape.getTotalLength() / 2);
            return { id: m.moduleView.fModuleContainer.id, x: p.x - scrollX, y: p.y - scrollY };
        });
        await page.mouse.click(volume.x, volume.y);
        expect(await state(page)).toMatchObject({ connections: ["1:0>3:0", "1:0>3:1", "2:0>1:0"], wires: 3, paths: 2 });

        const from = (await page.locator(`#${volume.id} .node-output`).boundingBox())!;
        const to = (await page.locator("#moduleOutput .node-input").boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
        await page.mouse.up();
        expect(await state(page)).toMatchObject({ connections: all, wires: 5, paths: 3 });
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("rewires a recompiled module with its new number of ports, and removes deleted modules", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");
        await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            s.getModules().find((m: any) => m.moduleFaust.getName() == "Echo").update("Echo", "process = _ <: _, *(0.5);");
        });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.patch.getModule("1").numOutputs == 2, null, { timeout: 30_000 });
        expect(await state(page)).toMatchObject({
            modules: ["1:Echo:1x2", "2:SOscillator:0x1", "3:Volume:2x2"],
            connections: ["1:0>3:0", "1:1>3:1", "2:0>1:0", "3:0>output:0", "3:1>output:1"],
            wires: 5,
        });
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().find((m: any) => m.moduleFaust.getName() == "Volume").deleteModule());
        expect(await state(page)).toEqual({ modules: ["1:Echo:1x2", "2:SOscillator:0x1"], connections: ["2:0>1:0"], wires: 1, paths: 1 });
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
