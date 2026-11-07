// Publishing to one's store, from faustmodular (Documentation/STORE-SPEC.md, phase 2): GitHub in memory behind the
// routes of the page (tests/helpers/github.ts). My store set in its dialog (the token checked), the scene published
// from the File menu, a module from its context menu: one commit each, the index made again, the link to share
// copied; the scene opened again from that link.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";
import { github } from "../helpers/github";
import { parseIndex } from "../../src/store/StoreFormat";

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

const MANIFEST = JSON.stringify({ format: "fauststore", version: 1, name: "Test store" });

describe("store, publishing", () => {
    it("gives a store a token from its indicator, publishes the scene and a module, copies the link, and the link opens the scene", async () => {
        const gh = github({ "fauststore.json": MANIFEST, "README.md": "# store" });
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "en-US", permissions: ["clipboard-read", "clipboard-write"] });
        const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, PATCH" };
        const handle = async (route: any) => {
            const request = route.request();
            if (request.method() == "OPTIONS") return route.fulfill({ status: 204, headers: cors });
            const headers = await request.allHeaders();
            const response = await gh.fetch(request.url(), { method: request.method(), headers: headers.authorization ? { Authorization: headers.authorization } : {}, body: request.postData() ?? undefined } as any);
            route.fulfill({ status: response.status, headers: cors, body: Buffer.from(await response.arrayBuffer()) });
        };
        await context.route("https://api.github.com/**", handle);
        await context.route("https://raw.githubusercontent.com/**", handle);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        // the store followed, in read only
        await page.goto(url + "?starter=0&store=o/r");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        // a scene with a module of the library and a module of one's own, named
        await page.evaluate(async () => {
            const { app, scene, documents } = (globalThis as any).faustPlayground;
            await documents.rename("Ma scène");
            app.uploadUrl(app, null, 300, 150, location.origin + "/faust-modules/modular/SineVCO.dsp");
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            const code = 'process = vgroup("MyOsc",environment{\ndeclare name "MyOsc";\nimport("stdfaust.lib");\nprocess = os.osc(220) * 0.1;\n}.process);';
            await app.compileFaust({ name: "MyOsc", sourceCode: code, x: 300, y: 400, callback: (f: any) => app.createModule(f, "MyOsc", code, 300, 400) });
            while (scene.getModules().length < 2) await new Promise((r) => setTimeout(r, 20));
        });
        // no store in writing: File > Publish… says how to get one
        await page.locator('li.storeFamily[data-family="store:o/r"] .storeAccess.read').waitFor({ timeout: 30_000 });
        // the indicator of the store: its menu, Write to this store…, the token checked
        await page.locator('li.storeFamily[data-family="store:o/r"] .storeAccess').click();
        await page.locator(".context-menu-item", { hasText: /^Write to this store/ }).click();
        await page.locator(".storeDialog").waitFor();
        const token = page.locator(".storeDialog input");
        await token.fill("bad");
        await page.getByText("Check and save").click();
        await page.locator(".storeDialogStatus.error").waitFor();
        expect(await page.locator(".storeDialogStatus").textContent()).toContain("token");
        await token.fill("good");
        await page.getByText("Check and save").click();
        await page.locator(".storeDialogStatus.ok").waitFor();
        await page.getByText("Close", { exact: true }).click();
        await page.locator('li.storeFamily[data-family="store:o/r"] .storeAccess.write').waitFor({ timeout: 10_000 });
        // File > Publish the scene to my store (one store in writing): its modules, the one of the library kept
        await page.getByText("File", { exact: true }).first().click();
        await page.locator(".context-menu-item", { hasText: /^Publish the scene to my store/ }).click();
        await page.locator(".publishDialog").waitFor({ timeout: 30_000 });
        expect(await page.locator(".publishDialogName").allTextContents()).toEqual(["MyOsc"]);
        expect(await page.locator(".publishDialog").textContent()).toContain("SineVCO (library of faustmodular)");
        await page.locator(".publishDialog .button.primary").click();
        await page.waitForFunction(() => (globalThis as any).faustPlayground.stores.get("o/r")?.store?.index.scenes.length == 1, null, { timeout: 30_000 });
        // one commit: the scene and its module
        expect(gh.commit(gh.head).message).toBe("Publish the scene Ma scène and 1 module (MyOsc) (faustmodular)");
        expect(gh.files().get("modules/MyOsc/MyOsc.dsp")).toBe('declare name "MyOsc";\nimport("stdfaust.lib");\nprocess = os.osc(220) * 0.1;');
        expect(gh.files().has("modules/SineVCO/SineVCO.dsp")).toBe(false);
        expect(gh.files().has("scenes/Ma-scene/Ma-scene.jfaust")).toBe(true);
        const scene = JSON.parse(gh.files().get("scenes/Ma-scene/Ma-scene.jfaust")!);
        expect(scene.modules.map((m: any) => m.name).filter((n: string) => n != "input" && n != "output").sort()).toEqual(["MyOsc", "SineVCO"]);
        const sceneCommit = gh.head;
        const link = await page.evaluate(() => navigator.clipboard.readText());
        expect(link).toBe(url + "?scene=https://github.com/o/r/blob/" + sceneCommit + "/scenes/Ma-scene/Ma-scene.jfaust");
        // the token kept in the browser, the store followed
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("faustmodular:store-tokens")!))).toEqual({ "o/r": "good" });
        // a module of the library, from its context menu: published, as asked
        const title = await page.evaluate(() => "#" + (globalThis as any).faustPlayground.scene.getModules()[0].moduleView.fModuleContainer.id + " h6");
        await page.click(title, { button: "right" });
        await page.locator(".context-menu-item", { hasText: /^Publish to my store/ }).click();
        await page.waitForFunction((c) => (globalThis as any).faustPlayground.stores.get("o/r")?.store?.index.modules.length == 2, null, { timeout: 30_000 });
        expect(gh.head).not.toBe(sceneCommit);
        expect(gh.files().get("modules/SineVCO/SineVCO.dsp")).toContain('declare name "SineVCO"');
        expect(gh.files().get("modules/SineVCO/SineVCO.dsp")).not.toContain("vgroup(\"SineVCO\",environment");
        const index = parseIndex(JSON.parse(gh.files().get("index.json")!))!;
        expect(index.modules.map((m) => m.name)).toEqual(["MyOsc", "SineVCO"]);
        expect(index.scenes.map((s) => s.name)).toEqual(["Ma scène"]);                       // its name, its file simplified
        // the link opens the scene published
        const other = await context.newPage();
        other.on("pageerror", (e) => errors.push(e.message));
        await other.goto(link.replace("?scene=", "?starter=0&scene="));
        await other.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current?.name == "Ma scène", null, { timeout: 60_000 });
        await other.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 2, null, { timeout: 60_000 });
        expect(errors).toEqual([]);
        await context.close();
    }, 180_000);
});
