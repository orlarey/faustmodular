// Documents in the application (Chromium, OPFS): the working copy survives a reload, Cmd/Ctrl-S
// commits it, the Documents menu creates, renames, duplicates, deletes and restores documents,
// and the scenes of the localStorage are migrated once.
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

// A context keeps its OPFS and localStorage across the pages (reloads) it opens.
async function open(context: BrowserContext, errors: string[] = []): Promise<Page> {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => (globalThis as any).faustmodular?.documents?.current, null, { timeout: 60_000 });
    return page;
}

async function reload(page: Page): Promise<void> {
    await page.reload();
    await page.waitForFunction(() => (globalThis as any).faustmodular?.documents?.current, null, { timeout: 60_000 });
}

const fixture = (page: Page, file: string) => page.evaluate(async (f) => (await fetch(f)).text(), file);
const importFile = async (page: Page, file: string) => {
    const json = await fixture(page, file);
    await page.evaluate((j) => (globalThis as any).faustmodular.scene.recallScene(j), json);
};
const info = (page: Page) => page.evaluate(() => {
    const { documents, scene } = (globalThis as any).faustmodular;
    return {
        name: documents.current.name, dirty: documents.dirty, header: document.getElementById("PatchName")!.textContent,
        names: documents.store.list().map((d: any) => d.name).sort(), trash: documents.store.list(true).map((d: any) => d.name),
        modules: scene.getModules().map((m: any) => m.moduleFaust.getName()).sort(),
    };
});
// moves the first slider of the first module through the interface, and waits for the saves
const moveSlider = async (page: Page, value: string) => {
    await page.evaluate((v) => {
        const c = (globalThis as any).faustmodular.scene.getModules()[0].moduleControles[0];
        c.faustInterfaceView.slider.value = v;
        c.faustInterfaceView.slider.dispatchEvent(new Event("input"));
    }, value);
    await page.evaluate(() => (globalThis as any).faustmodular.documents.flush());
};
const sliderValue = (page: Page) => page.evaluate(() => (globalThis as any).faustmodular.scene.getModules()[0].moduleControles[0].faustInterfaceView.slider.value);

