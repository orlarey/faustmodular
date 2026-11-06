// What the application does when it opens: no request to another site (no Google API, no export service),
// no microphone asked for; the microphone is asked for on demand, by a cable drawn from the input module or
// by a click on it, and the input module shows its state. The scene of the first visit: a SineVCO to the
// outputs, played by its gate, replaced as an empty scene while it is not modified. The search of the Modules
// menu, from the keyboard.
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

// The page, the hosts it asked for, and the number of calls of getUserMedia.
async function open(query = "", reuse?: BrowserContext): Promise<{ context: BrowserContext; page: Page; hosts: Set<string>; errors: string[] }> {
    const context = reuse ?? await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addInitScript(() => {
        const w = window as any;
        w.__microphone = 0;
        const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => { w.__microphone++; return get(constraints); };
    });
    const page = await context.newPage();
    const hosts = new Set<string>();
    const errors: string[] = [];
    page.on("request", (r) => { const u = new URL(r.url()); if (u.protocol.startsWith("http")) hosts.add(u.host); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + query);
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    return { context, page, hosts, errors };
}

const microphone = (page: Page) => page.evaluate(() => ({
    calls: (window as any).__microphone as number,
    state: (globalThis as any).faustPlayground.scene.audioInputState as string,
    shown: document.querySelector("#moduleInput")!.getAttribute("data-microphone"),
    outputs: (globalThis as any).faustPlayground.scene.patch.getModule("input").numOutputs as number,
}));

describe("startup", () => {
    it("asks no other site and no microphone", async () => {
        const { context, page, hosts, errors } = await open();
        await page.waitForTimeout(1500);
        expect([...hosts]).toEqual([new URL(url).host]);
        expect(await microphone(page)).toMatchObject({ calls: 0, state: "idle", shown: "idle" });
        expect(await page.locator(".messageContainer").count()).toBe(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 60_000);

    it("asks for the microphone when a cable leaves the input module", async () => {
        const { context, page, errors } = await open();
        const id = await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            const before = scene.getModules().length;
            const code = 'process = vgroup("Thru", _);';
            await app.compileFaust({ name: "Thru", sourceCode: code, x: 400, y: 200, callback: (f: any) => app.createModule(f, "Thru", code, 400, 200) });
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
            return scene.getModules()[before].moduleId as string;
        });
        expect((await microphone(page)).calls).toBe(0);
        await page.evaluate((m) => (globalThis as any).faustPlayground.scene.patch.connect({ module: "input", port: 0 }, { module: m, port: 0 }), id);
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.audioInputState == "on");
        const m = await microphone(page);
        expect(m).toMatchObject({ calls: 1, state: "on", shown: "on" });
        expect(m.outputs).toBeGreaterThanOrEqual(1);
        // asked once: another cable asks nothing
        await page.evaluate((mm) => (globalThis as any).faustPlayground.scene.patch.connect({ module: "input", port: 0 }, { module: mm, port: 0 }), id).catch(() => { });
        expect((await microphone(page)).calls).toBe(1);
        // the last cable removed: the microphone closed (its tracks stopped), a moment later
        await page.evaluate(() => {
            const { scene } = (globalThis as any).faustPlayground;
            const tracks = (scene as any).fMicrophone.getTracks();
            (window as any).__tracks = tracks;
            scene.patch.connectionsFrom("input").forEach((c: any) => scene.patch.disconnect(c.id));
        });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.audioInputState == "idle", null, { timeout: 5000 });
        expect(await page.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState == "ended"))).toBe(true);
        expect(await microphone(page)).toMatchObject({ state: "idle", shown: "idle" });
        expect(errors).toEqual([]);
        await context.close();
    }, 60_000);

    it("asks for the microphone on a click on the input module, not on a move of it", async () => {
        const { context, page, errors } = await open();
        const box = (await page.locator("#moduleInput").boundingBox())!;
        // a move: no microphone
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
        await page.mouse.up();
        expect((await microphone(page)).calls).toBe(0);
        const moved = (await page.locator("#moduleInput").boundingBox())!;
        await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2);
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.audioInputState == "on");
        expect(await microphone(page)).toMatchObject({ calls: 1, state: "on", shown: "on" });
        // a click again, no cable from it: off
        await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2);
        expect(await microphone(page)).toMatchObject({ state: "idle", shown: "idle" });
        expect(errors).toEqual([]);
        await context.close();
    }, 60_000);
});

