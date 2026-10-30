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

async function openApp(options: { hasTouch?: boolean } = {}): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, hasTouch: options.hasTouch });
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

interface Point {
    x: number;
    y: number;
}

const portSelector = (module: string, dir: "in" | "out", port: number) => `.port[data-module="${module}"][data-dir="${dir}"][data-port="${port}"]`;

async function centerOf(page: Page, selector: string): Promise<Point> {
    const box = (await page.locator(selector).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// A point of the title of a module: its body, away from ports and controls.
async function bodyOf(page: Page, module: string): Promise<Point> {
    const id = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, module);
    return centerOf(page, `#${id} h6`);
}

async function mouseDrag(page: Page, from: Point, to: Point): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
}

// Mid point of the cable of a connection, in viewport coordinates.
function cableMiddle(page: Page, connection: string): Promise<Point> {
    return page.evaluate((key) => {
        const s = (globalThis as any).faustPlayground.scene;
        const c = s.patch.getConnections().find((c: any) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}` == key);
        const path = s.patchView.getCable(c.id);
        const p = path.getPointAtLength(path.getTotalLength() / 2);
        const svg = path.ownerSVGElement.getBoundingClientRect();
        return { x: p.x + svg.left, y: p.y + svg.top };
    }, connection);
}

// Largest distance between the ends of the cables and the centers of their ports, in pixels.
function cableMisalignment(page: Page): Promise<number> {
    return page.evaluate(() => {
        const s = (globalThis as any).faustPlayground.scene;
        let worst = 0;
        for (const c of s.patch.getConnections()) {
            const path = s.patchView.getCable(c.id);
            const svg = path.ownerSVGElement.getBoundingClientRect();
            const ends = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())];
            const ports = [s.getModuleById(c.from.module).moduleView.getPort("out", c.from.port), s.getModuleById(c.to.module).moduleView.getPort("in", c.to.port)];
            ports.forEach((port: HTMLElement, i: number) => {
                const r = port.getBoundingClientRect();
                worst = Math.max(worst, Math.hypot(r.left + r.width / 2 - svg.left - ends[i].x, r.top + r.height / 2 - svg.top - ends[i].y));
            });
        }
        return worst;
    });
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
            paths: 3,
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
        expect(after.paths).toBe(9);
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

    it("draws one cable per connection, attached to its ports, and follows a moved module", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");   // 2 SOscillator -> 1 Echo -> 3 Volume (2x2) -> output
        expect(await state(page)).toEqual({
            modules: ["1:Echo:1x1", "2:SOscillator:0x1", "3:Volume:2x2"],
            connections: ["1:0>3:0", "1:0>3:1", "2:0>1:0", "3:0>output:0", "3:1>output:1"],
            wires: 5,
            paths: 5,
        });
        expect(await cableMisalignment(page)).toBeLessThan(1);

        const body = await bodyOf(page, "3");
        const before = await page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.getModule("3"));
        await mouseDrag(page, body, { x: body.x + 100, y: body.y + 60 });
        const after = await page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.getModule("3"));
        expect([after.x - before.x, after.y - before.y]).toEqual([100, 60]);
        expect(await cableMisalignment(page)).toBeLessThan(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("connects port to port in both directions and deletes a cable by click", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");
        await page.mouse.click(...Object.values(await cableMiddle(page, "3:1>output:1")) as [number, number]);
        expect((await state(page)).connections).toEqual(["1:0>3:0", "1:0>3:1", "2:0>1:0", "3:0>output:0"]);

        // output port -> input port
        await mouseDrag(page, await centerOf(page, portSelector("3", "out", 1)), await centerOf(page, portSelector("output", "in", 1)));
        // input port -> output port: a cross connection Volume:2 -> output:1 drawn from the output side
        await mouseDrag(page, await centerOf(page, portSelector("output", "in", 0)), await centerOf(page, portSelector("3", "out", 1)));
        expect(await state(page)).toMatchObject({
            connections: ["1:0>3:0", "1:0>3:1", "2:0>1:0", "3:0>output:0", "3:1>output:0", "3:1>output:1"],
            wires: 6,
            paths: 6,
        });
        expect(await page.locator(".cable.dragging").count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("makes a bus connection when a cable is dropped on a module body, and ignores invalid drops", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");
        const oscillator = await centerOf(page, portSelector("2", "out", 0));
        // same direction, empty canvas, own body: nothing
        await mouseDrag(page, oscillator, await centerOf(page, portSelector("3", "out", 0)));
        await mouseDrag(page, oscillator, { x: 700, y: 750 });
        await mouseDrag(page, oscillator, await bodyOf(page, "2"));
        expect((await state(page)).connections).toHaveLength(5);
        // on the body of the 2-input Volume: 1 -> 2 bus, output 0 to inputs 0 and 1
        await mouseDrag(page, oscillator, await bodyOf(page, "3"));
        expect((await state(page)).connections).toEqual(["1:0>3:0", "1:0>3:1", "2:0>1:0", "2:0>3:0", "2:0>3:1", "3:0>output:0", "3:1>output:1"]);
        expect(await page.locator(".cable.dragging, .port-target, .bus-target").count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("dashes the cables that close a cycle (delayed in the audio graph)", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");
        await mouseDrag(page, await centerOf(page, portSelector("3", "out", 0)), await centerOf(page, portSelector("1", "in", 0)));
        const feedback = await page.evaluate(() => Array.from(document.querySelectorAll(".cable.feedback")).map((p) => (p as SVGElement).dataset.connection));
        const id = await page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.getConnections().find((c: any) => c.from.module == "3" && c.to.module == "1").id);
        expect(feedback).toEqual([id]);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.audioGraph.getWireCount())).toEqual({ wires: 6, delayed: 1 });
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("draws two cables at once with two fingers", async () => {
        const { page, errors } = await openApp({ hasTouch: true });
        await loadExample(page, "patch_light.json");
        await cleanScene(page);
        await page.evaluate(async () => {
            const app = (globalThis as any).faustPlayground.app;
            for (const [name, x] of [["A", 400], ["B", 800]]) {
                const code = "process = 1, 2;";
                await app.compileFaust({ name, sourceCode: code, x, y: 300, callback: (f: any) => app.createModule(f, name, code, x, 300) });
            }
        });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 2);
        const a = await page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules()[0].moduleId);
        const from = [await centerOf(page, portSelector(a, "out", 0)), await centerOf(page, portSelector(a, "out", 1))];
        const to = [await centerOf(page, portSelector("output", "in", 1)), await centerOf(page, portSelector("output", "in", 0))];
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: "touchStart" | "touchMove", points: Point[]) => cdp.send("Input.dispatchTouchEvent", {
            type, touchPoints: points.map((p, id) => ({ x: Math.round(p.x), y: Math.round(p.y), id })),
        });
        await touch("touchStart", from);
        for (let k = 1; k <= 10; k++) {
            await touch("touchMove", from.map((f, i) => ({ x: f.x + (to[i].x - f.x) * k / 10, y: f.y + (to[i].y - f.y) * k / 10 })));
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        expect((await state(page)).connections).toEqual([`${a}:0>output:1`, `${a}:1>output:0`]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("exports compilable Faust code without modifying the patch", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");
        // an unconnected module: left out of the export, and the patch must not change
        await page.evaluate(async () => {
            const app = (globalThis as any).faustPlayground.app;
            const code = "process = 0.1;";
            await app.compileFaust({ name: "C", sourceCode: code, x: 500, y: 600, callback: (f: any) => app.createModule(f, "C", code, 500, 600) });
        });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 4);
        const before = await state(page);
        // as a string: Vitest would rewrite a dynamic import() inside a function
        const result = await page.evaluate(`(async () => {
            const { exportFaust, unexportedModules } = await import("/src/export/FaustExporter.ts");
            const s = globalThis.faustPlayground.scene;
            s.updatePatchFromModules(false);
            const results = [];
            for (const forceStereo of [false, true]) {
                const exported = exportFaust(s.patch, { name: "Exported", forceStereo });
                let json = null;
                await globalThis.faustPlayground.app.compileFaust({ name: "X", sourceCode: exported.code, x: 0, y: 0, callback: (f) => { json = JSON.parse(f.json); } });
                results.push({ declared: [exported.inputs, exported.outputs], compiled: json && [json.inputs, json.outputs] });
            }
            return { results, left: unexportedModules(s.patch).map((m) => m.name) };
        })()`);
        // the microphone is not used: no input
        expect(result).toEqual({ results: [{ declared: [0, 2], compiled: [0, 2] }, { declared: [0, 2], compiled: [0, 2] }], left: ["C"] });
        expect(await state(page)).toEqual(before);
        expect(await page.locator("#checkBoxStereoExport").count()).toBe(1);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("lets a finger move a slider without moving its module", async () => {
        const { page, errors } = await openApp({ hasTouch: true });
        await loadExample(page, "patch_light.json");
        const read = () => page.evaluate(() => {
            const m = (globalThis as any).faustPlayground.scene.getModuleById("3");
            return { left: m.moduleView.fModuleContainer.style.left, volume: m.moduleFaust.getDSP().getParamValue(m.moduleControles[0].itemParam.address) };
        });
        const before = await read();
        const slider = await page.evaluate(() => {
            const r = (globalThis as any).faustPlayground.scene.getModuleById("3").moduleView.fModuleContainer.querySelector("input[type=range]").getBoundingClientRect();
            return { x: r.left, y: r.top + r.height / 2, width: r.width };
        });
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: "touchStart" | "touchMove", x: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x: Math.round(x), y: Math.round(slider.y), id: 0 }] });
        await touch("touchStart", slider.x + slider.width * 0.75);
        for (let k = 1; k <= 10; k++) await touch("touchMove", slider.x + slider.width * (0.75 - k * 0.05));
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        const after = await read();
        expect(after.left).toBe(before.left);
        expect(before.volume).toBeCloseTo(0.75);
        expect(after.volume).toBeLessThan(0.5);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("keeps the connections of a recompiled module whose ports still exist, and removes the others", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");
        // Echo 1x1 -> 1x2: its connections are kept
        await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            s.getModules().find((m: any) => m.moduleFaust.getName() == "Echo").update("Echo", "process = _ <: _, *(0.5);");
        });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.patch.getModule("1").numOutputs == 2, null, { timeout: 30_000 });
        expect(await state(page)).toMatchObject({
            modules: ["1:Echo:1x2", "2:SOscillator:0x1", "3:Volume:2x2"],
            connections: ["1:0>3:0", "1:0>3:1", "2:0>1:0", "3:0>output:0", "3:1>output:1"],
            wires: 5,
            paths: 5,
        });
        // Volume 2x2 -> 1x1: the connections of its second input and output are removed, with a message
        await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            s.getModules().find((m: any) => m.moduleFaust.getName() == "Volume").update("Volume", "process = *(0.5);");
        });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.patch.getModule("3").numOutputs == 1, null, { timeout: 30_000 });
        expect(await state(page)).toMatchObject({ connections: ["1:0>3:0", "2:0>1:0", "3:0>output:0"], wires: 3, paths: 3 });
        expect(await page.evaluate(() => document.getElementById("dialogue")!.textContent)).toMatch(/2 connection/);
        expect(await cableMisalignment(page)).toBeLessThan(1);

        await page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().find((m: any) => m.moduleFaust.getName() == "Volume").deleteModule());
        expect(await state(page)).toEqual({ modules: ["1:Echo:1x2", "2:SOscillator:0x1"], connections: ["2:0>1:0"], wires: 1, paths: 1 });
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