describe("documents", () => {
    it("keeps the working copy across a reload; Cmd/Ctrl-S commits it; undo back makes it clean", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const errors: string[] = [];
        const page = await open(context, errors);
        expect((await info(page)).name).toBe("Untitled");
        await importFile(page, "/json/Modulation_Example.json");
        expect(await info(page)).toMatchObject({ name: "Modulation_Example", dirty: false, names: ["Modulation_Example"] });

        await moveSlider(page, "7");
        expect(await info(page)).toMatchObject({ dirty: true, header: "Modulation_Example ●" });
        await reload(page);
        expect(await info(page)).toMatchObject({ name: "Modulation_Example", dirty: true });
        expect(await sliderValue(page)).toBe("7");

        await page.mouse.click(700, 860);                   // the stage has the focus
        await page.keyboard.press("Control+s");
        await page.waitForFunction(() => !(globalThis as any).faustmodular.documents.dirty);
        expect((await info(page)).header).toBe("Modulation_Example");
        await reload(page);
        expect(await info(page)).toMatchObject({ dirty: false });
        expect(await sliderValue(page)).toBe("7");

        // a change undone: the document is clean again
        await moveSlider(page, "2");
        expect((await info(page)).dirty).toBe(true);
        await page.evaluate(() => (globalThis as any).faustmodular.scene.undo());
        await page.evaluate(() => (globalThis as any).faustmodular.documents.flush());
        expect((await info(page)).dirty).toBe(false);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("reverts to the saved version, and saves as a new document leaving the original clean", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const page = await open(context);
        await importFile(page, "/json/Modulation_Example.json");
        const saved = await sliderValue(page);
        await moveSlider(page, "9");
        await page.evaluate(() => (globalThis as any).faustmodular.documents.revert());
        expect(await info(page)).toMatchObject({ dirty: false });
        expect(await sliderValue(page)).toBe(saved);

        await moveSlider(page, "9");
        await page.evaluate(() => (globalThis as any).faustmodular.documents.saveAs("Variant"));
        expect(await info(page)).toMatchObject({ name: "Variant", dirty: false, names: ["Modulation_Example", "Variant"] });
        const original = await page.evaluate(() => (globalThis as any).faustmodular.documents.store.list().find((d: any) => d.name == "Modulation_Example").id);
        await page.evaluate((id) => (globalThis as any).faustmodular.documents.open(id), original);
        expect(await info(page)).toMatchObject({ name: "Modulation_Example", dirty: false });
        expect(await sliderValue(page)).toBe(saved);
        await context.close();
    }, 240_000);

    it("creates, renames, duplicates, deletes and restores documents from the Documents menu", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const errors: string[] = [];
        const page = await open(context, errors);
        await importFile(page, "/tests/fixtures/v1/patch_light.json");
        await page.locator("#documentsButtonMenu").click();
        await expect.poll(() => page.locator("#documentsContainer .documentRow").count()).toBe(1);

        // rename the open document
        await page.locator("#documentName").fill("Light");
        await page.locator("#documentName").press("Enter");
        await expect.poll(async () => (await info(page)).header).toBe("Light");
        // a new document
        await page.locator("#documentsContainer .documentNew").click();
        await expect.poll(async () => (await info(page)).name).toBe("Untitled");
        expect((await info(page)).modules).toEqual([]);
        // duplicate Light, then open it by a click on its row
        await page.locator("#documentsContainer .documentRow", { hasText: "Light" }).locator(".documentDuplicate").click();
        await expect.poll(async () => (await info(page)).names).toEqual(["Light", "Light 2", "Untitled"]);
        await page.locator("#documentsContainer .documentRow", { hasText: "Light 2" }).locator(".documentRowName").click();
        await expect.poll(async () => (await info(page)).name).toBe("Light 2");
        expect((await info(page)).modules).toEqual(["Echo", "SOscillator", "Volume"]);
        // delete it (confirmation), then restore it from the trash
        await page.locator("#documentsContainer .documentRow.current .documentDelete").click();
        await page.locator("#dialogue #validButton").click();
        await expect.poll(async () => (await info(page)).trash).toEqual(["Light 2"]);
        await expect.poll(async () => (await info(page)).name).not.toBe("Light 2");      // another document opened
        await page.locator("#documentsContainer .documentRestore").click();
        await expect.poll(async () => (await info(page)).trash).toEqual([]);
        expect((await info(page)).names).toEqual(["Light", "Light 2", "Untitled"]);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("migrates the scenes saved in the localStorage once, converting each when first opened", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const page0 = await context.newPage();
        await page0.goto(url + "favicon.ico");                                     // same origin, the application not started
        const light = await page0.evaluate(async () => (await fetch("/tests/fixtures/v1/patch_light.json")).text());
        const modulation = await page0.evaluate(async () => (await fetch("/json/Modulation_Example.json")).text());
        await page0.evaluate(([a, b]) => localStorage.setItem("FaustPlayground", JSON.stringify([["Light", a], ["Modulation", b]])), [light, modulation]);
        await page0.close();

        const page = await open(context);
        expect((await info(page)).names).toEqual(["Light", "Modulation"]);
        const other = await page.evaluate(() => {
            const d = (globalThis as any).faustmodular.documents;
            return d.store.list().find((e: any) => e.id != d.current.id).id;
        });
        await page.evaluate((id) => (globalThis as any).faustmodular.documents.open(id), other);
        const opened = await info(page);
        expect(opened.dirty).toBe(false);
        expect(opened.modules.length).toBeGreaterThan(0);
        await reload(page);
        expect((await info(page)).names).toEqual(["Light", "Modulation"]);           // not migrated twice
        expect(await page.evaluate(() => localStorage.getItem("FaustPlayground"))).not.toBeNull();
        await context.close();
    }, 240_000);
});
