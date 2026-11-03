// The volume of the scene (src/audio/MasterVolume.ts, src/view/VolumeControl.ts) on the icon of the output module:
// a vertical drag on the icon sets it (Shift: fine), its brightness shows it, the signal sent to the device is
// scaled by (v / 100)²; it is remembered by the browser after a reload; a double click mutes the scene by the
// gain (the audio keeps running); the edge of the module still moves it. The safety limiter after it: transparent
// under −1 dBFS, a peak brought down to −1 dBFS, NaN silenced, its action shown on the speaker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";
import { clampVolume, LIMIT_CEILING, volumeGain } from "../../src/audio/MasterVolume";

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

const volume = (page: Page) => page.evaluate(() => {
    const scene = (globalThis as any).faustPlayground.scene;
    const icon = document.querySelector("#moduleOutput .volume-icon") as HTMLElement;
    return {
        volume: scene.masterVolume.volume as number,
        muted: scene.masterVolume.muted as boolean,
        target: scene.masterVolume.gain() as number,
        gain: scene.masterVolume.node.gain.value as number,
        state: scene.masterVolume.node.context.state as string,
        opacity: Number(icon.style.opacity),
        crossed: icon.classList.contains("muted"),
        x: scene.getAudioOutput().moduleView.x as number,
        stored: localStorage.getItem("faustmodular-volume"),
    };
});

// A vertical drag on the icon of the output module, by dy pixels (down: lower).
async function dragIcon(page: Page, dy: number, shift = false): Promise<boolean> {
    const box = (await page.locator("#moduleOutput .volume-icon").boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy / 2, { steps: 4 });
    await page.mouse.move(x, y + dy, { steps: 4 });
    const labelShown = await page.evaluate(() => getComputedStyle(document.querySelector("#moduleOutput .volume-label")!).opacity != "0"
        && document.querySelector("#moduleOutput .content")!.classList.contains("adjusting-volume"));
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
    return labelShown;
}

