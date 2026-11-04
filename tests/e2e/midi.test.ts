// The MIDI devices in the application (src/midi/MidiModules.ts), with a fake Web MIDI device: not asked for at
// load; asked for when a MIDI to CV module is added; its notes set the outputs of the module (pitch, gate,
// velocity), on its channel only; a browser without Web MIDI says so. Its clock drives a MIDI Clock module: a gate
// per sixteenth note at its tempo, the run, and no clock when it stops.
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

// The page with a fake MIDI keyboard (window.__midi(bytes) plays a message), or without Web MIDI.
async function open(midi: boolean): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "en-US" });
    await context.addInitScript((withMidi) => {
        const w = window as any;
        w.__midiRequests = 0;
        if (!withMidi) {
            delete (Navigator.prototype as any).requestMIDIAccess;
            return;
        }
        const input: any = { id: "fake", name: "Fake keyboard", onmidimessage: null };
        (navigator as any).requestMIDIAccess = async () => {
            w.__midiRequests++;
            return { inputs: new Map([["fake", input]]), outputs: new Map(), onstatechange: null };
        };
        w.__midi = (data: number[]) => input.onmidimessage?.({ data: new Uint8Array(data), timeStamp: performance.now() });
    }, midi);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    return { context, page, errors };
}

const addMidiCV = (page: Page) => page.evaluate(async () => {
    const { app, scene } = (globalThis as any).faustPlayground;
    app.uploadUrl(app, null, 300, 150, location.origin + "/faust-modules/modular/MidiCV.dsp");
    while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
    return scene.getModules()[0].moduleId as string;
});

describe("MIDI to CV in the application", () => {
    it("asks for MIDI when the module is added, and plays its outputs from the notes, on its channel", async () => {
        const { context, page, errors } = await open(true);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => [(window as any).__midiRequests, (globalThis as any).faustPlayground.scene.midi.state])).toEqual([0, "idle"]);
        const id = await addMidiCV(page);
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.midi.state == "on");
        expect(await page.evaluate(() => (window as any).__midiRequests)).toBe(1);
        // the outputs of the module, read by a probe (the last sample of each channel)
        await page.evaluate(async (m) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(m);
            const ctx = node.context as AudioContext;
            await ctx.resume();
            const code = `registerProcessor("last", class extends AudioWorkletProcessor {
                constructor() { super(); this.last = []; this.port.onmessage = () => this.port.postMessage(this.last); }
                process(inputs) { this.last = inputs[0].map((ch) => ch[ch.length - 1]); return true; }
            });`;
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
            const probe = new AudioWorkletNode(ctx, "last", { channelCount: 5, channelCountMode: "explicit", channelInterpretation: "discrete" });
            const sink = ctx.createGain();
            sink.gain.value = 0;
            probe.connect(sink).connect(ctx.destination);
            node.connect(probe);
            (window as any).__outputs = () => new Promise((r) => { probe.port.onmessage = (e) => r(e.data); probe.port.postMessage(0); });
        }, id);
        const outputs = async () => { await page.waitForTimeout(250); return page.evaluate(() => (window as any).__outputs()) as Promise<number[]>; };
        await page.evaluate(() => (window as any).__midi([0x90, 64, 100]));
        let [pitch, gate, velocity] = await outputs();
        expect(pitch).toBeCloseTo(4 / 120, 4);
        expect(gate).toBe(1);
        expect(velocity).toBeCloseTo(100 / 127, 3);
        // the note shown
        expect(await page.locator(".control-group", { hasText: "Note" }).count()).toBeGreaterThan(0);
        await page.evaluate(() => (window as any).__midi([0x80, 64, 0]));
        [pitch, gate] = await outputs();
        expect(gate).toBe(0);
        expect(pitch).toBeCloseTo(4 / 120, 4);            // the pitch stays on the note released
        // channel 2 only: a note on channel 1 is not played
        await page.evaluate((m) => {
            const scene = (globalThis as any).faustPlayground.scene;
            const module = scene.getModuleById(m);
            const channel = module.moduleControles.find((c: any) => c.itemParam.label == "Channel");
            scene.restoreParams(module, { [channel.itemParam.address]: 2 });
        }, id);
        await page.evaluate(() => (window as any).__midi([0x90, 72, 100]));
        [pitch, gate] = await outputs();
        expect(gate).toBe(0);
        await page.evaluate(() => (window as any).__midi([0x91, 72, 100]));
        [pitch, gate] = await outputs();
        expect(gate).toBe(1);
        expect(pitch).toBeCloseTo(12 / 120, 4);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("follows the MIDI clock with a MIDI Clock module: a gate per sixteenth note, the run, the tempo", async () => {
        const { context, page, errors } = await open(true);
        const id = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            app.uploadUrl(app, null, 300, 150, location.origin + "/faust-modules/modular/MidiClock.dsp");
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[0].moduleId as string;
        });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.midi.state == "on");
        // a probe on the outputs: the rising edges of the clock, the last values (clock, reset, run)
        await page.evaluate(async (m) => {
            const node = (globalThis as any).faustPlayground.scene.audioGraph.getNode(m);
            const ctx = node.context as AudioContext;
            await ctx.resume();
            const code = `registerProcessor("edges", class extends AudioWorkletProcessor {
                constructor() { super(); this.edges = 0; this.prev = 0; this.last = []; this.port.onmessage = () => this.port.postMessage({ edges: this.edges, last: this.last }); }
                process(inputs) { const c = inputs[0][0]; if (c) for (const v of c) { if (v > 0.5 && this.prev <= 0.5) this.edges++; this.prev = v; } this.last = inputs[0].map((ch) => ch[ch.length - 1]); return true; }
            });`;
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
            const probe = new AudioWorkletNode(ctx, "edges", { channelCount: 3, channelCountMode: "explicit", channelInterpretation: "discrete" });
            const sink = ctx.createGain();
            sink.gain.value = 0;
            probe.connect(sink).connect(ctx.destination);
            node.connect(probe);
            (window as any).__probe = () => new Promise((r) => { probe.port.onmessage = (e) => r(e.data); probe.port.postMessage(0); });
        }, id);
        // Start, then 48 clock messages at 120 BPM (two beats: 8 sixteenth notes)
        await page.evaluate(async () => {
            const midi = (window as any).__midi;
            midi([0xfa]);
            for (let i = 0; i < 48; i++) {
                midi([0xf8]);
                await new Promise((r) => setTimeout(r, 60000 / 120 / 24));
            }
        });
        await page.waitForTimeout(100);
        const playing = await page.evaluate(() => (window as any).__probe()) as { edges: number; last: number[] };
        expect(playing.edges).toBeGreaterThanOrEqual(7);
        expect(playing.edges).toBeLessThanOrEqual(8);
        expect(playing.last[2]).toBe(1);                            // run
        const tempo = await page.evaluate(() => (globalThis as any).faustPlayground.scene.midi.clock.tempo);
        expect(Math.abs(tempo - 120)).toBeLessThan(15);             // timers of a loaded page: approximate
        // Stop: run 0; no more clock: tempo 0
        await page.evaluate(() => (window as any).__midi([0xfc]));
        await page.waitForTimeout(200);
        expect((await page.evaluate(() => (window as any).__probe()) as any).last[2]).toBe(0);
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.midi.clock.tempo == 0, null, { timeout: 5000 });
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("says when the browser has no Web MIDI", async () => {
        const { context, page, errors } = await open(false);
        await addMidiCV(page);
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.midi.state == "unavailable");
        expect(await page.locator(".messageContainer").first().textContent()).toContain("Web MIDI");
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
