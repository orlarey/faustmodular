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

// Loads a version 1 patch of tests/fixtures/v1/ (served by Vite, like the application).
async function loadExample(page: Page, file: string): Promise<void> {
    const json = await page.evaluate(async (f) => (await fetch("/tests/fixtures/v1/" + f)).text(), file);
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

    it("opens every example of the Load menu (version 2 files)", async () => {
        const fs = await import("fs");
        for (const [anchor, file] of [["aLightExemple", "Small_Exemple"], ["aLightPreExemple", "Small_Exemple_Precompile"],
            ["aBigExemple", "Big_Exemple"], ["aBigPreExemple", "Big_Exemple_Precompile"], ["aMultichannelExemple", "Multichannel_Example"],
            ["aModulationExemple", "Modulation_Example"]]) {
            const saved = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/json", file + ".json"), "utf8"));
            const { page, errors } = await openApp();
            await page.locator("#loadButtonMenu").click();
            await page.locator("#" + anchor).click();
            const faust = saved.modules.filter((m: any) => m.kind == "faust");
            await page.waitForFunction((n) => (globalThis as any).faustPlayground.scene.getModules().length == n, faust.length, { timeout: 60_000 });
            await page.waitForFunction(() => document.getElementById("loadingPage")!.style.visibility == "hidden");
            const s = await state(page);
            expect(s.modules, file).toEqual(faust.map((m: any) => `${m.id}:${m.name}:${m.inputs}x${m.outputs}`));
            expect(s.connections, file).toEqual(saved.connections.map((c: any) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`).sort());
            expect(s.wires, file).toBe(saved.connections.length);
            if (file == "Modulation_Example") {
                // the modulations are recalled (modules compiled with their effective code)
                const modulated = await page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.getModules()
                    .flatMap((m: any) => m.modulations.map((x: any) => `${m.name}:${x.spec.mode}${x.spec.exponential ? ":exp" : ""}`)));
                expect(modulated).toEqual(["SOscillator:modulate:exp", "Volume:scale"]);
                expect(await page.locator(".cable.modulation").count()).toBe(2);
                // the depth rows stay hidden after a recall (shown on the ports)
                expect(await page.evaluate(() => Array.from(document.querySelectorAll(".widget.modulation-depth"))
                    .map((e) => getComputedStyle(e).display))).toEqual(["none"]);
                expect(await page.locator(".modulation-port").count()).toBe(2);
            }
            if (file == "Multichannel_Example") {
                // sound out of the stereo mixer and of the 4 echoes
                const rms = await page.evaluate(async () => {
                    const scene = (globalThis as any).faustPlayground.scene;
                    const context = scene.audioGraph.getNode("output").context;
                    await context.resume();
                    const analysers = ["2", "3"].map((id) => {
                        const analyser = context.createAnalyser();
                        scene.audioGraph.getNode(id).connect(analyser);
                        return analyser;
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                    return analysers.map((a: AnalyserNode) => {
                        const buffer = new Float32Array(a.fftSize);
                        a.getFloatTimeDomainData(buffer);
                        return Math.sqrt(buffer.reduce((sum, x) => sum + x * x, 0) / buffer.length);
                    });
                });
                rms.forEach((r: number) => expect(r).toBeGreaterThan(1e-3));
            }
            expect(errors, file).toEqual([]);
            await page.close();
        }
    }, 300_000);

    it("opens a patch in place of the current scene, and keeps the scene when the file cannot be read", async () => {
        const { page, errors } = await openApp();
        await loadExample(page, "patch_light.json");
        // a direct connection between the physical input and output must go too
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.connect({ module: "input", port: 0 }, { module: "output", port: 0 }));
        const file = await page.evaluate(async () => (await fetch("/json/Modulation_Example.json")).text());
        await page.evaluate((j) => (globalThis as any).faustPlayground.scene.recallScene(j), file);
        const saved = JSON.parse(file);
        const opened = await state(page);
        expect(opened.modules.map((m) => m.split(":")[1])).toEqual(saved.modules.filter((m: any) => m.kind == "faust").map((m: any) => m.name));
        expect(opened.connections).toHaveLength(saved.connections.length);
        expect(opened.connections.some((c) => c.startsWith("input:"))).toBe(false);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.sceneName)).toBe("Modulation_Example");
        // unreadable files: the scene stays as it is
        for (const bad of ["{ not json", JSON.stringify({ format: "faustplayground-patch", version: 2, modules: "broken" })]) {
            await page.evaluate((j) => (globalThis as any).faustPlayground.scene.recallScene(j), bad);
            expect(await state(page)).toEqual(opened);
        }
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
        // audio ports astride the bottom edge of their module, inputs on the left, outputs on the right
        const ports = await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            const box = s.getModuleById("3").moduleView.fModuleContainer.getBoundingClientRect();
            return Array.from(document.querySelectorAll('.port[data-module="3"]')).map((p) => {
                const r = p.getBoundingClientRect();
                return { dir: (p as HTMLElement).dataset.dir, dy: r.top + r.height / 2 - box.bottom, x: r.left + r.width / 2 - box.left, width: box.width };
            });
        });
        ports.forEach((p: any) => expect(Math.abs(p.dy)).toBeLessThan(2));
        expect(ports.filter((p: any) => p.dir == "in").every((p: any) => p.x < ports[0].width / 2)).toBe(true);
        expect(ports.filter((p: any) => p.dir == "out").every((p: any) => p.x > ports[0].width / 2)).toBe(true);

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
            const slider = m.moduleView.fModuleContainer.querySelector("input[type=range]") as HTMLInputElement;
            const r = slider.getBoundingClientRect();
            return {
                left: m.moduleView.fModuleContainer.style.left,
                fraction: (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min)),
                volume: m.moduleFaust.getDSP().getParamValue(m.moduleControles[0].itemParam.address),
                x: r.left, y: r.top + r.height / 2, width: r.width,
            };
        });
        const before = await read();
        expect(before.volume).toBeCloseTo(0.75);
        // the finger starts on the thumb and moves left in small steps, with pauses (real touches take time)
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: "touchStart" | "touchMove", x: number) =>
            cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x: Math.round(x), y: Math.round(before.y), id: 0 }] });
        const start = before.x + before.width * before.fraction;
        await touch("touchStart", start);
        for (let k = 1; k <= 20; k++) {
            await touch("touchMove", start - k * before.width * 0.025);
            await page.waitForTimeout(16);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForFunction(() => {
            const m = (globalThis as any).faustPlayground.scene.getModuleById("3");
            return m.moduleFaust.getDSP().getParamValue(m.moduleControles[0].itemParam.address) < 0.5;
        }, null, { timeout: 5_000 });
        const after = await read();
        expect(after.left).toBe(before.left);
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

describe("widget modulation (scene API)", () => {
    // Last sample at the output of a module's node (constant signals), through an analyser.
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

    async function addModule(page: Page, name: string, code: string, x: number): Promise<string> {
        return page.evaluate(async ([n, c, xx]) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const before = scene.getModules().length;
            await app.compileFaust({ name: n, sourceCode: c, x: xx, y: 300, callback: (f: any) => app.createModule(f, n, c, xx, 300) });
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[before].moduleId;
        }, [name, code, x] as [string, string, number]);
    }

    it("recompiles a module when a widget is modulated or released, keeping the slider values", async () => {
        const { page, errors } = await openApp();
        const one = await addModule(page, "One", 'process = vgroup("One", 1);', 150);
        const gain = await addModule(page, "Gain", 'process = vgroup("Gain", *(hslider("gain", 0.5, 0, 1, 0.01)));', 450);
        const source = await addModule(page, "Quarter", 'process = vgroup("Quarter", 0.25);', 150);
        await page.evaluate(([a, b]) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.patch.connect({ module: a, port: 0 }, { module: b, port: 0 });
            s.patch.connect({ module: b, port: 0 }, { module: "output", port: 0 });
            // the user sets the slider to 0.8
            const slider = s.getModuleById(b).moduleView.fModuleContainer.querySelector("input[type=range]");
            slider.value = "80";
            slider.dispatchEvent(new Event("input"));
        }, [one, gain]);
        expect(await outputOf(page, gain)).toBeCloseTo(0.8, 5);

        const modulate = (mode: string) => page.evaluate(async ([from, to, m]) => {
            const s = (globalThis as any).faustPlayground.scene;
            const address = s.widgetsOf(s.getModuleById(to)).find((w: any) => w.label == "gain").address;
            return s.modulate({ module: from, port: 0 }, to, address, m);
        }, [source, gain, mode]);
        const inputsOf = (id: string) => page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs(), id);

        // ⇐ piloter: the gain is the signal
        expect(await modulate("drive")).toBe(true);
        expect(await inputsOf(gain)).toBe(2);
        expect(await outputOf(page, gain)).toBeCloseTo(0.25, 5);

        // removing the cable removes the modulation: back to the slider value (kept: 0.8)
        await page.evaluate(([from, to]) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.patch.disconnect(s.patch.connectionsTo(to).find((c: any) => c.from.module == from).id);
        }, [source, gain]);
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 1, gain);
        expect(await page.evaluate((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).modulations.length, gain)).toBe(0);
        expect(await outputOf(page, gain)).toBeCloseTo(0.8, 5);

        // ± moduler: 0.8 + D·0.25·(1 − 0)/2, D adjusted live (no recompilation)
        expect(await modulate("modulate")).toBe(true);
        expect(await outputOf(page, gain)).toBeCloseTo(0.925, 3);
        const depth = await page.evaluate((m) => {
            const s = (globalThis as any).faustPlayground.scene;
            const dsp = s.getModuleById(m).moduleFaust.getDSP();
            const address = s.widgetsOf(s.getModuleById(m)).find((w: any) => w.meta.modulation).address;
            // as the modulation port does: through the interface state, saved with the patch
            s.setDepth(m, s.patch.getModule(m).modulations[0].id, -1);
            (globalThis as any).dspBefore = dsp;
            return address;
        }, gain);
        expect(depth).toMatch(/depth/);
        expect(await outputOf(page, gain)).toBeCloseTo(0.675, 3);
        expect(await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP() === (globalThis as any).dspBefore, gain)).toBe(true);

        // saved in version 3, then recalled: same modulation, same values
        const saved = await page.evaluate(() => (globalThis as any).faustPlayground.scene.saveScene(false));
        expect(JSON.parse(saved).version).toBe(3);
        await cleanScene(page);
        await page.evaluate((json) => (globalThis as any).faustPlayground.scene.recallScene(json), saved);
        const recalled = await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            const m = s.getModules().find((x: any) => x.moduleFaust.getName() == "Gain");
            return { id: m.moduleId, inputs: m.moduleFaust.getDSP().getNumInputs(), modulations: s.patch.getModule(m.moduleId).modulations.map((x: any) => x.spec.mode) };
        });
        expect(recalled).toMatchObject({ inputs: 2, modulations: ["modulate"] });
        expect(await outputOf(page, recalled.id)).toBeCloseTo(0.675, 3);
        expect(errors).toEqual([]);
        await page.close();
    }, 180_000);
});

describe("widget modulation (interface)", () => {
    async function addModule(page: Page, name: string, code: string, x: number, y = 250): Promise<string> {
        return page.evaluate(async ([n, c, xx, yy]) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const before = scene.getModules().length;
            await app.compileFaust({ name: n, sourceCode: c, x: xx, y: yy, callback: (f: any) => app.createModule(f, n, c, xx, yy) });
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[before].moduleId;
        }, [name, code, x, y] as [string, string, number, number]);
    }

    const widget = async (page: Page, module: string, label: string) => {
        const container = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, module);
        return `#${container} [data-widget$="/${label}"]`;
    };
    const modulations = (page: Page, module: string) => page.evaluate((m) =>
        (globalThis as any).faustPlayground.scene.patch.getModule(m).modulations.map((x: any) => `${x.widget}:${x.spec.mode}`), module);
    const inputsOf = (page: Page, module: string) => page.evaluate((m) =>
        (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs(), module);

    async function setup() {
        const { page, errors } = await openApp();
        const lfo = await addModule(page, "LFO", 'import("stdfaust.lib"); process = vgroup("LFO", os.osc(hslider("rate[unit:Hz]", 1, 0.1, 10, 0.1)));', 200);
        const osc = await addModule(page, "Osc", 'import("stdfaust.lib"); process = vgroup("Osc", os.osc(hslider("freq[unit:Hz]", 440, 50, 2000, 1)) * hslider("gain", 0.5, 0, 1, 0.01) * (button("gate") + 0.5));', 650);
        return { page, errors, lfo, osc, from: await centerOf(page, portSelector(lfo, "out", 0)) };
    }

    it("opens the palette after a short hover and modulates the widget with the chosen type", async () => {
        const { page, errors, lfo, osc, from } = await setup();
        const freq = await centerOf(page, await widget(page, osc, "freq"));
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(freq.x, freq.y, { steps: 10 });
        expect(await page.locator(".modulation-palette").count()).toBe(0);           // not yet
        await page.waitForSelector(".modulation-palette");
        expect(await page.locator(".modulation-palette [data-mode]").evaluateAll((items) => items.map((i) => (i as HTMLElement).dataset.mode)))
            .toEqual(["modulate", "scale", "drive"]);
        await page.mouse.move(...Object.values(await centerOf(page, '.modulation-palette [data-mode="scale"]')) as [number, number], { steps: 4 });
        await page.mouse.up();
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 1, osc);
        expect(await modulations(page, osc)).toEqual(["/Osc/freq:scale"]);
        expect(await page.locator(".modulation-palette").count()).toBe(0);
        expect(await page.locator(`${await widget(page, osc, "freq")}.modulated-scale`).count()).toBe(1);
        expect(await page.locator(".cable.modulation").count()).toBe(1);
        // a modulation port of its type, at the height of the widget, astride the left edge, clear of
        // the audio ports (bottom edge); the cable ends at its center
        expect(await page.locator(`.modulation-port.modulation-scale[data-module="${osc}"]`).count()).toBe(1);
        const geometry = await page.evaluate(([m, sel]) => {
            const s = (globalThis as any).faustPlayground.scene;
            const path = document.querySelector(".cable.modulation") as SVGPathElement;
            const p = path.getPointAtLength(path.getTotalLength());
            const svg = path.ownerSVGElement!.getBoundingClientRect();
            const port = document.querySelector(".modulation-port")!.getBoundingClientRect();
            const box = s.getModuleById(m).moduleView.fModuleContainer.getBoundingClientRect();
            const w = document.querySelector(sel)!.getBoundingClientRect();
            const audio = Array.from(document.querySelectorAll(`.port[data-module="${m}"]:not(.modulation-port)`)).map((e) => e.getBoundingClientRect());
            return {
                end: [p.x + svg.left - (port.left + port.width / 2), p.y + svg.top - (port.top + port.height / 2)],
                height: port.top + port.height / 2 - (w.top + w.height / 2),
                astride: Math.abs(port.left + port.width / 2 - box.left) < 2,
                clear: audio.every((a) => a.right <= port.left || a.left >= port.right || a.bottom <= port.top || a.top >= port.bottom),
            };
        }, [osc, await widget(page, osc, "freq")] as [string, string]);
        geometry.end.forEach((d: number) => expect(Math.abs(d)).toBeLessThan(1));
        expect(Math.abs(geometry.height)).toBeLessThan(1);
        expect(geometry.astride).toBe(true);
        expect(geometry.clear).toBe(true);
        expect(lfo).toBeDefined();
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("does nothing when the cable is released on the widget or after leaving it", async () => {
        const { page, errors, osc, from } = await setup();
        const gain = await centerOf(page, await widget(page, osc, "gain"));
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(gain.x, gain.y, { steps: 10 });
        await page.waitForSelector(".modulation-palette");
        await page.mouse.move(gain.x - 300, gain.y + 300, { steps: 6 });            // leaves: closes
        expect(await page.locator(".modulation-palette").count()).toBe(0);
        await page.mouse.move(gain.x, gain.y, { steps: 6 });
        await page.waitForSelector(".modulation-palette");
        await page.mouse.up();                                                      // on the widget, no type chosen
        expect(await page.locator(".modulation-palette").count()).toBe(0);
        expect(await modulations(page, osc)).toEqual([]);
        expect((await state(page)).connections).toEqual([]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("offers drive only for a button, the existing type for a modulated widget, and removes a modulation with its last cable", async () => {
        const { page, errors, lfo, osc, from } = await setup();
        const drag = async (label: string, mode: string | null) => {
            const target = await centerOf(page, await widget(page, osc, label));
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(target.x, target.y, { steps: 10 });
            await page.waitForSelector(".modulation-palette");
            const modes = await page.locator(".modulation-palette [data-mode]").evaluateAll((items) => items.map((i) => (i as HTMLElement).dataset.mode));
            if (mode) await page.mouse.move(...Object.values(await centerOf(page, `.modulation-palette [data-mode="${mode}"]`)) as [number, number], { steps: 4 });
            await page.mouse.up();
            return modes;
        };
        expect(await drag("gate", "drive")).toEqual(["drive"]);
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 1, osc);
        expect(await page.locator(`${await widget(page, osc, "gate")}.modulated-drive`).count()).toBe(1);

        // a second source for the same widget: only its type, one more cable on the same modulation
        const second = await addModule(page, "Two", 'process = vgroup("Two", 0.5);', 200, 550);
        const secondFrom = await centerOf(page, portSelector(second, "out", 0));
        const gate = await centerOf(page, await widget(page, osc, "gate"));
        await page.mouse.move(secondFrom.x, secondFrom.y);
        await page.mouse.down();
        await page.mouse.move(gate.x, gate.y, { steps: 10 });
        await page.waitForSelector(".modulation-palette");
        expect(await page.locator(".modulation-palette [data-mode]").count()).toBe(1);
        await page.mouse.move(...Object.values(await centerOf(page, '.modulation-palette [data-mode="drive"]')) as [number, number], { steps: 4 });
        await page.mouse.up();
        expect(await modulations(page, osc)).toEqual(["/Osc/gate:drive"]);
        expect((await state(page)).connections).toEqual([`${lfo}:0>${osc}:0`, `${second}:0>${osc}:0`]);
        expect(await inputsOf(page, osc)).toBe(1);

        // deleting the cables one by one: the modulation goes with the last one
        for (const source of [lfo, second]) {
            await page.mouse.click(...Object.values(await cableMiddle(page, `${source}:0>${osc}:0`)) as [number, number]);
        }
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 0, osc);
        expect(await modulations(page, osc)).toEqual([]);
        expect(await page.locator(".cable.modulation, .modulation-port, .widget.modulated").count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("sets the depth by dragging the ± port, live, and back to 1 by double click", async () => {
        const { page, errors } = await openApp();
        // constant source 0.5 modulating a level of 0.5 over [0, 1]: output 0.5 + D·0.5·0.5
        const half = await addModule(page, "Half", 'process = vgroup("Half", 0.5);', 150);
        const level = await addModule(page, "Level", 'process = vgroup("Level", hslider("level", 0.5, 0, 1, 0.01));', 650);
        const output = () => page.evaluate(async (m) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(m);
            await node.context.resume();
            const analyser = node.context.createAnalyser();
            node.connect(analyser);
            await new Promise((r) => setTimeout(r, 500));
            const buffer = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(buffer);
            node.disconnect(analyser);
            return buffer[buffer.length - 1];
        }, level);
        expect(await page.evaluate(async ([f, o]) => {
            const s = (globalThis as any).faustPlayground.scene;
            return s.modulate({ module: f, port: 0 }, o, s.widgetsOf(s.getModuleById(o)).find((w: any) => w.label == "level").address, "modulate");
        }, [half, level])).toBe(true);
        const portSel = `.modulation-port.modulation-modulate[data-module="${level}"]`;
        await page.waitForSelector(portSel);
        expect(await page.getAttribute(portSel, "data-depth")).toBe("1.000");
        expect(await output()).toBeCloseTo(0.75, 3);
        const dsp = await page.evaluateHandle((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP(), level);

        // 140 px down: D = 1 − 1.4 = −0.4 (counterclockwise ring), output 0.5 − 0.1 = 0.4
        const p = await centerOf(page, portSel);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x, p.y + 140, { steps: 10 });
        await page.mouse.up();
        expect(await page.getAttribute(portSel, "data-depth")).toBe("-0.400");
        expect(await page.locator(`${portSel}.negative`).count()).toBe(1);
        expect(await output()).toBeCloseTo(0.4, 3);
        // live: same DSP (no recompilation), and no cable was drawn from the port
        expect(await page.evaluate(([d, m]) => d === (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP(), [dsp, level] as const)).toBe(true);
        expect((await state(page)).connections).toHaveLength(1);
        // saved with the patch, under the name of its widget
        const saved = JSON.parse(await page.evaluate(() => (globalThis as any).faustPlayground.scene.saveScene(false)));
        expect(saved.modules.find((m: any) => m.id == level).params["/Level/depth_level"]).toBeCloseTo(-0.4, 5);

        await page.dblclick(portSel);
        expect(await page.getAttribute(portSel, "data-depth")).toBe("1.000");
        expect(await output()).toBeCloseTo(0.75, 3);

        // with Shift, ten times finer: 140 px down = −0.14 (output 0.5 + 0.86·0.25 = 0.715); pressing
        // Shift during the gesture does not make the value jump
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.keyboard.down("Shift");
        await page.mouse.move(p.x, p.y + 140, { steps: 10 });
        await page.mouse.up();
        await page.keyboard.up("Shift");
        expect(await page.getAttribute(portSel, "data-depth")).toBe("0.860");
        expect(await output()).toBeCloseTo(0.715, 3);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x, p.y + 20, { steps: 2 });         // −0.2
        await page.keyboard.down("Shift");
        await page.mouse.move(p.x, p.y + 120, { steps: 5 });        // −0.1 more
        await page.keyboard.up("Shift");
        await page.mouse.up();
        expect(await page.getAttribute(portSel, "data-depth")).toBe("0.560");
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("works with a finger", async () => {
        const { page, errors, osc } = await (async () => {
            const { page, errors } = await openApp({ hasTouch: true });
            await addModule(page, "LFO", 'import("stdfaust.lib"); process = vgroup("LFO", os.osc(1));', 200);
            const osc = await addModule(page, "Osc", 'import("stdfaust.lib"); process = vgroup("Osc", os.osc(hslider("freq[unit:Hz]", 440, 50, 2000, 1)));', 650);
            return { page, errors, osc };
        })();
        const lfo = await page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules()[0].moduleId);
        const from = await centerOf(page, portSelector(lfo, "out", 0));
        const freq = await centerOf(page, await widget(page, osc, "freq"));
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: "touchStart" | "touchMove", p: Point) =>
            cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x: Math.round(p.x), y: Math.round(p.y), id: 0 }] });
        await touch("touchStart", from);
        for (let k = 1; k <= 10; k++) await touch("touchMove", { x: from.x + (freq.x - from.x) * k / 10, y: from.y + (freq.y - from.y) * k / 10 });
        await page.waitForSelector(".modulation-palette");
        const item = await centerOf(page, '.modulation-palette [data-mode="modulate"]');
        for (let k = 1; k <= 5; k++) await touch("touchMove", { x: freq.x + (item.x - freq.x) * k / 5, y: freq.y + (item.y - freq.y) * k / 5 });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 1, osc);
        expect(await modulations(page, osc)).toEqual(["/Osc/freq:modulate"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