describe("volume of the scene", () => {
    it("has a perceptual curve, from 0 to 100 %", () => {
        expect(volumeGain(100)).toBe(1);
        expect(volumeGain(50)).toBeCloseTo(0.25, 12);
        expect(volumeGain(0)).toBe(0);
        expect(volumeGain(140)).toBe(1);
        expect(clampVolume(-3)).toBe(0);
        expect(clampVolume(42.04)).toBe(42);
    });

    it("is set by a vertical drag on the icon, shown by its brightness, remembered after a reload", async () => {
        const { context, page, errors } = await open();
        const start = await volume(page);
        expect(start.volume).toBe(100);
        expect(start.gain).toBe(1);
        expect(start.opacity).toBe(1);

        // down 60 px: 40 %, a label while it is set; the module did not move
        expect(await dragIcon(page, 60)).toBe(true);
        await page.waitForTimeout(200);
        let v = await volume(page);
        expect(v.volume).toBe(40);
        expect(v.target).toBeCloseTo(0.16, 6);
        expect(v.gain).toBeCloseTo(0.16, 2);
        expect(v.opacity).toBeCloseTo(0.25 + 0.75 * 0.4, 6);
        expect(v.x).toBe(start.x);
        expect(v.stored).toBe("40");
        expect(await page.locator("#moduleOutput .volume-icon").getAttribute("title")).toContain("40 %");

        // with Shift, 0.1 % per pixel: up 50 px gives 45 %
        await dragIcon(page, -50, true);
        expect((await volume(page)).volume).toBe(45);
        // bounded: down far gives 0 %, the crossed icon
        await dragIcon(page, 400);
        v = await volume(page);
        expect(v.volume).toBe(0);
        expect(v.crossed).toBe(true);
        await dragIcon(page, -45);
        expect((await volume(page)).volume).toBe(45);

        // a reload: the volume of the browser, not of the scene
        await page.close();
        const again = await open(context);
        v = await volume(again.page);
        expect(v.volume).toBe(45);
        expect(v.gain).toBeCloseTo(volumeGain(45), 6);
        expect(errors).toEqual([]);
        expect(again.errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("scales the signal sent to the device by (v / 100)²", async () => {
        const { context, page, errors } = await open();
        const result = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const before = scene.getModules().length;
            const code = 'process = vgroup("Half", 0.5);';
            await app.compileFaust({ name: "Half", sourceCode: code, x: 300, y: 100, callback: (f: any) => app.createModule(f, "Half", code, 300, 100) });
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
            const id = scene.getModules()[before].moduleId;
            scene.patch.connect({ module: id, port: 0 }, { module: "output", port: 0 });
            const ctx = scene.masterVolume.node.context as AudioContext;
            await ctx.resume();
            const probe = `registerProcessor("level", class extends AudioWorkletProcessor {
                constructor() { super(); this.peak = 0; this.port.onmessage = () => { this.port.postMessage(this.peak); this.peak = 0; }; }
                process(inputs) { const x = inputs[0][0]; if (x) for (const v of x) this.peak = Math.max(this.peak, Math.abs(v)); return true; }
            });`;
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([probe], { type: "application/javascript" })));
            const tap = new AudioWorkletNode(ctx, "level");
            const sink = ctx.createGain();
            sink.gain.value = 0;
            tap.connect(sink).connect(ctx.destination);
            scene.masterVolume.node.connect(tap);
            const read = () => new Promise<number>((r) => { tap.port.onmessage = (e) => r(e.data); tap.port.postMessage(0); });
            const settle = async () => { await new Promise((r) => setTimeout(r, 300)); await read(); await new Promise((r) => setTimeout(r, 200)); return read(); };
            const full = await settle();
            scene.masterVolume.setVolume(50);
            const half = await settle();
            scene.masterVolume.setMuted(true);
            const muted = await settle();
            return { full, half, muted, state: ctx.state };
        });
        expect(result.full).toBeCloseTo(0.5, 4);
        expect(result.half).toBeCloseTo(0.125, 4);
        expect(result.muted).toBeLessThan(1e-4);
        expect(result.state).toBe("running");
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("is muted by a double click, the audio running; the edge of the module moves it", async () => {
        const { context, page, errors } = await open();
        await dragIcon(page, 30);
        await page.dblclick("#moduleOutput .volume-icon");
        await page.waitForTimeout(200);
        let v = await volume(page);
        expect(v.muted).toBe(true);
        expect(v.volume).toBe(70);
        expect(v.gain).toBeLessThan(1e-3);
        expect(v.state).toBe("running");
        expect(v.crossed).toBe(true);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.isMute)).toBe(true);
        await page.dblclick("#moduleOutput .volume-icon");
        await page.waitForTimeout(200);
        v = await volume(page);
        expect(v.muted).toBe(false);
        expect(v.gain).toBeCloseTo(volumeGain(70), 2);
        expect(v.crossed).toBe(false);

        // the edge, around the icon: a move of the module, not of the volume
        const box = (await page.locator("#moduleOutput").boundingBox())!;
        await page.mouse.move(box.x + 4, box.y + 4);
        await page.mouse.down();
        await page.mouse.move(box.x - 100, box.y + 4, { steps: 5 });
        await page.mouse.up();
        const moved = await volume(page);
        expect(moved.x).toBeLessThan(v.x - 90);
        expect(moved.volume).toBe(70);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
    it("is followed by a safety limiter: transparent under −1 dBFS, peaks brought down, NaN silenced", async () => {
        const { context, page, errors } = await open();
        const result = await page.evaluate(async () => {
            const { scene } = (globalThis as any).faustPlayground;
            const volume = scene.masterVolume;
            if (!(await volume.ready)) return null;
            const ctx = volume.node.context as AudioContext;
            await ctx.resume();
            // a source of a level set by a message (NaN included), into the volume (in place of the modules)
            const code = `registerProcessor("source", class extends AudioWorkletProcessor {
                constructor() { super(); this.level = 0; this.port.onmessage = (e) => { this.level = e.data; }; }
                process(inputs, outputs) { for (const ch of outputs[0]) ch.fill(this.level); return true; }
            });
            registerProcessor("peak", class extends AudioWorkletProcessor {
                constructor() { super(); this.peak = 0; this.bad = 0; this.port.onmessage = () => { this.port.postMessage({ peak: this.peak, bad: this.bad }); this.peak = 0; this.bad = 0; }; }
                process(inputs) { for (const ch of inputs[0]) for (const v of ch) { if (!Number.isFinite(v)) this.bad++; else this.peak = Math.max(this.peak, Math.abs(v)); } return true; }
            });`;
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
            const source = new AudioWorkletNode(ctx, "source", { outputChannelCount: [2] });
            const tap = new AudioWorkletNode(ctx, "peak");
            const sink = ctx.createGain();
            sink.gain.value = 0;
            tap.connect(sink).connect(ctx.destination);
            source.connect(volume.node);
            volume.limiter.connect(tap);
            const read = () => new Promise<{ peak: number; bad: number }>((r) => { tap.port.onmessage = (e) => r(e.data); tap.port.postMessage(0); });
            const level = async (x: number) => { source.port.postMessage(x); await new Promise((r) => setTimeout(r, 300)); await read(); await new Promise((r) => setTimeout(r, 300)); return read(); };
            const quiet = await level(0.5);
            const loud = await level(4);
            const glowing = document.querySelector("#moduleOutput .volume-icon")!.classList.contains("limiting");
            const nan = await level(NaN);
            const back = await level(0.5);
            return { quiet, loud, glowing, nan, back };
        });
        expect(result).not.toBeNull();
        expect(result!.quiet.peak).toBeCloseTo(0.5, 6);      // transparent: exactly the input
        expect(result!.loud.peak).toBeLessThanOrEqual(LIMIT_CEILING + 1e-6);
        expect(result!.loud.peak).toBeGreaterThan(LIMIT_CEILING - 0.01);
        expect(result!.glowing).toBe(true);
        expect(result!.nan).toEqual({ peak: 0, bad: 0 });
        expect(result!.back.peak).toBeCloseTo(0.5, 3);       // the gain came back
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
