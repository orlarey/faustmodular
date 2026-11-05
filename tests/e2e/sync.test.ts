// faust-sync between two faustmodular tabs (Documentation/FAUST-SYNC-SPEC.md, § 1.1): A plays with a Sync Clock
// module, B opens later and joins; their clock gates, as the common times at which they come out of the speaker,
// coincide. B changes the tempo, A follows; A stops, B stops; a modulation on the Sync Clock keeps its reserved
// inputs. (Headless Chromium has no sound card: the criterion of 1 ms is to be checked on a computer.)
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

// A tab with a Sync Clock and a probe of its gates (window.__edges(): the common times of the rising edges since the
// last call).
async function open(context: BrowserContext): Promise<{ page: Page; errors: string[]; id: string }> {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.scene?.sync && (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    const id = await page.evaluate(async () => {
        const { app, scene } = (globalThis as any).faustPlayground;
        app.uploadUrl(app, null, 300, 150, location.origin + "/faust-modules/modular/SyncClock.dsp");
        while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
        const id = scene.getModules()[0].moduleId;
        const node = scene.audioGraph.getNode(id);
        const ac = node.context as AudioContext;
        await ac.resume();
        const code = `registerProcessor("edges", class extends AudioWorkletProcessor {
            constructor() { super(); this.prev = 0; this.edges = []; this.port.onmessage = () => { this.port.postMessage(this.edges); this.edges = []; }; }
            process(inputs) { const c = inputs[0][0]; if (c) for (let i = 0; i < c.length; i++) { if (c[i] > 0.5 && this.prev <= 0.5) this.edges.push(currentFrame + i); this.prev = c[i]; } return true; }
        });`;
        await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
        const probe = new AudioWorkletNode(ac, "edges", { channelCount: 3, channelCountMode: "explicit", channelInterpretation: "discrete" });
        const sink = ac.createGain();
        sink.gain.value = 0;
        probe.connect(sink).connect(ac.destination);
        (window as any).__probe = probe;
        (window as any).__edges = () => new Promise((r) => {
            probe.port.onmessage = (e) => {
                const sync = scene.sync, sr = ac.sampleRate;
                const offset = sync.frameOf(0) / sr * 1000 + performance.timeOrigin;      // frameOf inverted
                r(e.data.map((f: number) => f / sr * 1000 + performance.timeOrigin - offset));
            };
            probe.port.postMessage(0);
        });
        return id as string;
    });
    // the probe on the clock output of the module (its node may be replaced: connected again)
    await page.evaluate((m) => { const s = (globalThis as any).faustPlayground.scene; s.audioGraph.getNode(m).connect((window as any).__probe); }, id);
    return { page, errors, id };
}

const timeline = (page: Page) => page.evaluate(() => { const t = (globalThis as any).faustPlayground.scene.sync.timeline; return { playing: t.playing, tempo: t.tempo }; });

describe("faust-sync between two faustmodular", () => {
    it("aligns the gates of a tab opened while the other plays; shares the tempo and the stop", async () => {
        const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: "en-US" });
        const A = await open(context);
        await A.page.waitForTimeout(500);
        // A plays from its transport
        await A.page.locator("#transport .transportPlay").click();
        await A.page.waitForTimeout(2000);
        const B = await open(context);
        await B.page.waitForFunction(() => (globalThis as any).faustPlayground.scene.sync.timeline.playing, null, { timeout: 5000 });
        await B.page.waitForTimeout(1500);
        await A.page.evaluate(() => (window as any).__edges());
        await B.page.evaluate(() => (window as any).__edges());
        await A.page.waitForTimeout(3000);
        const [ea, eb] = [await A.page.evaluate(() => (window as any).__edges()), await B.page.evaluate(() => (window as any).__edges())] as number[][];
        expect(ea.length).toBeGreaterThanOrEqual(20);                  // 8 sixteenth notes per second at 120
        expect(Math.abs(eb.length - ea.length)).toBeLessThanOrEqual(1);
        const gaps = eb.map((e) => Math.min(...ea.map((a) => Math.abs(e - a)))).sort((x, y) => x - y);
        expect(gaps[gaps.length >> 1]).toBeLessThan(2);                // the median gap, ms
        // B's transport shows the playing; B changes the tempo, A follows
        expect(await B.page.locator("#transport").getAttribute("class")).toContain("playing");
        await B.page.locator("#transport .transportTempo").fill("90");
        await B.page.locator("#transport .transportTempo").press("Enter");
        await A.page.waitForFunction(() => (globalThis as any).faustPlayground.scene.sync.timeline.tempo == 90, null, { timeout: 2000 });
        expect(await A.page.locator("#transport .transportTempo").inputValue()).toBe("90");
        // A stops: B stops
        await A.page.locator("#transport .transportPlay").click();
        await B.page.waitForFunction(() => !(globalThis as any).faustPlayground.scene.sync.timeline.playing, null, { timeout: 2000 });
        expect(await timeline(B.page)).toEqual({ playing: false, tempo: 90 });
        expect([...A.errors, ...B.errors]).toEqual([]);
        await context.close();
    }, 180_000);

    it("keeps the reserved inputs of a Sync Clock modulated by an LFO", async () => {
        const context = await browser.newContext({ viewport: { width: 1300, height: 800 }, locale: "en-US" });
        const A = await open(context);
        await A.page.evaluate(async (m) => {
            const { app, scene } = (globalThis as any).faustPlayground;
            app.uploadUrl(app, null, 300, 500, location.origin + "/faust-modules/modular/LFO.dsp");
            while (scene.getModules().length < 2) await new Promise((r) => setTimeout(r, 20));
            const lfo = scene.getModules()[1].moduleId;
            const widget = scene.widgetsOf(scene.getModuleById(m)).find((w: any) => w.label == "Width");
            await scene.modulate({ module: lfo, port: 0 }, m, widget.address, scene.allowedModesOf(m, widget.address)[0]);
            scene.audioGraph.getNode(m).connect((window as any).__probe);
            scene.sync.operate({ type: "play" });
        }, A.id);
        expect(await A.page.evaluate((m) => (globalThis as any).faustPlayground.scene.patch.getModule(m).numInputs, A.id)).toBe(0);
        await A.page.waitForTimeout(500);
        await A.page.evaluate(() => (window as any).__edges());
        await A.page.waitForTimeout(2000);
        const edges = await A.page.evaluate(() => (window as any).__edges()) as number[];
        expect(edges.length).toBeGreaterThanOrEqual(14);
        expect(A.errors).toEqual([]);
        await context.close();
    }, 180_000);
});