describe("search of the modules", () => {
    it("is ready when the Modules menu opens: typing lists the matches, Enter adds the one chosen, Escape clears", async () => {
        const { context, page, errors } = await open();
        await page.getByText("Modules", { exact: true }).first().click();
        expect(await page.evaluate(() => document.activeElement?.id)).toBe("librarySearch");
        await page.keyboard.type("moog");
        const results = () => page.locator("#libraryModules .librarySearchResult a").allTextContents();
        expect(await results()).toEqual(expect.arrayContaining(["Moog VCF", "Moog Ladder"]));
        expect(await page.locator("#libraryModules .librarySearchResult .librarySearchFamily").first().textContent()).not.toBe("");
        // the counts of the families are those of the matches
        const count = (family: string) => page.locator(`li.libraryFamily[data-family="${family}"] .libraryCount`).textContent();
        expect(await count("Lib filters")).toBe(String((await results()).length));
        expect(await page.locator('li.libraryFamily[data-family="Sources"]').getAttribute("class")).toContain("empty");
        // the second result, chosen by the arrow, described and added by Enter
        await page.keyboard.press("ArrowDown");
        const second = (await results())[1];
        expect(await page.locator("#libraryDescription .libraryName").textContent()).toBe(second);
        const before = await page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().length);
        await page.keyboard.press("Enter");
        await page.waitForFunction((n) => (globalThis as any).faustPlayground.scene.getModules().length > n, before, { timeout: 60_000 });
        expect(await page.evaluate(() => { const ms = (globalThis as any).faustPlayground.scene.getModules(); return ms[ms.length - 1].moduleFaust.getName(); })).toBe(second.replace(/\s+/g, ""));
        // nothing found: a message; Escape clears the search, and the family chosen comes back
        await page.locator("#librarySearch").fill("xyzzy");
        expect(await page.locator("#libraryModules .librarySearchNone").count()).toBe(1);
        await page.locator("#librarySearch").press("Escape");
        expect(await page.locator("#librarySearch").inputValue()).toBe("");
        expect(await page.locator("#libraryModules .librarySearchResult").count()).toBe(0);
        expect(await page.locator("li.libraryFamily.selected").count()).toBe(1);
        // a family clicked during a search leaves it
        await page.locator("#librarySearch").fill("vco");
        await page.locator('li.libraryFamily[data-family="Timbre"]').click();
        expect(await page.locator("#librarySearch").inputValue()).toBe("");
        expect(await page.locator('li.libraryFamily[data-family="Timbre"]').getAttribute("class")).toContain("selected");
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});

describe("scene of the first visit", () => {
    const scene = (page: Page) => page.evaluate(() => {
        const { scene, documents } = (globalThis as any).faustPlayground;
        return {
            modules: scene.getModules().map((m: any) => m.moduleFaust.getName()),
            connections: scene.patch.getConnections().map((c: any) => `${c.from.module}:${c.from.port}>${c.to.module}:${c.to.port}`).sort(),
            dirty: documents.dirty as boolean,
            undo: scene.history.canUndo() as boolean,
            documents: documents.store.list().length as number,
        };
    });
    const loaded = (page: Page) => page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length > 0, null, { timeout: 60_000 });

    it("is a SineVCO to the left and right outputs, clean, played by its gate", async () => {
        const { context, page, errors } = await open();
        await loaded(page);
        const s = await scene(page);
        expect(s.modules).toEqual(["SineVCO"]);
        expect(s.connections).toEqual(["1:0>output:0", "1:0>output:1"]);
        expect(s).toMatchObject({ dirty: false, undo: false, documents: 1 });
        // silent until the gate is pressed: gain 0.5 × volume 0.25 then (the gate is smoothed at 1 Hz: 92 % after
        // 400 ms)
        await page.evaluate(async () => {
            const volume = (globalThis as any).faustPlayground.scene.masterVolume;
            const ctx = volume.node.context as AudioContext;
            await ctx.resume();
            const code = `registerProcessor("peak2", class extends AudioWorkletProcessor {
                constructor() { super(); this.peak = 0; this.port.onmessage = () => { this.port.postMessage(this.peak); this.peak = 0; }; }
                process(inputs) { for (const ch of inputs[0]) for (const v of ch) this.peak = Math.max(this.peak, Math.abs(v)); return true; }
            });`;
            await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
            const tap = new AudioWorkletNode(ctx, "peak2");
            const sink = ctx.createGain();
            sink.gain.value = 0;
            tap.connect(sink).connect(ctx.destination);
            volume.node.connect(tap);
            (window as any).__peak = () => new Promise<number>((r) => { tap.port.onmessage = (e) => r(e.data); tap.port.postMessage(0); });
        });
        const peak = async () => { await page.evaluate(() => (window as any).__peak()); await page.waitForTimeout(400); return page.evaluate(() => (window as any).__peak()) as Promise<number>; };
        expect(await peak()).toBeLessThan(1e-3);
        const gate = (await page.locator("input[type=button][value=gate]").boundingBox())!;
        await page.mouse.move(gate.x + gate.width / 2, gate.y + gate.height / 2);
        await page.mouse.down();
        const played = await peak();
        expect(played).toBeGreaterThan(0.1);
        expect(played).toBeLessThanOrEqual(0.1251);
        await page.mouse.up();
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("is replaced by a new scene when not modified, kept when modified, and not made again", async () => {
        const { context, page, errors } = await open();
        await loaded(page);
        // not modified: a new scene replaces it
        await page.evaluate(() => (globalThis as any).faustPlayground.documents.create());
        expect(await scene(page)).toMatchObject({ modules: [], documents: 1 });

        const second = await open();
        await loaded(second.page);
        // modified (a value): kept
        await second.page.evaluate(() => {
            const { scene } = (globalThis as any).faustPlayground;
            const module = scene.getModules()[0];
            const controler = module.moduleControles.find((c: any) => c.itemParam.label == "freq");
            controler.faustInterfaceView.slider.value = "1000";
            controler.faustInterfaceView.slider.dispatchEvent(new Event("input"));
            controler.faustInterfaceView.slider.dispatchEvent(new Event("change"));
        });
        await second.page.waitForFunction(() => (globalThis as any).faustPlayground.documents.dirty || (globalThis as any).faustPlayground.scene.history.canUndo());
        await second.page.evaluate(() => (globalThis as any).faustPlayground.documents.create());
        expect((await scene(second.page)).documents).toBe(2);
        // a reload opens the last document, not another starter
        const again = await open("", second.context);
        await again.page.waitForTimeout(1000);
        expect(await scene(again.page)).toMatchObject({ modules: [], documents: 2 });
        expect([...errors, ...second.errors, ...again.errors]).toEqual([]);
        await context.close();
        await second.context.close();
    }, 120_000);

    it("is empty with ?starter=0", async () => {
        const { context, page } = await open("?starter=0");
        await page.waitForTimeout(1000);
        expect(await scene(page)).toMatchObject({ modules: [], connections: [], documents: 1 });
        await context.close();
    }, 60_000);
});

describe("signature", () => {
    it("links to the repository of faustmodular, in a new tab, above the stage", async () => {
        const { context, page } = await open("?starter=0");
        const link = page.locator("a#signature");
        expect(await link.getAttribute("href")).toBe("https://github.com/orlarey/faustmodular");
        expect(await link.getAttribute("target")).toBe("_blank");
        const box = (await link.boundingBox())!;
        expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.id, [box.x + box.width / 2, box.y + box.height / 2])).toBe("signature");
        await context.close();
    }, 60_000);
});
