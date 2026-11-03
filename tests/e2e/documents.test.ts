// Documents in the application (Chromium, OPFS): the working copy survives a reload, Cmd/Ctrl-S
// saves the scene to its file and commits it, the File menu makes a new scene and opens the recent
// ones, the name of the scene is typed in place, and the scenes of the localStorage are migrated once.
// The disk is in memory (fake-files.ts): Playwright cannot drive the pickers of the browser.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";
import { files, installFakeFiles } from "./fake-files";

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
    await page.goto(url + "?starter=0");
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
        await installFakeFiles(context);
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

        // the physical modules: where they were, then where they were moved
        const physical = () => page.evaluate(() => {
            const s = (globalThis as any).faustmodular.scene;
            return [s.fAudioInput, s.fAudioOutput].map((m: any) => [m.moduleView.x, m.moduleView.y]);
        });
        const placed = await physical();
        expect(placed[0]).toEqual([10, 450]);
        await page.evaluate(() => { const s = (globalThis as any).faustmodular.scene; s.moveModule(s.fAudioOutput, 900, 300); });
        await page.evaluate(() => (globalThis as any).faustmodular.documents.flush());
        await reload(page);
        expect(await physical()).toEqual([placed[0], [900, 300]]);

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
        await installFakeFiles(context);
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

    it("File menu: a new scene, the recent ones; the name of the scene typed in place", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        await installFakeFiles(context);
        const errors: string[] = [];
        const page = await open(context, errors);
        await importFile(page, "/tests/fixtures/v1/patch_light.json");
        // the name: a click on it, typed, Enter
        await page.locator("#PatchName").click();
        await page.locator("#PatchName input.scene-name-input").fill("Light");
        await page.locator("#PatchName input.scene-name-input").press("Enter");
        await expect.poll(async () => (await info(page)).header).toBe("Light");
        // Escape gives up
        await page.locator("#PatchName").click();
        await page.locator("#PatchName input.scene-name-input").fill("Other");
        await page.locator("#PatchName input.scene-name-input").press("Escape");
        expect((await info(page)).name).toBe("Light");
        // a new scene, empty
        await page.locator("#documentsButtonMenu").click();
        await page.locator(".context-menu-item", { hasText: /^(New scene|Nouvelle scène)/ }).click();
        await expect.poll(async () => (await info(page)).name).toBe("Untitled");
        expect((await info(page)).modules).toEqual([]);
        // Light, in the recent scenes
        await page.locator("#documentsButtonMenu").click();
        await page.locator(".context-menu-item", { hasText: /^(Recent scenes|Scènes récentes)/ }).hover();
        await page.locator(".context-submenu .context-menu-item", { hasText: "Light" }).click();
        await expect.poll(async () => (await info(page)).name).toBe("Light");
        expect((await info(page)).modules).toEqual(["Echo", "SOscillator", "Volume"]);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("File menu: Save as names the scene after its file, Save writes it again, Open replaces the scene and remembers its file", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        await installFakeFiles(context);
        const errors: string[] = [];
        const page = await open(context, errors);
        await importFile(page, "/json/Modulation_Example.json");
        await moveSlider(page, "5");
        expect((await info(page)).dirty).toBe(true);
        // Save as: a file chosen, the scene named after it, not modified any more
        await page.evaluate(() => { (window as any).__nextSave = "Ma scène.jfaust"; });
        await page.locator("#documentsButtonMenu").click();
        await page.locator(".context-menu-item", { hasText: /^(Save as|Enregistrer sous)/ }).click();
        await page.waitForFunction(() => (globalThis as any).faustmodular.documents.current.name == "Ma scène" && !(globalThis as any).faustmodular.documents.dirty);
        let disk = await files(page);
        const written = JSON.parse(disk.files["Ma scène.jfaust"]);
        expect(written.sceneName).toBe("Ma scène");
        expect(written.modules.filter((m: any) => m.kind == "faust").length).toBeGreaterThan(0);
        expect((await info(page)).header).toBe("Ma scène");
        // Save (Ctrl-S) after a change: the same file, no picker
        await moveSlider(page, "8");
        await page.mouse.click(700, 860);
        await page.keyboard.press("Control+s");
        await page.waitForFunction(() => !(globalThis as any).faustmodular.documents.dirty);
        disk = await files(page);
        expect(disk.pickers.save).toBe(1);
        expect(disk.files["Ma scène.jfaust"]).not.toBe(JSON.stringify(written, null, 1));
        // Open (Ctrl-O): a scene of the disk in place of the one shown, named after its file, its file remembered
        const example = await fixture(page, "/json/Multichannel_Example.json");
        await page.evaluate((json) => { (window as any).__files["Autre.jfaust"] = json; (window as any).__nextOpen = "Autre.jfaust"; }, example);
        await page.keyboard.press("Control+o");
        await page.waitForFunction(() => (globalThis as any).faustmodular.documents.current?.name == "Autre", null, { timeout: 60_000 });
        expect((await info(page)).dirty).toBe(false);
        expect((await info(page)).names).toEqual(["Autre", "Ma scène"]);
        await moveSlider(page, "3");
        await page.keyboard.press("Control+s");
        await page.waitForFunction(() => !(globalThis as any).faustmodular.documents.dirty);
        disk = await files(page);
        expect(disk.pickers.save).toBe(1);
        expect(disk.files["Autre.jfaust"]).not.toBe(example);
        expect(JSON.parse(disk.files["Autre.jfaust"]).sceneName).toBe("Autre");
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("File menu without the API (Firefox, Safari): Save downloads the scene, Open reads a file chosen", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
        await context.addInitScript(() => { delete (window as any).showOpenFilePicker; delete (window as any).showSaveFilePicker; });
        const errors: string[] = [];
        const page = await open(context, errors);
        await importFile(page, "/json/Modulation_Example.json");
        await moveSlider(page, "6");
        const download = page.waitForEvent("download");
        await page.mouse.click(700, 860);
        await page.keyboard.press("Control+s");
        const file = await download;
        expect(file.suggestedFilename()).toBe("Modulation_Example.jfaust");
        await page.waitForFunction(() => !(globalThis as any).faustmodular.documents.dirty);
        const chooser = page.waitForEvent("filechooser");
        await page.keyboard.press("Control+o");
        await (await chooser).setFiles({ name: "Mine.jfaust", mimeType: "application/json", buffer: Buffer.from(await fixture(page, "/json/Multichannel_Example.json")) });
        await page.waitForFunction(() => (globalThis as any).faustmodular.documents.current?.name == "Mine", null, { timeout: 60_000 });
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("migrates the scenes saved in the localStorage once, converting each when first opened", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        await installFakeFiles(context);
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

    it("user modules: My modules lists them, an edit adds a version, ↑ updates an instance, double click adds one", async () => {
        const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        await installFakeFiles(context);
        const errors: string[] = [];
        const page = await open(context, errors);
        const myModules = () => page.locator("#userLibrarySelect li.userModule a").allTextContents();
        const versions = () => page.evaluate(() => (globalThis as any).faustmodular.documents.store.listModules().map((m: any) => `${m.name}:${m.versions.length}`).sort());
        // a module of the library is not a user module
        await page.evaluate(() => document.dispatchEvent(new CustomEvent("dbltouchlib", { detail: location.origin + "/faust-modules/effects/Echo.dsp" })));
        await page.waitForFunction(() => (globalThis as any).faustmodular.scene.getModules().length == 1);
        await page.evaluate(() => (globalThis as any).faustmodular.documents.flush());
        expect(await versions()).toEqual([]);
        await page.locator("#libraryButtonMenu").click();
        // My modules: a family of the library, after those of the catalog
        await page.locator('li.libraryFamily[data-family="My modules"]').click();
        expect(await page.locator("#userLibrarySelect li.userModulesEmpty").count()).toBe(1);

        // edited as faustcode does: a new user module, named after it
        const edit = (code: string) => page.evaluate(async (c) => {
            const { scene, documents } = (globalThis as any).faustmodular;
            const error = await scene.editModuleCode(scene.getModules()[0], c);
            await documents.flush();
            return error;
        }, code);
        expect(await edit('import("stdfaust.lib");\nprocess = ef.echo(1, 0.25, 0.5);')).toBeNull();
        expect(await versions()).toEqual(["Echo:1"]);
        await expect.poll(myModules).toEqual(["Echo"]);
        expect(await edit('import("stdfaust.lib");\nprocess = ef.echo(1, 0.5, 0.5);')).toBeNull();
        expect(await versions()).toEqual(["Echo:2"]);

        // back to the first version (undo): ↑ updates to the latest one
        const update = page.locator(".moduleFaust > .update");
        await page.evaluate(() => (globalThis as any).faustmodular.scene.undo());
        await page.evaluate(() => (globalThis as any).faustmodular.documents.flush());
        await expect.poll(() => update.isVisible()).toBe(true);
        await page.locator("#closeButton").click();
        await update.click();
        await expect.poll(() => update.isVisible()).toBe(false);
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.getModules()[0].moduleFaust.getSource())).toContain("ef.echo(1, 0.5, 0.5)");

        // double click in My modules: an instance of the latest version; rename in place
        await page.locator("#libraryButtonMenu").click();
        await page.locator("#userLibrarySelect li.userModule a", { hasText: "Echo" }).dblclick();
        await page.waitForFunction(() => (globalThis as any).faustmodular.scene.getModules().length == 2);
        expect(await page.evaluate(() => (globalThis as any).faustmodular.scene.getModules()[1].moduleFaust.getSource())).toContain("ef.echo(1, 0.5, 0.5)");
        await page.locator("#userLibrarySelect li.userModule").hover();
        await page.locator("#userLibrarySelect .userModuleRename").click();
        await page.locator("#userLibrarySelect input.userModuleName").fill("Slow echo");
        await page.locator("#userLibrarySelect input.userModuleName").press("Enter");
        await expect.poll(myModules).toEqual(["Slow echo"]);
        // kept across a reload
        await reload(page);
        expect(await versions()).toEqual(["Slow echo:2"]);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);
});
