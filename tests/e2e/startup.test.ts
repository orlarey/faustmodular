// What the application does when it opens: no request to another site (no Google API, no export service),
// no microphone asked for; the microphone is asked for on demand, by a cable drawn from the input module or
// by a click on it, and the input module shows its state. The search of the Modules menu, from the keyboard.
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
async function open(): Promise<{ context: BrowserContext; page: Page; hosts: Set<string>; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
    await page.goto(url);
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
