// The load meter (src/audio/DspMeter.ts): the statistical estimate of the time spent by the processors, from a 1 ms
// clock, checked where the truth is known: a processor overloading the audio thread, which is then busy all the
// time, so that the load (time spent over the audio rendered) is the inverse of the pace of the context
// (its currentTime over the time of the page). Idle, it is about 0; lightly loaded, the context keeps its pace.
// The dropouts (playbackStats) turn the indicator red.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
    server = await createServer({ root: path.resolve(__dirname, "../.."), server: { port: 0 }, logLevel: "error" });
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

// A processor that computes `iterations` steps per block of 128 frames; asked, the number of steps it computes in
// a millisecond on the audio thread (over 300 ms).
const LOADER = `
const step = (x) => Math.sin(x * 1.0001 + 0.3);
class Loader extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.n = options.processorOptions.iterations;
        this.x = 0.5;
        this.port.onmessage = () => {
            let x = 0.5, n = 0;
            const t0 = Date.now();
            while (Date.now() - t0 < 300) { for (let i = 0; i < 10000; i++) x = step(x); n += 10000; }
            this.port.postMessage({ perMs: n / (Date.now() - t0), x });
        };
    }
    process(inputs, outputs) {
        let x = this.x;
        for (let i = 0; i < this.n; i++) x = step(x);
        this.x = x;
        outputs[0][0].fill(x * 1e-9);
        return true;
    }
}
registerProcessor("test-loader", Loader);
`;

describe("the load of the audio thread", () => {
    it("is 0 idle, the inverse of the pace when overloaded; shown in the toolbar, red on dropouts", async () => {
        const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.audioGraph.getNode("output")?.context.resume());
        // the indicator, once a report came
        await expect.poll(() => page.evaluate(() => document.getElementById("dspMeter")?.textContent), { timeout: 10_000 }).toMatch(/^DSP \d+ %$/);

        const results = await page.evaluate(async (code) => {
            const ctx = (globalThis as any).faustPlayground.scene.audioGraph.getNode("output").context as AudioContext;
            const meter = (globalThis as any).faustmodular.dspMeter;
            const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
            const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
            await ctx.audioWorklet.addModule(url);
            const probe = new AudioWorkletNode(ctx, "test-loader", { processorOptions: { iterations: 0 } });
            const perMs: number = await new Promise((resolve) => {
                probe.port.onmessage = (e) => resolve(e.data.perMs);
                probe.port.postMessage("cost");
            });
            const block = 128 / ctx.sampleRate * 1000;              // ms
            await wait(3000);
            const out: Array<{ nominal: number; load: number; pace: number }> = [{ nominal: 0, load: meter.load, pace: 1 }];
            for (const nominal of [0.1, 1.5]) {
                const node = new AudioWorkletNode(ctx, "test-loader", { processorOptions: { iterations: Math.round(perMs * block * nominal) } });
                node.connect(ctx.destination);
                await wait(1500);
                const t0 = [ctx.currentTime, performance.now()];
                await wait(5000);
                const pace = (ctx.currentTime - t0[0]) / ((performance.now() - t0[1]) / 1000);
                out.push({ nominal, load: meter.load, pace });
                if (nominal > 1) out.push({ nominal: -1, load: Number(meter.reportsDropouts), pace: meter.level == "dropouts" ? 1 : 0 });
                node.disconnect();
            }
            return out;
        }, LOADER);
        console.log(results);
        const [idle, light, overloaded, dropouts] = results;
        expect(idle.load).toBeLessThan(0.05);
        expect(light.pace).toBeGreaterThan(0.98);
        expect(light.load).toBeGreaterThan(0.05);
        expect(light.load).toBeLessThan(0.6);
        // overloaded: the thread is busy all the time; the native nodes outside the processors are not counted
        expect(overloaded.pace).toBeLessThan(0.9);
        expect(overloaded.load * overloaded.pace).toBeGreaterThan(0.75);
        expect(overloaded.load * overloaded.pace).toBeLessThan(1.1);
        if (dropouts.load) expect(dropouts.pace).toBe(1);       // red, where the browser reports the dropouts
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
