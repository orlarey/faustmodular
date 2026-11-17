// The Scope over a long duration (src/Modules/Displays.ts, Sweep): an envelope fired every second, seen over 900 ms,
// stands still: every image starts on its attack, after the pre-trigger, instead of scrolling.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser } from "playwright";
import { createServer, ViteDevServer } from "vite";
import fs from "fs";
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

const SCOPE = fs.readFileSync(path.resolve(__dirname, "../../public/faust-modules/display/Scope.dsp"), "utf8");

describe("the Scope over a long duration", () => {
    it("triggers an envelope at 60 bpm: the attack always at the same place, the image does not scroll", async () => {
        const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        const [env, scope] = await page.evaluate(async (scopeCode) => {
            const s = (globalThis as any).faustPlayground.scene;
            const env = (await s.addModuleFromCode("Env", 'import("stdfaust.lib");\nprocess = ba.pulse(ma.SR) : en.ar(0.01, 0.3);', { x: 100, y: 200 })).moduleId;
            const scope = (await s.addModuleFromCode("Scope", scopeCode, { x: 450, y: 150 })).moduleId;
            s.patch.connect({ module: env, port: 0 }, { module: scope, port: 0 });
            s.patch.connect({ module: scope, port: 0 }, { module: "output", port: 0 });
            await s.audioGraph.getNode("output")?.context.resume();
            const m = s.getModuleById(scope);
            const set = (label: string, v: number) => {
                const c = m.moduleControles.find((c: any) => c.itemParam.label == label);
                m.moduleFaust.getDSP().setParamValue(c.itemParam.address, v);
                c.value = String(v);
            };
            set("Time", 900);
            set("Threshold", 0.5);
            return [env, scope];
        }, SCOPE);
        expect(env).toBeTruthy();
        // the attack of each complete image: the first column above the threshold
        const attacks: number[] = [];
        for (let k = 0; k < 60 && attacks.length < 5; k++) {
            await page.waitForTimeout(250);
            const image = await page.evaluate((id) => {
                const sweep = (globalThis as any).faustPlayground.scene.getModuleById(id).displays.fSweep;
                return sweep && !sweep.sweeping && sweep.image.length >= sweep.width ? { image: sweep.image, pre: sweep.pre } : null;
            }, scope);
            if (!image) continue;
            const attack = image.image.findIndex((c: [number, number] | null) => c && c[1] > 0.5);
            attacks.push(attack - image.pre);
        }
        // the first image may start before the first crossing (Trigger auto: free run); then each one on the attack
        expect(attacks.length).toBeGreaterThanOrEqual(4);
        expect(attacks.slice(1).every((d) => d == 0)).toBe(true);
        expect(errors).toEqual([]);
        await page.close();
    }, 120_000);
});
