// Editing the code of modules in faustcode (src/FaustcodeLink.ts), through a
// stub that follows the protocol, or the real faustcode when FAUSTCODE_DIR names a checkout of it
// (https://github.com/orlarey/faustcode, served here as static files).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import fs from "fs";
import http from "http";
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

const USER_CODE = `import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01));`;
const MODULE_CODE = `process = vgroup("Gain",environment{${USER_CODE}}.process);`;

async function openApp(query: string = ""): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + query);
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    return { context, page, errors };
}

// Adds the Gain module; returns its id and the selector of its container.
async function addGain(page: Page): Promise<{ id: string; sel: string }> {
    const id = await page.evaluate(async (code) => {
        const { app, scene } = (globalThis as any).faustPlayground;
        const before = scene.getModules().length;
        await app.compileFaust({ name: "Gain", sourceCode: code, x: 300, y: 200, callback: (f: any) => app.createModule(f, "Gain", code, 300, 200) });
        while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
        return scene.getModules()[before].moduleId;
    }, MODULE_CODE);
    const sel = "#" + await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);
    return { id, sel };
}

// Sets the gain slider through the interface (as a user would), and reads the module's state.
async function setGain(page: Page, id: string, value: number): Promise<void> {
    await page.evaluate(([m, v]) => {
        const module = (globalThis as any).faustPlayground.scene.getModuleById(m);
        const c = module.moduleControles.find((c: any) => c.itemParam.label == "gain");
        c.faustInterfaceView.slider.value = String(Math.round((v - parseFloat(c.itemParam.min)) / parseFloat(c.itemParam.step)));
        c.faustInterfaceView.slider.dispatchEvent(new Event("input"));
    }, [id, value] as [string, number]);
}

function moduleState(page: Page, id: string) {
    return page.evaluate((m) => {
        const s = (globalThis as any).faustPlayground.scene;
        const module = s.getModuleById(m);
        const state = s.patch.getModule(m);
        const gain = module.moduleControles.find((c: any) => c.itemParam.label == "gain");
        return {
            source: module.moduleFaust.getSource() as string,
            arity: `${state.numInputs}x${state.numOutputs}`,
            gain: gain ? Number(gain.value) : null,
        };
    }, id);
}

