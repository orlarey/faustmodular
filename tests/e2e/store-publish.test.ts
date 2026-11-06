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
    it("sets my store, publishes the scene and a module, copies the link, and the link opens the scene", async () => {
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
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        // a scene with a module, named
        await page.evaluate(async () => {
            const { app, scene, documents } = (globalThis as any).faustPlayground;
            await documents.rename("Ma scène");
            app.uploadUrl(app, null, 300, 150, location.origin + "/faust-modules/modular/SineVCO.dsp");
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
        });
        // File > Publish the scene to my store: no store yet, the dialog
        await page.getByText("File", { exact: true }).first().click();
        await page.getByText("Publish the scene to my store").click();
        await page.locator(".storeDialog").waitFor();
        const inputs = page.locator(".storeDialog input");
        await inputs.nth(0).fill("o/r");
        await inputs.nth(1).fill("bad");
        await page.getByText("Check and save").click();
        await page.locator(".storeDialogStatus.error").waitFor();
        expect(await page.locator(".storeDialogStatus").textContent()).toContain("token");
        await inputs.nth(1).fill("good");
        await page.getByText("Check and save").click();
        // checked: the publication goes on
        await page.waitForFunction(() => (window as any).document.querySelector(".storeDialog") == null, null, { timeout: 10_000 });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.stores.get("o/r")?.status == "ready", null, { timeout: 30_000 });
        expect(gh.files().has("scenes/Ma-scene/Ma-scene.jfaust")).toBe(true);
        const scene = JSON.parse(gh.files().get("scenes/Ma-scene/Ma-scene.jfaust")!);
        expect(scene.modules.some((m: any) => m.name == "SineVCO")).toBe(true);
        const sceneCommit = gh.head;
        const link = await page.evaluate(() => navigator.clipboard.readText());
        expect(link).toBe(url + "?scene=https://github.com/o/r/blob/" + sceneCommit + "/scenes/Ma-scene/Ma-scene.jfaust");
        // the token kept in the browser, the store followed
        expect(await page.evaluate(() => [localStorage.getItem("faustmodular:my-store"), localStorage.getItem("faustmodular:my-store-token")])).toEqual(["o/r", "good"]);
        // the module, from its context menu
        const title = await page.evaluate(() => "#" + (globalThis as any).faustPlayground.scene.getModules()[0].moduleView.fModuleContainer.id + " h6");
        await page.click(title, { button: "right" });
        await page.locator(".context-menu-item", { hasText: /^Publish to my store/ }).click();
        await page.waitForFunction((c) => (globalThis as any).faustPlayground.stores.get("o/r")?.store?.index.modules.length == 1, null, { timeout: 30_000 });
        expect(gh.head).not.toBe(sceneCommit);
        expect(gh.files().get("modules/SineVCO/SineVCO.dsp")).toContain('declare name "SineVCO"');
        expect(gh.files().get("modules/SineVCO/SineVCO.dsp")).not.toContain("vgroup(\"SineVCO\",environment");
        const index = parseIndex(JSON.parse(gh.files().get("index.json")!))!;
        expect(index.modules.map((m) => m.name)).toEqual(["SineVCO"]);
        expect(index.scenes.map((s) => s.name)).toEqual(["Ma-scene"]);
        // the link opens the scene published
        const other = await context.newPage();
        other.on("pageerror", (e) => errors.push(e.message));
        await other.goto(link.replace("?scene=", "?starter=0&scene="));
        await other.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current?.name == "Ma-scene", null, { timeout: 60_000 });
        await other.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1, null, { timeout: 60_000 });
        expect(errors).toEqual([]);
        await context.close();
    }, 180_000);
});
