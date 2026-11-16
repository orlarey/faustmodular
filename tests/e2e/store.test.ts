// The store, read (Documentation/STORE-SPEC.md, phase 1): GitHub served from the store of templates/fauststore
// (raw files and the tree of the API, as GitHub answers, with CORS). A link opens a scene of a store as a new
// document; a store followed shows its modules in the library (a double click adds one) and its scenes in the File
// menu; a repository that is not a store is refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import fs from "fs";
import path from "path";

let server: ViteDevServer;
let browser: Browser;
let url: string;
const STORE = path.resolve(__dirname, "../../templates/fauststore");

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

const files = (dir: string, base = ""): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name), base + e.name + "/") : [base + e.name]);

// A page where GitHub is the store of templates/fauststore, as "test/store"; the requests to GitHub counted.
async function open(query: string): Promise<{ context: BrowserContext; page: Page; errors: string[]; github: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const github: string[] = [];
    const cors = { "access-control-allow-origin": "*" };
    await context.route("https://raw.githubusercontent.com/**", (route) => {
        github.push(route.request().url());
        const m = /^https:\/\/raw\.githubusercontent\.com\/test\/store\/(?:HEAD|main)\/(.+)$/.exec(route.request().url());
        const file = m && path.join(STORE, decodeURIComponent(m[1]));
        if (file && file.startsWith(STORE) && fs.existsSync(file)) route.fulfill({ status: 200, headers: cors, body: fs.readFileSync(file) });
        else route.fulfill({ status: 404, headers: cors, body: "404: Not Found" });
    });
    await context.route("https://api.github.com/**", (route) => {
        github.push(route.request().url());
        if (route.request().url() == "https://api.github.com/repos/test/store/git/trees/HEAD?recursive=1") {
            route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ tree: files(STORE).map((p) => ({ path: p, type: "blob" })) }) });
        } else route.fulfill({ status: 404, headers: cors, body: "{}" });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + query);
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    return { context, page, errors, github };
}

const modules = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().map((m: any) => m.moduleFaust.getName()));

describe("store, read", () => {
    it("opens a scene of a store from a link, as a new document; the link taken off the address", async () => {
        const { context, page, errors } = await open("?starter=0&store=test/store&scene=scenes/Nappe/Nappe.jfaust");
        await page.waitForFunction(() => (globalThis as any).faustPlayground.documents.current?.name == "Nappe", null, { timeout: 60_000 });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1, null, { timeout: 60_000 });
        expect(await modules(page)).toEqual(["Drone"]);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.patch.getConnections().length)).toBe(2);
        expect(await page.evaluate(() => location.search)).toBe("?starter=0");
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("opens a scene from the address of its file on GitHub, put in the address of faustmodular", async () => {
        const file = "https://github.com/test/store/blob/main/scenes/Nappe/Nappe.jfaust";
        const { context, page, errors, github } = await open("?starter=0&scene=" + encodeURIComponent(file));
        await page.waitForFunction(() => (globalThis as any).faustPlayground.documents.current?.name == "Nappe", null, { timeout: 60_000 });
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1, null, { timeout: 60_000 });
        expect(await modules(page)).toEqual(["Drone"]);
        expect(github).toContain("https://raw.githubusercontent.com/test/store/main/scenes/Nappe/Nappe.jfaust");
        expect(await page.evaluate(() => location.search)).toBe("?starter=0");
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("follows a store from a link: its modules in the library (a double click adds one), its scenes in the File menu", async () => {
        const { context, page, errors, github } = await open("?starter=0&store=test/store");
        // the library opened on the store (no index: rebuilt from the repository)
        await page.locator('li.storeFamily[data-family="store:test/store"].selected').waitFor({ timeout: 30_000 });
        expect(await page.locator('li.storeFamily[data-family="store:test/store"]').textContent()).toContain("My Faust store");
        expect(await page.locator("#libraryModules a").allTextContents()).toEqual(["Drone"]);
        await page.locator("#libraryModules a", { hasText: "Drone" }).hover();
        expect(await page.locator("#libraryDescription .libraryName").textContent()).toBe("Drone");
        expect(await page.locator("#libraryDescription").textContent()).toContain("GRAME");
        await page.locator("#libraryModules a", { hasText: "Drone" }).dblclick();
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 1, null, { timeout: 60_000 });
        expect(await modules(page)).toEqual(["Drone"]);
        // kept: followed again at the next visit; found by the search
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("faustmodular:stores")!))).toEqual(["test/store"]);
        await page.locator("#librarySearch").fill("drone");
        expect(await page.locator("#libraryModules .librarySearchResult a").allTextContents()).toContain("Drone");
        // the File menu: Open from a store ▸ My Faust store ▸ Nappe
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.stores.get("test/store").store.index.scenes.map((s: any) => s.name))).toEqual(["Nappe"]);
        // without an account: one call of the API (the tree), the rest from the raw files
        expect(github.filter((u) => u.startsWith("https://api.github.com/")).length).toBe(1);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("refuses a repository that is not a store, and says why", async () => {
        const { context, page, errors } = await open("?starter=0");
        await page.getByText("Modules", { exact: true }).first().click();
        await page.locator("li.storeAdd").click();
        await page.locator("li.storeAdd input.storeName").fill("test/nothing");
        await page.keyboard.press("Enter");
        await page.locator(".messageTransitionOut, .messageTransitionIn, [class*=message]", { hasText: "test/nothing" }).first().waitFor({ timeout: 10_000 });
        expect(await page.locator("li.storeFamily").count()).toBe(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
