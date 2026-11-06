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
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
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

    it("opens every example (version 2 files): those of the File menu, and the precompiled ones", async () => {
        const fs = await import("fs");
        for (const file of ["Small_Exemple", "Small_Exemple_Precompile", "Big_Exemple", "Big_Exemple_Precompile", "Multichannel_Example", "Modulation_Example"]) {
            const saved = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/json", file + ".json"), "utf8"));
            const { page, errors } = await openApp();
            if (file.endsWith("_Precompile")) {
                await page.evaluate(async (f) => (globalThis as any).faustPlayground.scene.recallScene(await (await fetch("json/" + f + ".json")).text()), file);
            } else {
                const labels: Record<string, RegExp> = { Small_Exemple: /^(Small|Petit)/, Big_Exemple: /^(Big|Grand)/, Multichannel_Example: /^(Multichannel|Exemple multicanal)/, Modulation_Example: /^(Modulation|Exemple de modulation)/ };
                await page.locator("#documentsButtonMenu").click();
                await page.locator(".context-menu-item", { hasText: /^(Examples|Exemples)/ }).hover();
                await page.locator(".context-submenu .context-menu-item", { hasText: labels[file] }).click();
            }
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
                expect(modulated).toEqual(["SOscillator:modulate:exp", "Volume:modulate"]);
                expect(await page.locator(".cable.modulation").count()).toBe(2);
                // the depth rows stay hidden after a recall (shown on the ports)
                expect(await page.evaluate(() => Array.from(document.querySelectorAll(".widget.modulation-depth"))
                    .map((e) => getComputedStyle(e).display))).toEqual(["none", "none"]);     // the two ± depths
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
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.markSaved());     // no confirmation here (see below)
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

    it("opens a file without asking: the modified document keeps its changes (documents)", async () => {
        const { page, errors } = await openApp();
        const unsaved = () => page.evaluate(() => (globalThis as any).faustPlayground.scene.hasUnsavedChanges());
        await loadExample(page, "patch_light.json");
        expect(await unsaved()).toBe(false);                     // just opened: a new, clean document
        // a parameter moved through the interface
        await page.evaluate(() => {
            const c = (globalThis as any).faustPlayground.scene.getModules()[0].moduleControles[0];
            c.faustInterfaceView.slider.value = "3";
            c.faustInterfaceView.slider.dispatchEvent(new Event("input"));
        });
        await page.evaluate(() => (globalThis as any).faustPlayground.documents.flush());
        expect(await unsaved()).toBe(true);
        const modified = await state(page);
        const file = await page.evaluate(async () => (await fetch("/json/Modulation_Example.json")).text());
        await page.evaluate((j) => (globalThis as any).faustPlayground.scene.recallScene(j), file);
        expect(await page.locator("#dialogue #validButton").count()).toBe(0);
        expect((await state(page)).modules.map((m) => m.split(":")[1])).toEqual(["SOscillator", "LFO", "Clock", "ADSR", "Volume"]);
        expect(await unsaved()).toBe(false);
        // the first document is still there, modified
        const first = await page.evaluate(() => (globalThis as any).faustPlayground.documents.store.list().find((d: any) => d.name == "Patch").id);
        await page.evaluate((id) => (globalThis as any).faustPlayground.documents.open(id), first);
        expect(await state(page)).toEqual(modified);
        expect(await unsaved()).toBe(true);
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
        // audio ports astride the side edges, inputs on the left and outputs on the right, in a zone
        // under the last widget (the left edge above it is for the modulation ports)
        const ports = await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            const view = s.getModuleById("3").moduleView;
            const box = view.fModuleContainer.getBoundingClientRect();
            const content = view.fInterfaceContainer.getBoundingClientRect();
            return Array.from(document.querySelectorAll('.port[data-module="3"]')).map((p) => {
                const r = p.getBoundingClientRect();
                return { dir: (p as HTMLElement).dataset.dir, left: r.left + r.width / 2 - box.left, right: r.left + r.width / 2 - box.right, below: r.top - content.bottom };
            });
        });
        expect(ports.map((p: any) => p.dir)).toEqual(["in", "in", "out", "out"]);
        ports.filter((p: any) => p.dir == "in").forEach((p: any) => expect(Math.abs(p.left)).toBeLessThan(2));
        ports.filter((p: any) => p.dir == "out").forEach((p: any) => expect(Math.abs(p.right)).toBeLessThan(2));
        ports.forEach((p: any) => expect(p.below).toBeGreaterThanOrEqual(0));

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

        // ± moduler around the slider (0.8), u = D·0.25: 0.8 + u·(1 − 0.8) up, 0.8 + u·(0.8 − 0) down; D adjusted
        // live, 0.5 by default
        expect(await modulate("modulate")).toBe(true);
        expect(await outputOf(page, gain)).toBeCloseTo(0.825, 3);
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
        expect(await outputOf(page, gain)).toBeCloseTo(0.6, 3);
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
        expect(await outputOf(page, recalled.id)).toBeCloseTo(0.6, 3);
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

    // Drags a cable from `from` to the center of `selector` and releases it there, after a hover longer
    // than the palette delay (no palette must open: one mode per kind of widget).
    async function dropOn(page: Page, from: Point, selector: string): Promise<void> {
        const target = await centerOf(page, selector);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 10 });
        await page.waitForTimeout(400);
        expect(await page.locator(".modulation-palette").count()).toBe(0);
        await page.mouse.up();
    }

    it("modulates a slider with ± as soon as the cable is released on it, without palette", async () => {
        const { page, errors, lfo, osc, from } = await setup();
        await dropOn(page, from, await widget(page, osc, "freq"));
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 1, osc);
        expect(await modulations(page, osc)).toEqual(["/Osc/freq:modulate"]);
        expect(await page.locator(`${await widget(page, osc, "freq")}.modulated-modulate`).count()).toBe(1);
        expect(await page.locator(".cable.modulation").count()).toBe(1);
        // a modulation port of its type, at the height of the widget, astride the left edge, clear of
        // the audio ports (in the zone under the widgets); the cable ends at its center
        expect(await page.locator(`.modulation-port.modulation-modulate[data-module="${osc}"]`).count()).toBe(1);
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

    it("does nothing when the cable leaves the widget and is released elsewhere", async () => {
        const { page, errors, osc, from } = await setup();
        const gain = await centerOf(page, await widget(page, osc, "gain"));
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(gain.x, gain.y, { steps: 10 });
        await page.waitForTimeout(400);
        expect(await page.locator(".modulation-palette").count()).toBe(0);
        await page.mouse.move(gain.x - 300, gain.y + 300, { steps: 6 });            // leaves the module
        await page.mouse.up();
        expect(await modulations(page, osc)).toEqual([]);
        expect((await state(page)).connections).toEqual([]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("drives a button, adds a second source to a modulated widget, and removes a modulation with its last cable", async () => {
        const { page, errors, lfo, osc, from } = await setup();
        await dropOn(page, from, await widget(page, osc, "gate"));
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 1, osc);
        expect(await modulations(page, osc)).toEqual(["/Osc/gate:drive"]);
        expect(await page.locator(`${await widget(page, osc, "gate")}.modulated-drive`).count()).toBe(1);

        // a second source for the same widget: one more cable on the same modulation
        const second = await addModule(page, "Two", 'process = vgroup("Two", 0.5);', 200, 550);
        await dropOn(page, await centerOf(page, portSelector(second, "out", 0)), await widget(page, osc, "gate"));
        await page.waitForFunction((n) => (globalThis as any).faustPlayground.scene.patch.getConnections().length == n, 2);
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

    it("sets the deviation of a ~ port and the amount of a + port by dragging them, back to 1 by double click", async () => {
        const { page, errors } = await openApp();
        const half = await addModule(page, "Half", 'process = vgroup("Half", 0.5);', 150);
        // f·(1 + D·0.5) and p + A·0.5
        const lin = await addModule(page, "Lin", 'process = vgroup("Lin", hslider("f[mod:lin]", 100, 1, 1000, 1));', 500);
        const add = await addModule(page, "Add", 'process = vgroup("Add", hslider("p[unit:pitch]", 0.1, -1, 1, 0.001));', 850);
        const output = (m: string) => page.evaluate(async (m) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(m);
            await node.context.resume();
            const analyser = node.context.createAnalyser();
            node.connect(analyser);
            await new Promise((r) => setTimeout(r, 500));
            const buffer = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(buffer);
            node.disconnect(analyser);
            return buffer[buffer.length - 1];
        }, m);
        const modulate = (to: string, label: string) => page.evaluate(async ([f, o, l]) => {
            const s = (globalThis as any).faustPlayground.scene;
            const address = s.widgetsOf(s.getModuleById(o)).find((w: any) => w.label == l).address;
            return s.modulate({ module: f, port: 0 }, o, address, s.allowedModesOf(o, address)[0]);
        }, [half, to, label]);
        const drag = async (sel: string, dy: number) => {
            const p = await centerOf(page, sel);
            await page.mouse.move(p.x, p.y);
            await page.mouse.down();
            await page.mouse.move(p.x, p.y + dy, { steps: 10 });
            await page.mouse.up();
        };
        expect(await modulate(lin, "f")).toBe(true);
        expect(await modulate(add, "p")).toBe(true);
        const linSel = `.modulation-port.modulation-linear[data-module="${lin}"]`;
        const addSel = `.modulation-port.modulation-add[data-module="${add}"]`;
        await page.waitForSelector(linSel);
        await page.waitForSelector(addSel);
        expect(await page.getAttribute(linSel, "data-depth")).toBe("1.000");
        expect(await page.getAttribute(addSel, "data-depth")).toBe("1.000");
        expect(await output(lin)).toBeCloseTo(150, 2);
        expect(await output(add)).toBeCloseTo(0.6, 3);
        // ~: 0.1 per pixel (a range of ±10), 50 px up: D = 6, 100·(1 + 3) = 400
        await drag(linSel, -50);
        expect(await page.getAttribute(linSel, "data-depth")).toBe("6.000");
        expect(await output(lin)).toBeCloseTo(400, 1);
        // +: 0.01 per pixel, 40 px down: A = 0.6, 0.1 + 0.3 = 0.4
        await drag(addSel, 40);
        expect(await page.getAttribute(addSel, "data-depth")).toBe("0.600");
        expect(await output(add)).toBeCloseTo(0.4, 3);
        expect((await state(page)).connections).toHaveLength(2);            // no cable drawn from the ports
        await page.dblclick(linSel);
        await page.dblclick(addSel);
        expect(await page.getAttribute(linSel, "data-depth")).toBe("1.000");
        expect(await page.getAttribute(addSel, "data-depth")).toBe("1.000");
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("sets the depth by dragging the ± port, live, back to 0.5 by double click, and remembers it", async () => {
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
        expect(await page.getAttribute(portSel, "data-depth")).toBe("0.500");     // the default depth
        expect(await output()).toBeCloseTo(0.625, 3);
        const dsp = await page.evaluateHandle((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP(), level);

        // 140 px down: D = 0.5 − 1.4 = −0.9 (counterclockwise ring), output 0.5 − 0.9·0.25 = 0.275
        const p = await centerOf(page, portSel);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x, p.y + 140, { steps: 10 });
        await page.mouse.up();
        expect(await page.getAttribute(portSel, "data-depth")).toBe("-0.900");
        expect(await page.locator(`${portSel}.negative`).count()).toBe(1);
        expect(await output()).toBeCloseTo(0.275, 3);
        // live: same DSP (no recompilation), and no cable was drawn from the port
        expect(await page.evaluate(([d, m]) => d === (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP(), [dsp, level] as const)).toBe(true);
        expect((await state(page)).connections).toHaveLength(1);
        // saved with the patch, under the name of its widget
        const saved = JSON.parse(await page.evaluate(() => (globalThis as any).faustPlayground.scene.saveScene(false)));
        expect(saved.modules.find((m: any) => m.id == level).params["/Level/depth_level"]).toBeCloseTo(-0.9, 5);

        // the modulation removed with its cable, then made again from another source: same depth
        await page.evaluate((m) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.patch.disconnect(s.patch.connectionsTo(m)[0].id);
        }, level);
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 0, level);
        const other = await addModule(page, "Other", 'process = vgroup("Other", 0.5);', 150);
        await page.evaluate(async ([f, o]) => {
            const s = (globalThis as any).faustPlayground.scene;
            return s.modulate({ module: f, port: 0 }, o, s.widgetsOf(s.getModuleById(o)).find((w: any) => w.label == "level").address, "modulate");
        }, [other, level]);
        await page.waitForSelector(portSel);
        expect(await page.getAttribute(portSel, "data-depth")).toBe("-0.900");
        expect(await output()).toBeCloseTo(0.275, 3);
        // saved with the module while the widget is not modulated (documents, patch files)
        await page.evaluate((m) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.patch.disconnect(s.patch.connectionsTo(m)[0].id);
        }, level);
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 0, level);
        const unmodulated = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.describePatch().modules.find((x: any) => x.id == m).params, level);
        expect(unmodulated["/Level/depth_level"]).toBeCloseTo(-0.9, 5);
        await page.evaluate(async ([f, o]) => {
            const s = (globalThis as any).faustPlayground.scene;
            return s.modulate({ module: f, port: 0 }, o, s.widgetsOf(s.getModuleById(o)).find((w: any) => w.label == "level").address, "modulate");
        }, [half, level]);
        await page.waitForSelector(portSel);

        await page.dblclick(portSel);
        expect(await page.getAttribute(portSel, "data-depth")).toBe("0.500");
        expect(await output()).toBeCloseTo(0.625, 3);

        // with Shift, ten times finer: 140 px down = −0.14 (output 0.5 + 0.36·0.25 = 0.59); pressing
        // Shift during the gesture does not make the value jump
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.keyboard.down("Shift");
        await page.mouse.move(p.x, p.y + 140, { steps: 10 });
        await page.mouse.up();
        await page.keyboard.up("Shift");
        expect(await page.getAttribute(portSel, "data-depth")).toBe("0.360");
        expect(await output()).toBeCloseTo(0.59, 3);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x, p.y + 20, { steps: 2 });         // −0.2
        await page.keyboard.down("Shift");
        await page.mouse.move(p.x, p.y + 120, { steps: 5 });        // −0.1 more
        await page.keyboard.up("Shift");
        await page.mouse.up();
        expect(await page.getAttribute(portSel, "data-depth")).toBe("0.060");
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
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });     // lifted on the widget
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() == 1, osc);
        expect(await modulations(page, osc)).toEqual(["/Osc/freq:modulate"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("widget styles", () => {
    async function addModule(page: Page, name: string, code: string, x: number): Promise<string> {
        return page.evaluate(async ([n, c, xx]) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const before = scene.getModules().length;
            await app.compileFaust({ name: n, sourceCode: c, x: xx, y: 200, callback: (f: any) => app.createModule(f, n, c, xx, 200) });
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[before].moduleId;
        }, [name, code, x] as [string, string, number]);
    }
    const value = (page: Page, m: string, label: string) => page.evaluate(([m, label]) =>
        Number((globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => c.itemParam.label == label).value), [m, label]);
    const flush = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());

    it("shows [style:menu{...}] as a menu and [style:radio{...}] as radio buttons, kept in sync with undo and recall", async () => {
        const { page, errors } = await openApp();
        const lfo = await addModule(page, "LFO", `import("stdfaust.lib"); process = vgroup("LFO", select2(shape >= 2, os.osc(1), os.lf_saw(1)))
            with { shape = hslider("Shape [style:menu{'sine':0;'triangle':1;'square':2;'saw':3}]", 0, 0, 3, 1); };`, 150);
        const gate = await addModule(page, "Gate", `process = vgroup("Gate", _ * hslider("Level [style:radio{'off':0;'half':0.5;'full':1}]", 1, 0, 1, 0.5));`, 600);
        await flush(page);
        const menu = page.locator("select.choice-menu");
        expect(await menu.locator("option").allTextContents()).toEqual(["sine", "triangle", "square", "saw"]);
        expect(await page.locator(".choice-radios label").allTextContents()).toEqual(["off", "half", "full"]);
        expect(await page.locator(".control-choice input.choice-slider").evaluateAll((s) => s.map((e) => getComputedStyle(e).display))).toEqual(["none", "none"]);
        expect(await page.locator(".choice-radios input:checked").evaluate((e) => e.parentElement!.textContent)).toBe("full");

        await menu.selectOption({ label: "square" });
        await flush(page);
        expect(await value(page, lfo, "Shape")).toBe(2);
        await page.locator(".choice-radios label", { hasText: "half" }).click();
        await flush(page);
        expect(await value(page, gate, "Level")).toBe(0.5);

        // undo: the value and what the menu and the radio buttons show
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        expect(await value(page, gate, "Level")).toBe(1);
        expect(await page.locator(".choice-radios input:checked").evaluate((e) => e.parentElement!.textContent)).toBe("full");
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.redo());
        // saved and recalled: the menu shows the saved value
        const saved = await page.evaluate(() => (globalThis as any).faustPlayground.scene.saveScene(false));
        await page.evaluate((json) => (globalThis as any).faustPlayground.scene.recallScene(json), saved);
        expect(await page.locator("select.choice-menu").evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text)).toBe("square");
        expect(await page.locator(".choice-radios input:checked").evaluate((e) => e.parentElement!.textContent)).toBe("half");
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("moves a [scale:log] slider in equal ratios, values > 0, and keeps exact values on undo and recall", async () => {
        const { page, errors } = await openApp();
        const lfo = await addModule(page, "LFO", `import("stdfaust.lib"); process = vgroup("LFO", os.osc(rate) * gain)
            with { rate = hslider("Rate[unit:Hz][scale:log]", 1, 0.01, 20, 0.01); gain = hslider("Gain[scale:log]", 0.5, 0, 1, 0.01); };`, 150);
        await flush(page);
        const slider = (label: string) => page.evaluate(([m, l]) => {
            const c = (globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => c.itemParam.label == l);
            return { position: Number(c.faustInterfaceView.slider.value), max: Number(c.faustInterfaceView.slider.max), value: Number(c.value), shown: c.faustInterfaceView.output.textContent.trim() };
        }, [lfo, label]);
        const move = (label: string, position: number) => page.evaluate(([m, l, p]) => {
            const c = (globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => c.itemParam.label == l);
            c.faustInterfaceView.slider.value = String(p);
            c.faustInterfaceView.slider.dispatchEvent(new Event("input"));
        }, [lfo, label, position] as [string, string, number]);
        // initial value 1 Hz: at log(100)/log(2000) of the way, not at 1/20
        let rate = await slider("Rate");
        expect(rate.value).toBe(1);
        expect(rate.position / rate.max).toBeCloseTo(Math.log(100) / Math.log(2000), 2);
        // the middle of the slider: the geometric middle, √(0.01·20) ≈ 0.45 Hz; the ends: 0.01 and 20
        await move("Rate", Math.round(rate.max / 2));
        expect((await slider("Rate")).value).toBeCloseTo(0.45, 2);
        expect((await slider("Rate")).shown).toBe("0.45 Hz");
        await move("Rate", 0);
        expect((await slider("Rate")).value).toBe(0.01);
        await move("Rate", rate.max);
        expect((await slider("Rate")).value).toBe(20);
        // a range starting at 0 cannot be logarithmic: linear
        await move("Gain", 25);
        expect((await slider("Gain")).value).toBe(0.25);

        // a value set by the program is kept as it is (the position only shows it)
        await page.evaluate((m) => (globalThis as any).faustPlayground.scene.restoreParams((globalThis as any).faustPlayground.scene.getModuleById(m), { "/LFO/Rate": 3.17 }), lfo);
        expect((await slider("Rate")).value).toBe(3.17);
        await flush(page);
        const saved = await page.evaluate(() => (globalThis as any).faustPlayground.scene.saveScene(false));
        await move("Rate", 10);
        await flush(page);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        expect((await slider("Rate")).value).toBe(3.17);
        await page.evaluate((json) => (globalThis as any).faustPlayground.scene.recallScene(json), saved);
        const recalled = await page.evaluate(() => {
            const s = (globalThis as any).faustPlayground.scene;
            const c = s.getModules()[0].moduleControles.find((c: any) => c.itemParam.label == "Rate");
            return { value: Number(c.value), dsp: s.getModules()[0].moduleFaust.getDSP().getParamValue(c.itemParam.address) };
        });
        expect(recalled.value).toBe(3.17);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("shows the bargraphs of a module and draws the oscilloscope of a module that declares it", async () => {
        const { page, errors } = await openApp();
        const source = await addModule(page, "Half", 'process = vgroup("Half", 0.5);', 100);
        const value = await addModule(page, "Value", `process = vgroup("Value", _ <: attach(_, hbargraph("Value", -1, 1)));`, 350);
        const scope = await addModule(page, "Scope", `declare display "scope"; process = vgroup("Scope", attach(_, hslider("Time[unit:ms][scale:log]", 20, 1, 5000, 1)));`, 650);
        await page.evaluate(([a, b, c]) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.patch.connect({ module: a, port: 0 }, { module: b, port: 0 });
            s.patch.connect({ module: b, port: 0 }, { module: c, port: 0 });
            s.patch.connect({ module: c, port: 0 }, { module: "output", port: 0 });
        }, [source, value, scope]);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.audioGraph.getNode("output").context.resume());
        // the value 0.5: the number, and three quarters of the bar over [-1, 1]
        await page.waitForFunction(() => document.querySelector(".display-bar .value")?.textContent == "0.50", null, { timeout: 10_000 });
        expect(await page.locator(".display-bar .bar-fill").evaluate((e: HTMLElement) => parseFloat(e.style.width))).toBeCloseTo(75, 1);
        // the oscilloscope draws a line (at 0.5 for a constant): lit pixels in its canvas
        await page.waitForFunction(() => {
            const canvas = document.querySelector("canvas.display-scope") as HTMLCanvasElement | null;
            if (!canvas) return false;
            const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
            return false;
        }, null, { timeout: 10_000 });
        // removed with the module
        await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).deleteModule(), scope);
        expect(await page.locator("canvas.display-scope").count()).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("duplication", () => {
    // creates a module from code, returns its id
    const create = (page: Page, name: string, code: string, x: number, y = 100) => page.evaluate(async ([n, c, xx, yy]) => {
        const { app, scene } = (globalThis as any).faustPlayground;
        const before = scene.getModules().length;
        await app.compileFaust({ name: n, sourceCode: c, x: xx, y: yy, callback: (f: any) => app.createModule(f, n, c, xx, yy) });
        while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
        return scene.getModules()[before].moduleId as string;
    }, [name, code, x, y] as [string, string, number, number]);
    const modulate = (page: Page, from: string, to: string, label: string) => page.evaluate(async ([f, o, l]) => {
        const s = (globalThis as any).faustPlayground.scene;
        const address = s.widgetsOf(s.getModuleById(o)).find((w: any) => w.label == l).address;
        await s.modulate({ module: f, port: 0 }, o, address, s.allowedModesOf(o, address)[0]);
        const id = s.patch.getModule(o).modulations.at(-1).id;
        while (s.getDepth(o, id) === undefined && s.patch.getModule(o).modulations.at(-1).spec.mode != "drive") await new Promise((r) => setTimeout(r, 20));
        return id as string;
    }, [from, to, label]);
    // the patch as the tests see it
    const patch = (page: Page) => page.evaluate(() => {
        const s = (globalThis as any).faustPlayground.scene;
        const file = s.describePatch();
        return {
            modules: file.modules.filter((m: any) => m.kind == "faust").map((m: any) => ({ id: m.id, name: m.name, x: m.x, y: m.y, params: m.params, modulations: (m.modulations ?? []).map((x: any) => x.mode) })),
            connections: file.connections.map((c: any) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`),
            selection: s.patchView.getSelection(),
        };
    });
    const count = (page: Page, n: number) => page.waitForFunction((k) => (globalThis as any).faustPlayground.scene.patch.getModules().filter((m: any) => m.kind == "faust").length == k, n);

    it("the ⧉ button duplicates a module with its settings and its modulation, fed as the original, undone in one step", async () => {
        const { page, errors } = await openApp();
        const half = await create(page, "Half", 'process = vgroup("Half", 0.5);', 100);
        const lin = await create(page, "Lin", 'process = vgroup("Lin", hslider("f[mod:lin]", 100, 1, 1000, 1));', 400);
        const modulation = await modulate(page, half, lin, "f");
        await page.evaluate(([l, m]) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.setDepth(l, m, 6);
            const module = s.getModuleById(l);
            s.restoreParams(module, { [module.moduleControles.find((c: any) => c.itemParam.label == "f").itemParam.address]: 200 });
            s.patch.connect({ module: l, port: 0 }, { module: "output", port: 0 });
        }, [lin, modulation]);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        const container = await page.evaluate((l) => (globalThis as any).faustPlayground.scene.getModuleById(l).moduleView.fModuleContainer.id, lin);
        await page.click(`#${container} > .duplicate`);
        await count(page, 3);
        const after = await patch(page);
        const original = after.modules.find((m: any) => m.id == lin)!;
        const copy = after.modules.find((m: any) => m.id != lin && m.id != half)!;
        expect(copy.name).toBe("Lin");
        expect([copy.x - original.x, copy.y - original.y]).toEqual([40, 40]);
        expect(copy.params).toEqual(original.params);                     // f = 200, deviation 6
        expect(Object.values(copy.params)).toEqual(expect.arrayContaining([200, 6]));
        expect(copy.modulations).toEqual(["linear"]);
        expect(after.connections).toContain(`${half}:0>${copy.id}:0`);    // its modulation source
        expect(after.connections.filter((c: string) => c.startsWith(copy.id + ":"))).toEqual([]);     // not its outputs
        expect(after.selection).toEqual([copy.id]);
        // the copy sounds as the original: 200·(1 + 6·0.5)
        const value = await page.evaluate(async (m) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(m);
            await node.context.resume();
            const analyser = node.context.createAnalyser();
            node.connect(analyser);
            await new Promise((r) => setTimeout(r, 500));
            const x = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(x);
            return x[x.length - 1];
        }, copy.id);
        expect(value).toBeCloseTo(800, 1);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await count(page, 2);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("Ctrl-D duplicates the selection with the connections between its modules; Ctrl-Shift-D without those from outside", async () => {
        const { page, errors } = await openApp();
        const half = await create(page, "Half", 'process = vgroup("Half", 0.5);', 100, 400);
        const a = await create(page, "A", 'process = vgroup("A", 0.25);', 100);
        const b = await create(page, "B", 'process = vgroup("B", *(hslider("g", 0.5, 0, 1, 0.01)));', 400);
        await page.evaluate(([x, y]) => (globalThis as any).faustPlayground.scene.patch.connect({ module: x, port: 0 }, { module: y, port: 0 }), [a, b]);
        await modulate(page, half, b, "g");
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        await page.evaluate(([x, y]) => (globalThis as any).faustPlayground.scene.patchView.select([x, y]), [a, b]);
        await page.keyboard.press("Control+d");
        await count(page, 5);
        let p = await patch(page);
        const [a2, b2] = p.selection;
        expect(p.modules.find((m: any) => m.id == a2)!.name).toBe("A");
        expect(p.modules.find((m: any) => m.id == b2)!.modulations).toEqual(["modulate"]);
        expect(p.connections).toEqual(expect.arrayContaining([`${a2}:0>${b2}:0`, `${half}:0>${b2}:1`]));
        // one step undoes the whole duplication
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await count(page, 3);
        // B alone, without the cables from outside: neither its audio input nor its modulation
        await page.evaluate((y) => (globalThis as any).faustPlayground.scene.patchView.select([y]), b);
        await page.keyboard.press("Control+Shift+d");
        await count(page, 4);
        p = await patch(page);
        const [b3] = p.selection;
        expect(p.modules.find((m: any) => m.id == b3)!.modulations).toEqual([]);
        expect(p.connections.filter((c: string) => c.includes(b3 + ":"))).toEqual([]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("context menu and clipboard", () => {
    const create = (page: Page, name: string, code: string, x: number, y = 120) => page.evaluate(async ([n, c, xx, yy]) => {
        const { app, scene } = (globalThis as any).faustPlayground;
        const before = scene.getModules().length;
        await app.compileFaust({ name: n, sourceCode: c, x: xx, y: yy, callback: (f: any) => app.createModule(f, n, c, xx, yy) });
        while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
        return scene.getModules()[before].moduleId as string;
    }, [name, code, x, y] as [string, string, number, number]);
    const patch = (page: Page) => page.evaluate(() => {
        const s = (globalThis as any).faustPlayground.scene;
        const file = s.describePatch();
        return {
            modules: file.modules.filter((m: any) => m.kind == "faust").map((m: any) => ({ id: m.id, name: m.name, x: m.x, y: m.y, modulations: (m.modulations ?? []).length })),
            connections: file.connections.map((c: any) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`),
            selection: s.patchView.getSelection(),
        };
    });
    const count = (page: Page, n: number) => page.waitForFunction((k) => (globalThis as any).faustPlayground.scene.patch.getModules().filter((m: any) => m.kind == "faust").length == k, n);
    const title = (page: Page, id: string) => page.evaluate((m) => "#" + (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id + " h6", id);
    const choose = async (page: Page, label: string) => {
        await page.locator(".context-menu-item", { hasText: new RegExp("^" + label) }).click();
        expect(await page.locator(".context-menu").count()).toBe(0);
    };
    // A → B → output, a modulation of B by Half
    const scene = async (page: Page) => {
        const half = await create(page, "Half", 'process = vgroup("Half", 0.5);', 100, 420);
        const a = await create(page, "A", 'process = vgroup("A", 0.25);', 100);
        const b = await create(page, "B", 'process = vgroup("B", *(hslider("g", 0.5, 0, 1, 0.01)));', 400);
        await page.evaluate(async ([h, x, y]) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.patch.connect({ module: x, port: 0 }, { module: y, port: 0 });
            s.patch.connect({ module: y, port: 0 }, { module: "output", port: 0 });
            const address = s.widgetsOf(s.getModuleById(y)).find((w: any) => w.label == "g").address;
            await s.modulate({ module: h, port: 0 }, y, address, "modulate");
            await s.history.flush();
        }, [half, a, b]);
        return { half, a, b };
    };

    it("copies the selection from the menu and pastes it where the stage is right-clicked, with the connections between its modules", async () => {
        const { page, errors } = await openApp();
        const { a, b } = await scene(page);
        await page.evaluate(([x, y]) => (globalThis as any).faustPlayground.scene.patchView.select([x, y]), [a, b]);
        await page.click(await title(page, b), { button: "right" });
        expect(await page.locator(".context-menu-item").allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/^Copy/), expect.stringMatching(/^Unplug/), expect.stringMatching(/^Delete/)]));
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.patchView.getSelection().length)).toBe(2);   // B was in it
        await choose(page, "Copy");
        // the clipboard is a patch file
        const text = await page.evaluate(() => (globalThis as any).faustPlayground.scene.fClipboard);
        expect(JSON.parse(text)).toMatchObject({ format: "faustplayground-patch", modules: [{ name: "A" }, { name: "B" }] });
        await page.mouse.click(700, 500, { button: "right" });
        const at = await page.evaluate(() => (globalThis as any).faustPlayground.scene.toStage(700, 500));
        await choose(page, "Paste");
        await count(page, 5);
        const p = await patch(page);
        const [a2, b2] = p.selection;
        expect(p.modules.find((m: any) => m.id == a2)).toMatchObject({ name: "A", x: at.x, y: at.y });
        expect(p.modules.find((m: any) => m.id == b2)).toMatchObject({ name: "B", modulations: 0 });     // its source was not copied
        expect(p.connections).toContain(`${a2}:0>${b2}:0`);
        expect(p.connections.filter((c: string) => c.includes(b2 + ":") && !c.startsWith(a2))).toEqual([]);     // not to the output
        // one undo removes the paste
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await count(page, 3);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("unplugs a module (audio and modulation cables), and on the physical output; deletes the selection", async () => {
        const { page, errors } = await openApp();
        const { half, a, b } = await scene(page);
        await page.click(await title(page, b), { button: "right" });
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.patchView.getSelection())).toEqual([b]);
        await choose(page, "Unplug \\(");
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).modulations.length == 0, b);
        let p = await patch(page);
        expect(p.connections).toEqual([]);
        // the physical output: unplug only
        await page.evaluate(([x]) => (globalThis as any).faustPlayground.scene.patch.connect({ module: x, port: 0 }, { module: "output", port: 1 }), [a]);
        await page.click("#moduleOutput", { button: "right" });
        const enabled = await page.locator(".context-menu-item:not(:disabled)").allTextContents();
        expect(enabled.map((l) => l.replace(/[⌘⇧⌫].*|Ctrl.*|Del$/, "").trim())).toEqual(["Paste", "Unplug (remove all the cables)"]);
        await choose(page, "Unplug \\(");
        expect((await patch(page)).connections).toEqual([]);
        // Delete: the selection
        await page.evaluate(([x, y]) => (globalThis as any).faustPlayground.scene.patchView.select([x, y]), [a, half]);
        await page.keyboard.press("Delete");
        await count(page, 1);
        expect((await patch(page)).modules.map((m: any) => m.name)).toEqual(["B"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("Ctrl-A selects all; Ctrl-C, Ctrl-V at the pointer; Ctrl-X cuts", async () => {
        const { page, errors } = await openApp();
        const { a } = await scene(page);
        await page.mouse.click(600, 600);
        await page.keyboard.press("Control+a");
        expect((await patch(page)).selection).toHaveLength(3);
        await page.evaluate((x) => (globalThis as any).faustPlayground.scene.patchView.select([x]), a);
        await page.keyboard.press("Control+c");
        await page.mouse.move(650, 520);
        await page.keyboard.press("Control+v");
        await count(page, 4);
        const at = await page.evaluate(() => (globalThis as any).faustPlayground.scene.toStage(650, 520));
        let p = await patch(page);
        expect(p.modules.find((m: any) => m.id == p.selection[0])).toMatchObject({ name: "A", x: at.x, y: at.y });
        await page.keyboard.press("Control+x");
        await count(page, 3);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("interface of a module", () => {
    const CODE = `import("stdfaust.lib");
process = vgroup("Demo", hgroup("[0]Oscillator", os.osc(hslider("[0]Freq[unit:Hz][tooltip:frequency of the sine]", 440, 20, 2000, 1)) * vslider("[1]Level", 0.5, 0, 1, 0.01))
  * vgroup("[1]Envelope", nentry("[0]Voices", 4, 1, 16, 1) / 16 + vgroup("[1]Advanced", hslider("Curve", 0, -1, 1, 0.01) + hslider("Secret[hidden:1]", 0, 0, 1, 0.01)))
  <: attach(_, abs : vgroup("[2]Meters", hbargraph("Meter", 0, 1))));`;

    it("shows the groups as sections, number entries, vertical sliders horizontal, tooltips; hides [hidden:1]; bargraphs in their group", async () => {
        const { page, errors } = await openApp();
        const id = await page.evaluate(async (code) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            await app.compileFaust({ name: "Demo", sourceCode: code, x: 200, y: 80, callback: (f: any) => app.createModule(f, "Demo", code, 200, 80) });
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[0].moduleId as string;
        }, CODE);
        const container = "#" + await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
        // the sections and their levels; "Demo" (the module) is not one
        expect(await page.locator(`${container} .ui-group-label`).allTextContents()).toEqual(["Oscillator", "Envelope", "Advanced", "Meters"]);
        expect(await page.locator(`${container} .ui-level-2 > .ui-group-label`).allTextContents()).toEqual(["Advanced"]);
        // widgets inside their sections, in order
        const inside = (section: string) => page.evaluate(([c, s]) => Array.from(document.querySelectorAll(`${c} .ui-section`))
            .find((e) => e.querySelector(":scope > .ui-group-label")!.textContent == s)!
            .querySelectorAll(".widget:not(.ui-hidden) .label").length, [container, section]);
        expect(await inside("Oscillator")).toBe(2);
        expect(await inside("Envelope")).toBe(2);                     // Voices, Curve (Secret hidden)
        expect(await page.locator(`${container} .ui-section:has(> .ui-group-label:text-is("Meters")) .display-place .bar-track`).count()).toBe(1);
        expect(await page.locator(`${container} .widget.ui-hidden`).count()).toBe(1);
        expect(await page.locator(`${container} .widget[title="frequency of the sine"]`).count()).toBe(1);
        // the vslider (Level) is shown horizontal, as an hslider
        const level = await page.locator(`${container} .widget:has(.label:text-is("Level")) input[type="range"]`).boundingBox();
        expect(level!.width).toBeGreaterThan(level!.height * 5);

        // the number entry: a value typed, kept in range, set in the DSP, undone
        const entry = page.locator(`${container} input.entry`);
        expect(await entry.inputValue()).toBe("4");
        const flush = () => page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        await flush();
        await entry.fill("7");
        await entry.press("Enter");
        await page.waitForFunction(async (m) => {
            const dsp = (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP();
            return dsp.getParamValue(dsp.getParams().find((p: string) => p.endsWith("/Voices"))) == 7;
        }, id);
        await flush();
        await entry.fill("99");
        await entry.press("Enter");
        expect(await entry.inputValue()).toBe("16");
        await page.waitForFunction(async (m) => {
            const dsp = (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP();
            return dsp.getParamValue(dsp.getParams().find((p: string) => p.endsWith("/Voices"))) == 16;
        }, id);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLInputElement).value == "7", `${container} input.entry`);
        // the value of an AudioWorklet node is updated when the audio thread reports it
        await page.waitForFunction(async (m) => {
            const dsp = (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP();
            return dsp.getParamValue(dsp.getParams().find((p: string) => p.endsWith("/Voices"))) == 7;
        }, id);

        // a widget in a section is modulated as any other: its port at its height
        const curve = await page.evaluate(async (m) => {
            const s = (globalThis as any).faustPlayground.scene;
            const source = s.patch.getModules().find((x: any) => x.kind == "input").id;
            const address = s.widgetsOf(s.getModuleById(m)).find((w: any) => w.label == "Curve").address;
            await s.modulate({ module: source, port: 0 }, m, address, "modulate");
            return address;
        }, id);
        await page.waitForSelector(`${container} .modulation-port`);
        const [port, widget] = [await page.locator(`${container} .modulation-port`).boundingBox(), await page.locator(`${container} [data-widget="${curve}"]`).boundingBox()];
        expect(Math.abs((port!.y + port!.height / 2) - (widget!.y + widget!.height / 2))).toBeLessThan(2);
        expect(await page.locator(`${container} .ui-group-label`).allTextContents()).toEqual(["Oscillator", "Envelope", "Advanced", "Meters"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("knobs, rows and tabs", () => {
    const CODE = `import("stdfaust.lib");
process = vgroup("Synth", tgroup("[0]Pages", vgroup("[0]Osc", hgroup("[0]Main", os.osc(hslider("[0]freq[style:knob][unit:Hz][scale:log]", 440, 20, 2000, 1)) * hslider("[1]gain[style:knob]", 0.5, 0, 1, 0.01)))
  : vgroup("[1]Filter", fi.lowpass(2, hslider("cutoff", 1000, 20, 20000, 1)))));`;

    it("turns a knob by a vertical drag, lays out an hgroup as a row, a tgroup as tabs; ports on the widgets of a row", async () => {
        const { page, errors } = await openApp();
        const id = await page.evaluate(async (c) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            await app.compileFaust({ name: "Synth", sourceCode: c, x: 200, y: 80, callback: (f: any) => app.createModule(f, "Synth", c, 200, 80) });
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[0].moduleId as string;
        }, CODE);
        const container = "#" + await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
        const value = (label: string) => page.evaluate(([m, l]) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => c.itemParam.label == l).value, [id, label]);
        // tabs: Osc shown, Filter hidden
        expect(await page.locator(`${container} .ui-tab`).allTextContents()).toEqual(["Osc", "Filter"]);
        expect(await page.locator(`${container} .ui-tab.selected`).textContent()).toBe("Osc");
        expect(await page.locator(`${container} .widget:has(.label:text-is("cutoff"))`).isVisible()).toBe(false);
        // the row: the two knobs side by side
        const [k1, k2] = [(await page.locator(`${container} svg.knob`).nth(0).boundingBox())!, (await page.locator(`${container} svg.knob`).nth(1).boundingBox())!];
        expect(Math.abs(k1.y - k2.y)).toBeLessThan(1);
        expect(k2.x).toBeGreaterThan(k1.x + k1.width);
        // a knob: 100 px up is half the range of positions; Shift: ten times finer; double click: its initial value
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height / 2);
        await page.mouse.down();
        await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height / 2 - 40, { steps: 8 });
        await page.mouse.up();
        expect(Number(await value("gain"))).toBeCloseTo(0.7, 2);
        await page.keyboard.down("Shift");
        await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height / 2);
        await page.mouse.down();
        await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height / 2 - 40, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up("Shift");
        expect(Number(await value("gain"))).toBeCloseTo(0.72, 2);
        expect(await page.evaluate((c) => document.querySelector(c)!.getBoundingClientRect().left, container)).toBe(await page.evaluate((c) => document.querySelector(c)!.getBoundingClientRect().left, container));
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await page.waitForFunction(([m]) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((c: any) => c.itemParam.label == "gain").value == "0.50", [id]);
        await page.locator(`${container} svg.knob`).nth(1).dblclick();
        expect(await value("gain")).toBe("0.50");
        // a modulation of a knob in a row: its port on the corner of the knob, not on the edge of the module
        const freq = await page.evaluate(async (m) => {
            const s = (globalThis as any).faustPlayground.scene;
            const source = s.patch.getModules().find((x: any) => x.kind == "input").id;
            const address = s.widgetsOf(s.getModuleById(m)).find((w: any) => w.label == "freq").address;
            await s.modulate({ module: source, port: 0 }, m, address, s.allowedModesOf(m, address)[0]);
            return address;
        }, id);
        await page.waitForSelector(`${container} .modulation-port`);
        const port = (await page.locator(`${container} .modulation-port`).boundingBox())!;
        const knob = (await page.locator(`${container} [data-widget="${freq}"]`).boundingBox())!;
        expect(Math.abs((port.x + port.width / 2) - knob.x)).toBeLessThan(port.width);
        expect(Math.abs((port.y + port.height / 2) - knob.y)).toBeLessThan(port.height);
        // the tab chosen stays after the recompilation; a hidden widget's port goes to the title
        await page.locator(`${container} .ui-tab`, { hasText: "Filter" }).click();
        expect(await page.locator(`${container} .widget:has(.label:text-is("cutoff"))`).isVisible()).toBe(true);
        const title = (await page.locator(`${container} h6`).boundingBox())!;
        const hidden = (await page.locator(`${container} .modulation-port`).boundingBox())!;
        expect(Math.abs((hidden.y + hidden.height / 2) - (title.y + title.height / 2))).toBeLessThan(2);
        // the modulation removed: recompiled, the interface rebuilt, still on the Filter tab
        const dsp = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs(), id);
        await page.evaluate((m) => {
            const s = (globalThis as any).faustPlayground.scene;
            s.patch.disconnect(s.patch.connectionsTo(m)[0].id);
        }, id);
        await page.waitForFunction(([m, n]) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getDSP().getNumInputs() < n, [id, dsp] as const);
        expect(await page.locator(`${container} .ui-tab.selected`).textContent()).toBe("Filter");
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("buttons and checkboxes", () => {
    it("centers a button at half the width (at least 96 px), spaced as the sliders, lit while held; a checkbox is a button with a LED", async () => {
        const { page, errors } = await openApp();
        const code = `import("stdfaust.lib");
process = vgroup("Wahoo", os.sawtooth(hslider("[0]freq", 112, 20, 1000, 1)) * hslider("[1]gain", 0.25, 0, 1, 0.01) * en.ar(0.01, 0.3, button("[2]gate"))
  * (1 - checkbox("[3]mute")) * hslider("[4]volume", 0.6, 0, 1, 0.01));`;
        const id = await page.evaluate(async (c) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            await app.compileFaust({ name: "Wahoo", sourceCode: c, x: 200, y: 80, callback: (f: any) => app.createModule(f, "Wahoo", c, 200, 80) });
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[0].moduleId as string;
        }, code);
        const container = "#" + await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
        const layout = await page.evaluate((c) => {
            const content = document.querySelector(`${c} .content`)!.getBoundingClientRect();
            const button = document.querySelector(`${c} input[type=button]`)!.getBoundingClientRect();
            // the visible gaps: a slider ends with its thumb (radius 8), a widget begins with its text or button
            const ws = Array.from(document.querySelectorAll(`${c} .widget`));
            const edges = ws.map((w) => {
                const b = w.querySelector("input[type=button]") ?? w.querySelector(".pill"), r = w.querySelector("input[type=range]"), l = w.querySelector(".label");
                if (b) { const x = b.getBoundingClientRect(); return [x.top, x.bottom]; }
                const top = l!.getBoundingClientRect().top;
                if (r) { const x = r.getBoundingClientRect(); return [top, x.top + x.height / 2 + 8]; }
                return [top, w.getBoundingClientRect().bottom];
            });
            return {
                center: (button.left + button.right) / 2 - (content.left + content.right) / 2,
                // half the width inside the padding (16 + 16), at least 96 px (a narrow module)
                widthError: button.width - Math.max(96, (content.width - 32) / 2),
                gaps: edges.slice(1).map((e, i) => e[0] - edges[i][1]),
            };
        }, container);
        expect(Math.abs(layout.center)).toBeLessThan(1);
        expect(Math.abs(layout.widthError)).toBeLessThan(1);
        const sliderGap = layout.gaps[0];                       // freq → gain
        for (const gap of layout.gaps) expect(Math.abs(gap - sliderGap)).toBeLessThan(2);
        // the button lit while held down
        const gate = page.locator(`${container} input[type=button]`);
        const lit = (sel: string) => page.evaluate((x) => document.querySelector(x)!.classList.contains("lit"), sel);
        const gb = (await gate.boundingBox())!;
        await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
        await page.mouse.down();
        expect(await lit(`${container} .control-button:not(.control-checkbox)`)).toBe(true);
        await page.mouse.up();
        expect(await lit(`${container} .control-button:not(.control-checkbox)`)).toBe(false);
        // the checkbox: a button with a LED, labelled, off; a click sets the DSP and lights it, saved and undone
        expect(await page.locator(`${container} .control-checkbox .label`).textContent()).toBe("mute");
        const box = page.locator(`${container} input[type=checkbox]`);
        expect(await box.isChecked()).toBe(false);
        expect(await lit(`${container} .control-checkbox`)).toBe(false);
        const pill = (await page.locator(`${container} .control-checkbox .pill`).boundingBox())!;
        const content = (await page.locator(`${container} .content`).boundingBox())!;
        expect(Math.abs((pill.x + pill.width / 2) - (content.x + content.width / 2))).toBeLessThan(1);     // centered as the button
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        await page.locator(`${container} .control-checkbox .pill`).click();
        expect(await lit(`${container} .control-checkbox`)).toBe(true);
        const mute = () => page.evaluate((m) => {
            const module = (globalThis as any).faustPlayground.scene.getModuleById(m);
            return module.moduleControles.find((c: any) => c.itemParam.label == "mute").value;
        }, id);
        expect(await mute()).toBe("1");
        const saved = await page.evaluate((m) => (globalThis as any).faustPlayground.scene.describePatch().modules.find((x: any) => x.id == m).params, id);
        expect(Object.entries(saved).find(([k]) => k.endsWith("/mute"))![1]).toBe(1);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await page.waitForFunction((sel) => !(document.querySelector(sel) as HTMLInputElement).checked, `${container} input[type=checkbox]`);
        expect(await mute()).toBe("0");
        expect(await lit(`${container} .control-checkbox`)).toBe(false);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("driven buttons", () => {
    it("lights the Gate of an ADSR as a clock drives it", async () => {
        const { page, errors } = await openApp();
        const adsr = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const add = async (f: string, x: number) => {
                const n = scene.getModules().length;
                app.uploadUrl(app, null, x, 80, location.origin + "/faust-modules/modular/" + f);
                while (scene.getModules().length == n) await new Promise((r) => setTimeout(r, 20));
                return scene.getModules()[n].moduleId as string;
            };
            const clock = await add("Clock.dsp", 100), adsr = await add("ADSR.dsp", 420);
            const gate = scene.widgetsOf(scene.getModuleById(adsr)).find((w: any) => w.label == "Gate").address;
            await scene.modulate({ module: clock, port: 0 }, adsr, gate, "drive");
            // a module is computed when its sound is used (here, heard)
            scene.patch.connect({ module: adsr, port: 0 }, { module: "output", port: 0 });
            await scene.audioGraph.getNode(clock).context.resume();
            return adsr;
        });
        const container = "#" + await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, adsr);
        // 120 BPM, width 0.5: on 250 ms, off 250 ms; sampled every 25 ms for 1.5 s
        const states = await page.evaluate(async (c) => {
            const out: boolean[] = [];
            for (let i = 0; i < 60; i++) {
                out.push(document.querySelector(`${c} .control-button`)!.classList.contains("lit"));
                await new Promise((r) => setTimeout(r, 25));
            }
            return out;
        }, container);
        const changes = states.slice(1).filter((s, i) => s != states[i]).length;
        expect(states.filter(Boolean).length).toBeGreaterThan(15);
        expect(states.filter((s) => !s).length).toBeGreaterThan(15);
        expect(changes).toBeGreaterThanOrEqual(4);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("Scope", () => {
    it("shows the waveform or the spectrum (calibrated: a sine of 0.5 at 1 kHz reads -6 dB), its widgets per view, resized by its corner", async () => {
        const { page, errors } = await openApp();
        const [vco, scope] = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const add = async (f: string, x: number) => {
                const n = scene.getModules().length;
                app.uploadUrl(app, null, x, 80, location.origin + "/faust-modules/" + f);
                while (scene.getModules().length == n) await new Promise((r) => setTimeout(r, 20));
                return scene.getModules()[n].moduleId as string;
            };
            const v = await add("modular/SineVCO.dsp", 100), s = await add("display/Scope.dsp", 420);
            scene.patch.connect({ module: v, port: 0 }, { module: s, port: 0 });
            await scene.audioGraph.getNode(v).context.resume();
            return [v, s];
        });
        const set = (m: string, label: string, value: number) => page.evaluate(([id, l, v]) => {
            const scene = (globalThis as any).faustPlayground.scene;
            const module = scene.getModuleById(id);
            const c = module.moduleControles.find((x: any) => x.itemParam.label == l);
            scene.restoreParams(module, { [c.itemParam.address]: v });
        }, [m, label, value] as [string, string, number]);
        const param = (label: string) => page.evaluate(([id, l]) => parseFloat((globalThis as any).faustPlayground.scene.getModuleById(id).moduleControles.find((x: any) => x.itemParam.label == l).value), [scope, label]);
        await set(vco, "Freq", 1000);
        await set(vco, "Gain", 0.5);
        const container = "#" + await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, scope);
        const shown = () => page.evaluate((c) => Array.from(document.querySelectorAll(`${c} .widget:not(.ui-hidden):not(.display-off) .label`)).map((l) => l.textContent), container);
        // waveform: its widgets, a line drawn
        await page.waitForTimeout(400);
        expect(await shown()).toEqual(["View", "Time", "Trigger", "Slope", "Threshold"]);
        const lit = await page.evaluate((c) => {
            const canvas = document.querySelector(`${c} canvas.display-canvas`) as HTMLCanvasElement;
            const d = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150) n++;
            return n;
        }, container);
        expect(lit).toBeGreaterThan(200);
        // spectrum: its widgets, the peak of the sine
        await set(scope, "View", 1);
        await page.waitForFunction((c) => !!(document.querySelector(`${c} canvas.display-canvas`) as HTMLCanvasElement).dataset.peak, container);
        await page.waitForTimeout(500);
        expect(await shown()).toEqual(["View", "Scale"]);
        const [freq, db] = (await page.getAttribute(`${container} canvas.display-canvas`, "data-peak"))!.split(" ").map(Number);
        expect(Math.abs(freq - 1000)).toBeLessThan(1);
        expect(Math.abs(db - 20 * Math.log10(0.5))).toBeLessThan(0.3);
        // 1000 Hz: B5 (987.77 Hz) + 1200·log2(1000/987.77) = +21 cents
        expect(await page.getAttribute(`${container} canvas.display-canvas`, "title")).toMatch(/^(999\.\d|1000\.\d) Hz · B5 \+21¢ · -6\.\d dB$/);
        // the corner: 100 px wider, 50 px taller, kept in Width and Height, undone
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        const grip = (await page.locator(`${container} .display-grip`).boundingBox())!;
        await page.mouse.move(grip.x + 7, grip.y + 7);
        await page.mouse.down();
        await page.mouse.move(grip.x + 107, grip.y + 57, { steps: 8 });
        await page.mouse.up();
        expect([await param("Width"), await param("Height")]).toEqual([420, 190]);
        expect(await page.evaluate((c) => { const k = document.querySelector(`${c} canvas.display-canvas`) as HTMLCanvasElement; return [k.offsetWidth, k.offsetHeight]; }, container)).toEqual([420, 190]);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await page.waitForFunction((c) => (document.querySelector(`${c} canvas.display-canvas`) as HTMLCanvasElement).offsetWidth == 320, container);
        expect([await param("Width"), await param("Height")]).toEqual([320, 140]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("library", () => {
    it("shows the families in one view (modular, FaustPlayground, Faust libraries, My modules, Stores), their modules and descriptions", async () => {
        const { page, errors } = await openApp();
        await page.locator("#libraryButtonMenu").click();
        const rows = await page.evaluate(() => Array.from(document.querySelectorAll("#libraryFamilies li")).map((l) =>
            l.classList.contains("libraryGroup") ? "# " + l.textContent : (l as HTMLElement).dataset.family));
        expect(rows).toEqual([
            "# Modular", "Sources", "Timbre", "Level", "Control", "Time", "Random and pitch", "Measure",
            "# FaustPlayground", "Harps", "Winds", "Bars and bowls", "Noises and oscillators", "Instruments with reverb",
            "Filters", "Echoes and reverbs", "Modulations", "Level and dynamics", "Spatialization and multichannel", "Modulation sources",
            "# Faust libraries", "Lib reverbs", "Lib dynamics", "Lib filters", "Lib equalizers", "Lib pedals", "Lib saturation", "Lib delays", "Lib effects", "Lib oscillators", "Lib drums", "Lib physical models", "Lib analysis",
            "My modules",
            // the stores followed (none), and one to add (no family)
            "# Stores", undefined,
        ]);
        // a family: its modules; a module pointed at: its description
        await page.locator('li.libraryFamily[data-family="Filters"]').click();
        expect(await page.locator('li.libraryFamily.selected').getAttribute("data-family")).toBe("Filters");
        const names = await page.locator("#libraryModules a").allTextContents();
        expect(names).toHaveLength(7);
        await page.locator("#libraryModules a", { hasText: "Comb" }).hover();
        expect(await page.locator("#libraryDescription .libraryText").textContent()).toMatch(/comb filter/i);
        // double click: added to the scene
        await page.locator("#libraryModules a", { hasText: "Comb" }).dblclick();
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1);
        // the family chosen is remembered
        await page.reload();
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current);
        await page.locator("#libraryButtonMenu").click();
        await page.waitForSelector('li.libraryFamily.selected');
        expect(await page.locator('li.libraryFamily.selected').getAttribute("data-family")).toBe("Filters");
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("modules of the Faust libraries", () => {
    it("a sequencer plays the guitar model: its pitch added to Pitch, its gate driving gate, as the Pitch set by hand", async () => {
        // The tuning of the model depends on the sample rate (in tune at 48 kHz, 17 cents low at 392 Hz at
        // 44.1 kHz, as the library makes it, measured offline): the guitar played by the sequencer is compared
        // with a guitar whose Pitch is set by hand to the same pitch, in the same context.
        const { page, errors } = await openApp();
        const [played, byHand] = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const add = async (f: string, x: number, y = 80) => {
                const n = scene.getModules().length;
                app.uploadUrl(app, null, x, y, location.origin + "/faust-modules/" + f);
                while (scene.getModules().length == n) await new Promise((r) => setTimeout(r, 20));
                return scene.getModules()[n].moduleId as string;
            };
            const clock = await add("modular/Clock.dsp", 60), seq = await add("modular/Sequencer.dsp", 330);
            const guitar = await add("faustlib/GuitarModel.dsp", 640), reference = await add("faustlib/GuitarModel.dsp", 640, 420);
            const set = (m: string, label: string, v: number) => {
                const module = scene.getModuleById(m);
                const c = module.moduleControles.find((x: any) => x.itemParam.label == label);
                scene.restoreParams(module, { [c.itemParam.address]: v });
            };
            set(seq, "Length", 1);
            set(seq, "Step 1", 7);                      // G4
            set(clock, "Tempo", 30);                    // a note every 2 s, the gate high for 1 s
            set(reference, "Pitch", 7 / 120);
            const modulate = async (from: string, port: number, to: string, label: string) => {
                const address = scene.widgetsOf(scene.getModuleById(to)).find((w: any) => w.label == label).address;
                await scene.modulate({ module: from, port }, to, address, scene.allowedModesOf(to, address)[0]);
            };
            await modulate(clock, 0, seq, "Clock");
            await modulate(seq, 0, guitar, "Pitch");
            await modulate(seq, 1, guitar, "gate");
            await modulate(seq, 1, reference, "gate");
            scene.patch.connect({ module: guitar, port: 0 }, { module: "output", port: 0 });
            scene.patch.connect({ module: reference, port: 0 }, { module: "output", port: 1 });
            const ctx = scene.audioGraph.getNode(guitar).context as AudioContext;
            const analysers = [guitar, reference].map((m) => {
                const a = ctx.createAnalyser();
                a.fftSize = 8192;
                scene.audioGraph.getNode(m).connect(a);
                return a;
            });
            await ctx.resume();
            // within the note held, away from its attack
            await new Promise((r) => setTimeout(r, 700));
            const fundamental = (a: AnalyserNode) => {
                const x = new Float32Array(a.fftSize);
                a.getFloatTimeDomainData(x);
                const sr = ctx.sampleRate, r = (lag: number) => {
                    let s = 0, e1 = 0, e2 = 0;
                    for (let i = 0; i + lag < x.length; i++) { s += x[i] * x[i + lag]; e1 += x[i] * x[i]; e2 += x[i + lag] * x[i + lag]; }
                    return s / Math.sqrt(e1 * e2 + 1e-30);
                };
                const lo = Math.floor(sr / 1000), hi = Math.ceil(sr / 100);
                const rs = Array.from({ length: hi + 2 }, (_, l) => (l >= lo ? r(l) : -1));
                const best = Math.max(...rs);
                let lag = lo;
                for (let l = lo + 1; l <= hi; l++) if (rs[l] > 0.9 * best && rs[l] >= rs[l - 1] && rs[l] >= rs[l + 1]) { lag = l; break; }
                const d = (0.5 * (rs[lag - 1] - rs[lag + 1])) / (rs[lag - 1] - 2 * rs[lag] + rs[lag + 1]);
                return sr / (lag + d);
            };
            return analysers.map(fundamental);
        });
        expect(Math.abs(1200 * Math.log2(played / byHand))).toBeLessThan(1);
        // and near G4 (392 Hz): within the tuning of the model at this sample rate
        expect(Math.abs(1200 * Math.log2(played / (261.6256 * 2 ** (7 / 12))))).toBeLessThan(25);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("filters, equalizers and pedals of the Faust libraries", () => {
    it("in their families; a crossover added from the library has its outputs named; the filters their settings", async () => {
        const { page, errors } = await openApp();
        await page.locator("#libraryButtonMenu").click();
        const familyNames = async (family: string) => {
            await page.locator(`li.libraryFamily[data-family="${family}"]`).click();
            return page.locator("#libraryModules a").allTextContents();
        };
        expect(await familyNames("Lib filters")).toEqual(expect.arrayContaining(["SVF Filter", "Butterworth Filter", "Moog Ladder", "Diode Ladder", "Korg 35", "Moog VCF"]));
        expect(await familyNames("Lib pedals")).toEqual(expect.arrayContaining(["Klon Centaur", "Fulltone OCD", "MXR Phase 90", "Auto Wah", "Crybaby"]));
        expect(await familyNames("Lib equalizers")).toEqual(expect.arrayContaining(["Low Shelf", "Peak EQ", "Crossover 3", "Spectral Tilt", "Parametric EQ"]));
        await page.locator("#libraryModules a", { hasText: "Crossover 3" }).dblclick();
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1);
        const result = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const crossover = scene.getModules()[0];
            const names = Array.from(crossover.moduleView.getModuleContainer().querySelectorAll(".port-label-out")).map((l: any) => l.textContent);
            app.uploadUrl(app, null, 400, 80, location.origin + "/faust-modules/faustlib/SVFFilter.dsp");
            while (scene.getModules().length == 1) await new Promise((r) => setTimeout(r, 20));
            const svf = scene.getModules()[1];
            return {
                names,
                outputs: crossover.moduleView.fOutputPorts.length,
                svf: scene.widgetsOf(svf).map((w: any) => w.label),
                modes: Object.fromEntries(scene.widgetsOf(svf).filter((w: any) => ["Cutoff", "Pitch", "Q"].includes(w.label))
                    .map((w: any) => [w.label, scene.allowedModesOf(svf.moduleId, w.address)[0]])),
            };
        });
        expect(result.outputs).toBe(3);
        expect(result.names).toEqual(["low", "mid", "high"]);
        expect(result.svf).toEqual(["Mode", "Cutoff", "Pitch", "Q", "Gain"]);
        expect(result.modes).toEqual({ Cutoff: "modulate", Pitch: "add", Q: "modulate" });
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("drums, analyzers, saturators and delays of the Faust libraries", () => {
    it("their families; a clock plays the kick through its Gate (⇐ drive); the pitch tracker gives the pitch of a VCO", async () => {
        const { page, errors } = await openApp();
        await page.locator("#libraryButtonMenu").click();
        await page.locator('li.libraryFamily[data-family="Lib drums"]').click();
        expect(await page.locator("#libraryModules a").allTextContents()).toEqual(expect.arrayContaining(["Kick", "Clap", "Hi-Hat", "Pop Drum", "Comb String"]));
        await page.locator('li.libraryFamily[data-family="Lib analysis"]').click();
        expect(await page.locator("#libraryModules a").allTextContents()).toEqual(expect.arrayContaining(["Pitch Tracker", "Spectral Centroid", "Zero Crossings", "RMS Level"]));
        await page.locator('li.libraryFamily[data-family="Lib saturation"]').click();
        expect(await page.locator("#libraryModules a").allTextContents()).toEqual(expect.arrayContaining(["Waveshaper", "Wavefolder", "Cubic Distortion", "Transformer"]));
        await page.locator('li.libraryFamily[data-family="Lib delays"]').click();
        expect(await page.locator("#libraryModules a").allTextContents()).toEqual(expect.arrayContaining(["Echo", "Delay", "Flanger", "Phaser", "Vibrato", "Pitch Shifter", "Granular", "Dimension Expander", "Flanger Stereo", "Tape Stop"]));
        const result = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const add = async (f: string, x: number, y = 80) => {
                const n = scene.getModules().length;
                app.uploadUrl(app, null, x, y, location.origin + "/faust-modules/" + f);
                while (scene.getModules().length == n) await new Promise((r) => setTimeout(r, 20));
                return scene.getModules()[n].moduleId as string;
            };
            const modulate = async (from: string, port: number, to: string, label: string) => {
                const address = scene.widgetsOf(scene.getModuleById(to)).find((w: any) => w.label == label).address;
                const mode = scene.allowedModesOf(to, address)[0];
                await scene.modulate({ module: from, port }, to, address, mode);
                return mode;
            };
            const clock = await add("modular/Clock.dsp", 60), kick = await add("faustlib/Kick.dsp", 360);
            const kickMode = await modulate(clock, 0, kick, "Gate");
            scene.patch.connect({ module: kick, port: 0 }, { module: "output", port: 0 });
            const ctx = scene.audioGraph.getNode(kick).context as AudioContext;
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 32768;
            scene.audioGraph.getNode(kick).connect(analyser);
            await ctx.resume();
            await new Promise((r) => setTimeout(r, 900));
            const x = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(x);
            const kickPeak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
            // a sine at 440 Hz into the pitch tracker, whose pitch is added to the Pitch of a VCO (its sine output)
            const sine = await add("modular/SineVCO.dsp", 60, 400), tracker = await add("faustlib/PitchTracker.dsp", 330, 400), vco = await add("modular/VCO.dsp", 600, 400);
            scene.patch.connect({ module: sine, port: 0 }, { module: tracker, port: 0 });
            const pitchMode = await modulate(tracker, 0, vco, "Pitch");
            scene.patch.connect({ module: vco, port: 0 }, { module: "output", port: 1 });
            const vcoAnalyser = ctx.createAnalyser();
            vcoAnalyser.fftSize = 32768;
            scene.audioGraph.getNode(vco).connect(vcoAnalyser);
            await new Promise((r) => setTimeout(r, 1500));
            const y = new Float32Array(vcoAnalyser.fftSize);
            vcoAnalyser.getFloatTimeDomainData(y);
            // the frequency of the VCO by its rising zero crossings (the first and the last one, interpolated)
            const ups: number[] = [];
            for (let n = 1; n < y.length; n++) if (y[n - 1] <= 0 && y[n] > 0) ups.push(n - 1 + y[n - 1] / (y[n - 1] - y[n]));
            const vcoHz = ((ups.length - 1) * ctx.sampleRate) / (ups[ups.length - 1] - ups[0]);
            return { kickMode, kickPeak, pitchMode, vcoHz };
        });
        expect(result.kickMode).toBe("drive");
        expect(result.kickPeak).toBeGreaterThan(0.1);
        expect(result.pitchMode).toBe("add");
        expect(Math.abs(1200 * Math.log2(result.vcoHz / 440))).toBeLessThan(5);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("typing the value of a slider or a knob", () => {
    it("a double click on the value types it: kept in the range, on the step, exact on a log scale; Escape or a wrong text gives up; undone", async () => {
        const { page, errors } = await openApp();
        const id = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            app.uploadUrl(app, null, 400, 120, location.origin + "/faust-modules/modular/VCF.dsp");
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[0].moduleId;
        });
        const sel = "#" + await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
        const control = (label: string) => page.evaluate(([m, l]) => {
            const c = (globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((k: any) => k.itemParam.label == l);
            return { value: c.value as string, shown: c.faustInterfaceView.output.textContent as string, position: Number(c.faustInterfaceView.slider.value) };
        }, [id, label] as [string, string]);
        const type = async (label: string, text: string, key = "Enter") => {
            const value = page.locator(`${sel} [data-widget$="/${label}"] .value`);
            await value.dblclick();
            const input = page.locator(`${sel} [data-widget$="/${label}"] .value input.value-input`);
            await input.fill(text);
            await input.press(key);
        };
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        // 440 Hz on the logarithmic Cutoff: exactly 440 (the slider could not give it)
        await type("Cutoff", "440");
        expect(await control("Cutoff")).toMatchObject({ value: "440", shown: "440 Hz" });
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.history.flush());
        // beyond the range: its maximum; a decimal comma; on the step (0.01)
        await type("Cutoff", "123456");
        expect((await control("Cutoff")).value).toBe("20000");
        await type("Resonance", "0,374");
        expect((await control("Resonance")).value).toBe("0.37");
        // a wrong text, Escape: nothing changes
        await type("Resonance", "abc");
        expect((await control("Resonance")).value).toBe("0.37");
        await type("Resonance", "0.9", "Escape");
        expect((await control("Resonance")).value).toBe("0.37");
        expect(await page.locator(`${sel} input.value-input`).count()).toBe(0);
        // undone: the Cutoff typed before
        await page.evaluate(() => { const s = (globalThis as any).faustPlayground.scene; s.history.flush(); return s.undo(); });
        await page.waitForFunction(([m]) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleControles.find((k: any) => k.itemParam.label == "Cutoff").value == "440", [id]);
        // a knob
        const knob = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const code = 'process = _ * hslider("Level[style:knob]", 0.5, 0, 2, 0.001);';
            await app.compileFaust({ name: "K", sourceCode: code, x: 100, y: 500, callback: (f: any) => app.createModule(f, "K", code, 100, 500) });
            while (scene.getModules().length < 2) await new Promise((r) => setTimeout(r, 20));
            return "#" + scene.getModules()[1].moduleView.fModuleContainer.id;
        });
        await page.locator(`${knob} .value`).dblclick();
        await page.locator(`${knob} input.value-input`).fill("1.234");
        await page.locator(`${knob} input.value-input`).press("Enter");
        expect(await page.evaluate((s) => document.querySelector(s + " .value")!.textContent!.trim(), knob)).toBe("1.234");
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("toolbar, File menu, context menu of the stage", () => {
    it("two menus, File and Modules; Load, Save, Edit, Export and the accelerometer hidden", async () => {
        const { page, errors } = await openApp();
        const visible = await page.evaluate(() => Array.from(document.querySelectorAll("#buttonsMenu .buttonsMenu"))
            .filter((b) => getComputedStyle(b).display != "none").map((b) => b.id));
        expect(visible).toEqual(["documentsButtonMenu", "libraryButtonMenu"]);
        // the accelerometer button hidden too; full screen and clear the scene shown
        const little = await page.evaluate(() => Array.from(document.querySelectorAll("#buttonsMenu .buttonsLittleMenu"))
            .filter((b) => getComputedStyle(b).display != "none").map((b) => b.id).filter((i) => ["fullScreenButton", "accButton", "cleanButton"].includes(i)));
        expect(little).toEqual(["fullScreenButton", "cleanButton"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("File: a dropdown (New scene, Open, Save, Save as, Import, Recent scenes, Examples, Open from a store); a Faust file opened becomes a module", async () => {
        const { page, errors } = await openApp();
        await page.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker; });
        await page.reload();
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        await page.locator("#documentsButtonMenu").click();
        const items = await page.locator(".context-menu > .context-menu-item > span:first-child").allTextContents();
        expect(items).toEqual(["New scene", "Open a scene…", "Save", "Save as…", "Import a Faust file (.dsp)…", "Recent scenes", "Examples", "Open from a store", "Publish the scene to my store", "My store…"]);
        // the panel of the documents is not shown
        expect(await page.locator("#documentsContainer").isVisible()).toBe(false);
        await page.keyboard.press("Escape");
        // a Faust file: a module of the scene
        const chooser = page.waitForEvent("filechooser");
        await page.locator("#documentsButtonMenu").click();
        await page.locator(".context-menu-item", { hasText: "Open a scene" }).click();
        await (await chooser).setFiles({ name: "Hum.dsp", mimeType: "text/plain", buffer: Buffer.from('import("stdfaust.lib"); process = os.osc(100) * 0.1;') });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1, null, { timeout: 60_000 });
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("the context menu of the stage imports a Faust file where it was opened", async () => {
        const { page, errors } = await openApp();
        await page.mouse.click(700, 500, { button: "right" });
        const at = await page.evaluate(() => (globalThis as any).faustPlayground.scene.toStage(700, 500));
        const chooser = page.waitForEvent("filechooser");
        await page.locator(".context-menu .context-menu-item", { hasText: ".dsp" }).click();
        await (await chooser).setFiles({ name: "Beep.dsp", mimeType: "text/plain", buffer: Buffer.from('import("stdfaust.lib"); process = os.osc(440) * 0.1;') });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1, null, { timeout: 60_000 });
        const module = await page.evaluate(() => {
            const m = (globalThis as any).faustPlayground.scene.getModules()[0];
            return { name: m.moduleView.fTitle?.textContent ?? m.patchID, x: m.moduleView.x, y: m.moduleView.y };
        });
        expect(module.x).toBeCloseTo(at.x, 0);
        expect(module.y).toBeCloseTo(at.y, 0);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("alignment guides", () => {
    const create = (page: Page, name: string, code: string, x: number, y: number) => page.evaluate(async ([n, c, xx, yy]) => {
        const { app, scene } = (globalThis as any).faustPlayground;
        const before = scene.getModules().length;
        await app.compileFaust({ name: n, sourceCode: c, x: xx, y: yy, callback: (f: any) => app.createModule(f, n, c, xx, yy) });
        while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
        return scene.getModules()[before].moduleId as string;
    }, [name, code, x, y] as [string, string, number, number]);
    const box = (page: Page, id: string) => page.evaluate((m) => {
        const r = (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }, id);
    const position = (page: Page, id: string) => page.evaluate((m) => {
        const s = (globalThis as any).faustPlayground.scene.patch.getModule(m);
        return { x: s.x, y: s.y };
    }, id);
    // drags a module by its title so that its top-left corner goes by (dx, dy) on screen; returns the
    // guides shown just before the release
    const drag = async (page: Page, id: string, dx: number, dy: number, alt = false) => {
        const b = await box(page, id);
        const start = { x: b.left + 30, y: b.top + 12 };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        if (alt) await page.keyboard.down("Alt");
        await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
        const guides = await page.evaluate(() => Array.from(document.querySelectorAll(".alignment-guide")).map((l) => ({
            x1: +l.getAttribute("x1")!, y1: +l.getAttribute("y1")!, x2: +l.getAttribute("x2")!, y2: +l.getAttribute("y2")!,
        })));
        await page.mouse.up();
        if (alt) await page.keyboard.up("Alt");
        return guides;
    };

    it("pulls a module dragged within 4 px onto the top of another, shows a horizontal line, and lets go with Alt", async () => {
        const { page, errors } = await openApp();
        const a = await create(page, "A", 'process = vgroup("A", hslider("x", 0, 0, 1, 0.01));', 120, 120);
        // B taller than A: their bottoms do not meet when their tops do
        const b = await create(page, "B", 'process = vgroup("B", hslider("y", 0, 0, 1, 0.01) + hslider("z", 0, 0, 1, 0.01));', 560, 330);
        const [ba, bb] = [await box(page, a), await box(page, b)];
        // B's top 3 px below A's top, far from its sides
        const guides = await drag(page, b, 0, ba.top + 3 - bb.top);
        expect(guides).toHaveLength(1);
        expect(guides[0].y1).toBe(guides[0].y2);                  // horizontal
        expect(guides[0].x1).toBeLessThan(guides[0].x2);
        expect(await page.locator(".alignment-guide").count()).toBe(0);      // gone after the release
        expect((await position(page, b)).y).toBeCloseTo((await position(page, a)).y, 6);
        // B's left 2 px right of A's right: side by side, a vertical line
        const [ba2, bb2] = [await box(page, a), await box(page, b)];
        const side = await drag(page, b, ba2.right + 2 - bb2.left, 0);
        expect(side.some((g) => g.x1 == g.x2)).toBe(true);
        const after = await box(page, b);
        expect(after.left).toBeCloseTo(ba2.right, 1);
        // with Alt: no magnetism, 3 px away and no guide
        const [ba3, bb3] = [await box(page, a), await box(page, b)];
        const free = await drag(page, b, 0, ba3.top + 60 + 3 - bb3.top, true);
        expect(free.filter((g) => g.y1 == g.y2)).toEqual([]);
        expect((await box(page, b)).top).toBeCloseTo(ba3.top + 63, 1);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

describe("modular library", () => {
    it("computes a module whose inputs are not connected (silence in, not no computation)", async () => {
        const { page, errors } = await openApp();
        const id = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const code = 'process = vgroup("Half", _ + 0.5);';
            await app.compileFaust({ name: "Half", sourceCode: code, x: 300, y: 200, callback: (f: any) => app.createModule(f, "Half", code, 300, 200) });
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[0].moduleId;
        });
        const value = await page.evaluate(async (m) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(m);
            await node.context.resume();
            const analyser = node.context.createAnalyser();
            node.connect(analyser);
            await new Promise((r) => setTimeout(r, 600));
            const x = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(x);
            return x[x.length - 1];
        }, id);
        expect(value).toBeCloseTo(0.5, 5);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("writes the declared names of the ports next to them, not a name that is only the port number", async () => {
        const { page, errors } = await openApp();
        const labels = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const add = async (f: string, x: number) => {
                const before = scene.getModules().length;
                app.uploadUrl(app, null, x, 100, location.origin + "/faust-modules/modular/" + f);
                while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
                return scene.getModules()[before];
            };
            const names = (m: any) => Array.from(m.moduleView.getModuleContainer().querySelectorAll(".port-label"))
                .map((l: any) => `${l.classList.contains("port-label-in") ? "in" : "out"}:${l.textContent}`);
            const vco = await add("VCO.dsp", 100);
            const vcf = await add("VCF.dsp", 400);
            const mixer = await add("Mixer.dsp", 700);
            // each label on the row of its port
            const port = vco.moduleView.getPort("out", 2).getBoundingClientRect();
            const label = vco.moduleView.getModuleContainer().querySelectorAll(".port-label")[2].getBoundingClientRect();
            return {
                vco: names(vco), vcf: names(vcf), mixer: names(mixer),
                row: Math.abs((port.top + port.bottom) / 2 - (label.top + label.bottom) / 2),
                title: vco.moduleView.getPort("out", 2).title,
            };
        });
        expect(labels.vco).toEqual(["out:sine", "out:triangle", "out:saw", "out:square"]);
        expect(labels.vcf).toEqual(["in:audio", "out:audio"]);
        expect(labels.mixer).toEqual(["out:mix"]);           // inputs "1; 2; 3; 4": the numbers of the ports
        expect(labels.row).toBeLessThan(1);
        expect(labels.title).toMatch(/3 : saw$/);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("classic FM with two SineVCO: the modulator dropped on the carrier's Freq (linear, deviation 1)", async () => {
        const { page, errors } = await openApp();
        const result = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const add = async (x: number) => {
                const before = scene.getModules().length;
                app.uploadUrl(app, null, x, 100, location.origin + "/faust-modules/modular/SineVCO.dsp");
                while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
                return scene.getModules()[before].moduleId as string;
            };
            const set = (m: string, label: string, v: number) => {
                const module = scene.getModuleById(m);
                const c = module.moduleControles.find((x: any) => x.itemParam.label == label);
                scene.restoreParams(module, { [c.itemParam.address]: v });
            };
            const modulator = await add(100), carrier = await add(400);
            // fm 300 Hz, gain 0.6; fc 1000 Hz: I = 0.6 · 1000 / 300 = 2
            set(modulator, "Freq", 300);
            set(modulator, "Gain", 0.6);
            set(carrier, "Freq", 1000);
            const freq = scene.widgetsOf(scene.getModuleById(carrier)).find((w: any) => w.label == "Freq").address;
            const [mode] = scene.allowedModesOf(carrier, freq);
            await scene.modulate({ module: modulator, port: 0 }, carrier, freq, mode);
            const id = scene.patch.getModule(carrier).modulations[0].id;
            while (scene.getDepth(carrier, id) === undefined) await new Promise((r) => setTimeout(r, 20));
            const port = document.querySelector(".modulation-port") as HTMLElement;
            const node = scene.audioGraph.getNode(carrier);
            const ctx = node.context as AudioContext;
            await ctx.resume();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 32768;
            analyser.smoothingTimeConstant = 0;
            node.connect(analyser);
            await new Promise((r) => setTimeout(r, 1500));
            const db = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatFrequencyData(db);
            const peak = (hz: number) => {
                const bin = Math.round((hz * analyser.fftSize) / ctx.sampleRate);
                return Math.max(...Array.from(db.slice(bin - 3, bin + 4)));
            };
            return { mode, linear: port.classList.contains("modulation-linear"), deviation: scene.getDepth(carrier, id), carrier: peak(1000), upper: peak(1300), lower2: peak(400) };
        });
        expect(result.mode).toBe("linear");
        expect(result.linear).toBe(true);
        expect(result.deviation).toBe(1);
        // J1(2) / J0(2) = 0.5767 / 0.2239: +8.2 dB; J2(2) / J0(2) = 0.3528 / 0.2239: +3.9 dB
        expect(result.upper - result.carrier).toBeCloseTo(20 * Math.log10(0.5767 / 0.2239), 0);
        expect(result.lower2 - result.carrier).toBeCloseTo(20 * Math.log10(0.3528 / 0.2239), 0);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("adding a module or a modulation does not interrupt the sound of the others", async () => {
        const { page, errors } = await openApp();
        const result = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const code = 'process = vgroup("Level", 0.5);';
            await app.compileFaust({ name: "Level", sourceCode: code, x: 100, y: 100, callback: (f: any) => app.createModule(f, "Level", code, 100, 100) });
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            const level = scene.getModules()[0].moduleId;
            scene.patch.connect({ module: level, port: 0 }, { module: "output", port: 0 });
            const node = scene.audioGraph.getNode(level);
            const ctx = node.context as AudioContext;
            await ctx.resume();
            // a probe after the constant module: the samples that are not 0.5, and the frames it saw
            const probe = `registerProcessor("probe", class extends AudioWorkletProcessor {
                constructor() { super(); this.bad = 0; this.frames = 0; this.port.onmessage = () => { this.port.postMessage({ bad: this.bad, frames: this.frames }); this.bad = 0; this.frames = 0; }; }
                process(inputs) { const x = inputs[0][0]; if (x) { for (const v of x) if (Math.abs(v - 0.5) > 1e-6) this.bad++; this.frames += x.length; } return true; }
            });`;
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([probe], { type: "application/javascript" })));
            const tap = new AudioWorkletNode(ctx, "probe");
            const sink = ctx.createGain();
            sink.gain.value = 0;
            node.connect(tap).connect(sink).connect(ctx.destination);
            const read = () => new Promise<{ bad: number; frames: number }>((r) => { tap.port.onmessage = (e) => r(e.data); tap.port.postMessage(0); });
            const states: string[] = [];
            ctx.addEventListener("statechange", () => states.push(ctx.state));
            await new Promise((r) => setTimeout(r, 300));
            await read();
            const start = performance.now();
            // a module from the library, then a modulation (which recompiles the modulated module)
            const before = scene.getModules().length;
            app.uploadUrl(app, null, 400, 100, location.origin + "/faust-modules/modular/SineVCO.dsp");
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
            const vco = scene.getModules()[before].moduleId;
            const gain = scene.widgetsOf(scene.getModuleById(vco)).find((w: any) => w.label == "Gain").address;
            await scene.modulate({ module: level, port: 0 }, vco, gain, "modulate");
            await new Promise((r) => setTimeout(r, 700));
            const seen = await read();
            return { ...seen, expected: ((performance.now() - start) / 1000) * ctx.sampleRate, states, modulated: scene.patch.getModule(vco).modulations.length };
        });
        expect(result.modulated).toBe(1);
        expect(result.states).toEqual([]);                        // the context is never suspended
        expect(result.bad).toBe(0);                               // not a sample lost or changed
        expect(result.frames).toBeGreaterThan(0.9 * result.expected);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("recompiling a module (a modulation added) loses no sample, neither at the swap nor downstream", async () => {
        const { page, errors } = await openApp();
        const result = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const create = async (name: string, code: string, x: number) => {
                const before = scene.getModules().length;
                await app.compileFaust({ name, sourceCode: code, x, y: 100, callback: (f: any) => app.createModule(f, name, code, x, 100) });
                while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
                return scene.getModules()[before].moduleId as string;
            };
            // a constant 0.5 set by a slider, modulated by 0: the same value before and after
            const level = await create("Level", 'process = vgroup("Level", hslider("g", 0.5, 0, 1, 0.01));', 100);
            const zero = await create("Zero", 'process = vgroup("Zero", 0);', 400);
            scene.patch.connect({ module: level, port: 0 }, { module: "output", port: 0 });
            const ctx = scene.audioGraph.getNode(level).context as AudioContext;
            await ctx.resume();
            const probe = `registerProcessor("probe2", class extends AudioWorkletProcessor {
                constructor() { super(); this.bad = 0; this.frames = 0; this.port.onmessage = () => { this.port.postMessage({ bad: this.bad, frames: this.frames }); this.bad = 0; this.frames = 0; }; }
                process(inputs) { const x = inputs[0][0]; if (x) { for (const v of x) if (Math.abs(v - 0.5) > 1e-6) this.bad++; this.frames += x.length; } else this.bad += 128; return true; }
            });`;
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([probe], { type: "application/javascript" })));
            const tap = new AudioWorkletNode(ctx, "probe2");
            const sink = ctx.createGain();
            sink.gain.value = 0;
            tap.connect(sink).connect(ctx.destination);
            // the probe listens after the splitter of the module: what the other modules receive
            const listener = await create("Listen", 'process = vgroup("Listen", _);', 700);
            scene.patch.connect({ module: level, port: 0 }, { module: listener, port: 0 });
            scene.audioGraph.getNode(listener).connect(tap);
            await new Promise((r) => setTimeout(r, 400));
            const read = () => new Promise<{ bad: number; frames: number }>((r) => { tap.port.onmessage = (e) => r(e.data); tap.port.postMessage(0); });
            await read();
            const old = scene.audioGraph.getNode(level);
            const g = scene.widgetsOf(scene.getModuleById(level)).find((w: any) => w.label == "g").address;
            await scene.modulate({ module: zero, port: 0 }, level, g, "modulate");
            const replaced = scene.audioGraph.getNode(level) !== old;
            await new Promise((r) => setTimeout(r, 500));
            return { replaced, ...(await read()) };
        });
        expect(result.replaced).toBe(true);
        expect(result.frames).toBeGreaterThan(0);
        expect(result.bad).toBe(0);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);

    it("plays a sequenced voice: Clock, Sequencer, Quantizer, VCO, VCF, VCA and ADSR, in tune", async () => {
        const { page, errors } = await openApp();
        const add = (file: string, x: number, y: number) => page.evaluate(async ([f, xx, yy]) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const before = scene.getModules().length;
            app.uploadUrl(app, null, xx, yy, location.origin + "/faust-modules/modular/" + f);
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[before].moduleId as string;
        }, [file, x, y] as [string, number, number]);
        const clock = await add("Clock.dsp", 40, 80);
        const seq = await add("Sequencer.dsp", 300, 80);
        const quant = await add("Quantizer.dsp", 560, 80);
        const vco = await add("VCO.dsp", 820, 80);
        const vcf = await add("VCF.dsp", 560, 420);
        const vca = await add("VCA.dsp", 820, 420);
        const adsr = await add("ADSR.dsp", 300, 420);
        // one step, 7 semitones above C4: the Quantizer (C major) keeps G4, 392 Hz. The cables carry the
        // signals the modules transform (pitch through the Quantizer, audio); the controls are settings
        // driven by widget modulation: Clock → Sequencer Clock (driven), pitch → VCO Pitch (added),
        // gate → ADSR Gate (driven), envelope → VCA Gain (modulated, depth 1).
        const ports = await page.evaluate(async ([c, s, q, o, f, a, e]) => {
            const scene = (globalThis as any).faustPlayground.scene;
            const set = (m: string, label: string, v: number) => {
                const module = scene.getModuleById(m);
                const c = module.moduleControles.find((x: any) => x.itemParam.label == label);
                scene.restoreParams(module, { [c.itemParam.address]: v });
            };
            set(s, "Length", 1);
            set(s, "Step 1", 7);
            set(c, "Tempo", 240);
            set(e, "Release", 0.01);               // silent between the notes (a gate every 250 ms)
            const connect = (from: string, fp: number, to: string, tp: number) => scene.patch.connect({ module: from, port: fp }, { module: to, port: tp });
            const modulate = async (from: string, fp: number, to: string, label: string) => {
                const widget = scene.widgetsOf(scene.getModuleById(to)).find((w: any) => w.label == label);
                const [mode] = scene.allowedModesOf(to, widget.address);
                if (!(await scene.modulate({ module: from, port: fp }, to, widget.address, mode))) throw new Error(`${label}: not modulated`);
                return scene.patch.getModule(to).modulations.at(-1).id as string;
            };
            await modulate(c, 0, s, "Clock");
            connect(s, 0, q, 0);
            const pitch = await modulate(q, 0, o, "Pitch");
            connect(o, 2, f, 0);            // saw
            connect(f, 0, a, 0);
            await modulate(s, 1, e, "Gate");
            const gain = await modulate(e, 0, a, "Gain");
            while (scene.getDepth(a, gain) === undefined) await new Promise((r) => setTimeout(r, 20));
            scene.setDepth(a, gain, 1);
            connect(a, 0, "output", 0);
            while (scene.getDepth(o, pitch) === undefined) await new Promise((r) => setTimeout(r, 20));
            const modes = Array.from(document.querySelectorAll(".modulation-port")).map((p: any) => p.className.match(/modulation-(add|modulate|drive|scale)\b/)[1]).sort();
            return { modes, pitch: scene.getDepth(o, pitch), gain: scene.getDepth(a, gain) };
        }, [clock, seq, quant, vco, vcf, vca, adsr]);
        expect(ports).toEqual({ modes: ["add", "drive", "drive", "modulate"], pitch: 1, gain: 1 });
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.audioGraph.getNode("output").context.resume());
        // the sine of the VCO: its frequency
        const hz = await page.evaluate(async (o) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(o);
            const ctx = node.context as AudioContext;
            const split = ctx.createChannelSplitter(4);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 32768;
            node.connect(split);
            split.connect(analyser, 0);
            await new Promise((r) => setTimeout(r, 1200));
            const x = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(x);
            const crossings: number[] = [];
            for (let t = 1; t < x.length; t++) if (x[t - 1] < 0 && x[t] >= 0) crossings.push(t - 1 + x[t - 1] / (x[t - 1] - x[t]));
            return (ctx.sampleRate * (crossings.length - 1)) / (crossings[crossings.length - 1] - crossings[0]);
        }, vco);
        console.log("GUITAR", hz, 1200 * Math.log2(hz / (261.6256 * 2 ** (7 / 12))));
        expect(Math.abs(1200 * Math.log2(hz / (261.6256 * 2 ** (7 / 12))))).toBeLessThan(5);
        // the VCA opens and closes with the envelope: the output level varies between quiet and loud
        const levels = await page.evaluate(async (a) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(a);
            const analyser = node.context.createAnalyser();
            analyser.fftSize = 1024;
            node.connect(analyser);
            const out: number[] = [];
            const x = new Float32Array(analyser.fftSize);
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 25));
                analyser.getFloatTimeDomainData(x);
                out.push(Math.sqrt(x.reduce((s: number, v: number) => s + v * v, 0) / x.length));
            }
            return out;
        }, vca);
        expect(Math.max(...levels)).toBeGreaterThan(0.05);
        expect(Math.min(...levels)).toBeLessThan(Math.max(...levels) / 2);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});