describe("editing in faustcode (stub)", () => {
    const STUB_ORIGIN = "https://faustcode.test";
    // Records the messages of its opener; send() answers to the origin of the first one.
    const STUB = `<!doctype html><title>faustcode stub</title><script>
        window.received = [];
        window.addEventListener("message", (e) => { if (e.source === window.opener) window.received.push({ origin: e.origin, data: e.data }); });
        window.send = (message) => window.opener.postMessage(Object.assign({ protocol: 1 }, message), window.received[0].origin);
        window.opener.postMessage({ type: "faustcode-link-ready", protocol: 1 }, "*");
    </script>`;

    async function openWithStub() {
        const app = await openApp("?faustcode=" + encodeURIComponent(STUB_ORIGIN + "/"));
        await app.context.route(STUB_ORIGIN + "/**", (route) => route.fulfill({ contentType: "text/html", body: STUB }));
        return app;
    }

    const received = (stub: Page) => stub.evaluate(() => (window as any).received as Array<{ origin: string; data: any }>);
    const waitReceived = (stub: Page, n: number) => stub.waitForFunction((k) => (window as any).received.length >= k, n, { timeout: 30_000 });

    it("sends the user's code of a module, and applies each code compiled in faustcode", async () => {
        const { context, page, errors } = await openWithStub();
        const { id, sel } = await addGain(page);
        await setGain(page, id, 0.8);

        // the pencil opens faustcode with ?link=modular and sends the module's code once it is ready
        const [stub] = await Promise.all([page.waitForEvent("popup"), page.locator(sel + " .edit").click()]);
        expect(stub.url()).toBe(STUB_ORIGIN + "/?link=modular");
        await waitReceived(stub, 1);
        const [edit] = await received(stub);
        expect(edit.origin).toBe(new URL(url).origin);
        expect(edit.data).toMatchObject({ type: "faustcode-link-edit", protocol: 1, name: "Gain", code: USER_CODE });
        const linkId = edit.data.id;

        // a new code (1 input, 2 outputs): applied in the group of the module, values kept, result sent back
        const stereo = `import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01)) <: _, _;`;
        await stub.evaluate(([i, c]) => (window as any).send({ type: "faustcode-link-code", id: i, code: c }), [linkId, stereo]);
        await waitReceived(stub, 2);
        expect((await received(stub))[1].data).toEqual({ type: "faustcode-link-result", protocol: 1, id: linkId, ok: true });
        let state = await moduleState(page, id);
        expect(state.arity).toBe("1x2");
        expect(state.source).toBe(`process = vgroup("Gain",environment{\n${stereo}\n}.process);`);
        expect(state.gain).toBeCloseTo(0.8, 5);

        // a code faustmodular cannot use (more than 32 outputs): refused, reported to faustcode
        await stub.evaluate(([i]) => (window as any).send({ type: "faustcode-link-code", id: i, code: "process = par(i, 40, _);" }), [linkId]);
        await waitReceived(stub, 3);
        expect((await received(stub))[2].data).toMatchObject({ type: "faustcode-link-result", id: linkId, ok: false, error: expect.stringMatching(/maximum is 32/) });
        expect((await moduleState(page, id)).arity).toBe("1x2");

        // messages that do not come from the faustcode window are ignored
        await page.evaluate(([i]) => window.postMessage({ type: "faustcode-link-code", protocol: 1, id: i, code: "process = 0;" }, "*"), [linkId]);
        await page.waitForTimeout(500);
        expect((await moduleState(page, id)).arity).toBe("1x2");

        // the pencil again: same window, same link
        await page.locator(sel + " .edit").click();
        await waitReceived(stub, 4);
        expect((await received(stub))[3].data).toMatchObject({ type: "faustcode-link-edit", id: linkId, code: stereo });
        expect(context.pages().length).toBe(2);

        // the module is removed: faustcode is told, and a later code for it is refused
        await page.evaluate((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).deleteModule(), id);
        await waitReceived(stub, 5);
        expect((await received(stub))[4].data).toEqual({ type: "faustcode-link-close", protocol: 1, id: linkId });
        await stub.evaluate(([i]) => (window as any).send({ type: "faustcode-link-code", id: i, code: "process = _;" }), [linkId]);
        await waitReceived(stub, 6);
        expect((await received(stub))[5].data).toMatchObject({ type: "faustcode-link-result", id: linkId, ok: false });
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("warns when faustcode has another version of libfaust, and not when it has the same", async () => {
        for (const [version, warned] of [["2.84.3", true], [null, false]] as const) {
            const origin = "https://faustcode-version.test";
            const app = await openApp("?faustcode=" + encodeURIComponent(origin + "/"));
            const same = await app.page.evaluate(() => (globalThis as any).faustPlayground.scene.faustcodeLink.fHost.libfaust());
            const stub = STUB.replace('{ type: "faustcode-link-ready", protocol: 1 }', `{ type: "faustcode-link-ready", protocol: 1, libfaust: "${version ?? same}" }`);
            await app.context.route(origin + "/**", (route) => route.fulfill({ contentType: "text/html", body: stub }));
            const { sel } = await addGain(app.page);
            const [popup] = await Promise.all([app.page.waitForEvent("popup"), app.page.locator(sel + " .edit").click()]);
            await waitReceived(popup, 1);
            const shown = await app.page.evaluate(() => document.getElementById("dialogue")!.textContent ?? "");
            expect(shown.includes(`faustcode uses libfaust ${version}`) || shown.includes(`faustcode utilise libfaust ${version}`)).toBe(warned);
            if (!warned) expect(shown).not.toMatch(/libfaust/);
            expect(app.errors).toEqual([]);
            await app.context.close();
        }
    }, 120_000);
});

// The real faustcode, if a checkout is given: FAUSTCODE_DIR=/path/to/faustcode npm test
const FAUSTCODE_DIR = process.env.FAUSTCODE_DIR;

describe.skipIf(!FAUSTCODE_DIR)("editing in faustcode (real)", () => {
    let faustcode: http.Server;
    let faustcodeUrl: string;
    const TYPES: Record<string, string> = {
        ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".wasm": "application/wasm", ".data": "application/octet-stream", ".svg": "image/svg+xml", ".png": "image/png",
    };

    beforeAll(async () => {
        const root = path.resolve(FAUSTCODE_DIR!);
        faustcode = http.createServer((req, res) => {
            let file = path.join(root, decodeURIComponent(new URL(req.url!, "http://x").pathname));
            if (file.endsWith("/")) file += "index.html";
            if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
            fs.createReadStream(file).pipe(res);
        });
        await new Promise<void>((resolve) => faustcode.listen(0, "127.0.0.1", resolve));
        faustcodeUrl = `http://127.0.0.1:${(faustcode.address() as any).port}/webapp/`;
    });

    afterAll(() => new Promise<void>((resolve) => faustcode ? faustcode.close(() => resolve()) : resolve()));

    it("updates the module at each successful save (Ctrl-S) in faustcode, not on an error", async () => {
        const { context, page } = await openApp("?faustcode=" + encodeURIComponent(faustcodeUrl));
        const { id, sel } = await addGain(page);
        const [fc] = await Promise.all([page.waitForEvent("popup"), page.locator(sel + " .edit").click()]);
        await fc.waitForSelector("#audio-gate-button", { state: "visible", timeout: 60_000 });
        // the module's code becomes a session of faustcode, shown in the dsp view after ENTER
        await fc.waitForFunction(() => document.querySelector(".app-notice")?.textContent?.includes("Linked to faustmodular"), null, { timeout: 60_000 });
        // ENTER as soon as it shows, while faustcode still prepares its showcase: the linked session wins
        await fc.click("#audio-gate-button");
        await fc.waitForFunction((code) => document.querySelector(".cm-content")?.textContent?.includes("process = *(hslider"), USER_CODE, { timeout: 30_000 });

        await fc.click(".cm-content");
        await fc.keyboard.press("Control+End");
        await fc.keyboard.type(" // saved in faustcode");
        await fc.keyboard.press("Control+s");
        await page.waitForFunction((m) => (globalThis as any).faustPlayground.scene.getModuleById(m).moduleFaust.getSource().includes("// saved in faustcode"), id, { timeout: 30_000 });
        const saved = (await moduleState(page, id)).source;
        expect(saved).toMatch(/^process = vgroup\("Gain",environment\{\n/);

        // a save with an error stays in faustcode
        await fc.waitForTimeout(1000);
        await fc.click(".cm-content");
        await fc.keyboard.press("Control+End");
        await fc.keyboard.type("\nfoo = ;");
        await fc.keyboard.press("Control+s");
        await fc.waitForSelector("#error-banner:not(.hidden)", { timeout: 30_000 });
        await page.waitForTimeout(1000);
        expect((await moduleState(page, id)).source).toBe(saved);
        await context.close();
    }, 180_000);
});
