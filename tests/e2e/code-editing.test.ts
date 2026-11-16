// Editing the resources of a scene in faustcode (Documentation/SCENE-RESOURCES-SPEC.md, "Le contrat avec faustcode"),
// through a stub of faustcode served by the same origin (/faustcode/): it writes the files of the resources in OPFS,
// under the lock of the document, and rings the channel, as faustcode does.
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
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

const GAIN = `import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01));`;
const GAIN_HALF = `import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01)) : *(0.5);`;

// The stub of faustcode: the messages of the channel received, the answer to open-resource, the files of OPFS.
const STUB = `<!doctype html><title>faustcode stub</title><script>
    const channel = new BroadcastChannel("faustmodular-resources");
    const envelope = { channel: "faustmodular-resources", version: 1, sender: "faustcode" };
    window.received = [];
    window.answering = true;
    channel.onmessage = (e) => {
        window.received.push(e.data);
        if (e.data.type == "open-resource" && window.answering) channel.postMessage({ ...envelope, type: "opened", request: e.data.request });
    };
    window.ring = (message) => channel.postMessage({ ...envelope, ...message });
    const folder = async (doc) => {
        let dir = await navigator.storage.getDirectory();
        for (const part of ["faustmodular", "documents", doc, "resources"]) dir = await dir.getDirectoryHandle(part, { create: true });
        return dir;
    };
    window.writeResource = (doc, file, code) => navigator.locks.request("faustmodular:document:" + doc, async () => {
        const handle = await (await folder(doc)).getFileHandle(file, { create: true });
        const writable = await handle.createWritable();
        await writable.write(code);
        await writable.close();
    });
    window.readResource = async (doc, file) => {
        try { return await (await (await (await folder(doc)).getFileHandle(file)).getFile()).text(); } catch { return null; }
    };
</script>`;

async function openApp(): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.route("**/faustcode/**", (route) => route.fulfill({ contentType: "text/html", body: STUB }));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    return { context, page, errors };
}

// A faustcode tab of the same origin, already open.
async function openStub(context: BrowserContext): Promise<Page> {
    const stub = await context.newPage();
    await stub.goto(url + "faustcode/");
    return stub;
}

const add = (page: Page, code = GAIN) => page.evaluate(async (code) => {
    const m = await (globalThis as any).faustPlayground.scene.addModuleFromCode("Gain", code, { x: 200 + Math.random() * 400, y: 200 });
    return typeof m == "string" ? m : m.moduleId as string;
}, code);
const documentId = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.documents.current.id as string);
const flush = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.documents.flush());
const codes = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().map((m: any) =>
    /environment\{\n([\s\S]*)\n\}\.process/.exec(m.moduleFaust.getSource())?.[1] ?? m.moduleFaust.getSource()));
const received = (stub: Page, type: string) => stub.evaluate((t) => (window as any).received.filter((m: any) => m.type == t), type);
const waitReceived = (stub: Page, type: string, n = 1) => stub.waitForFunction(([t, k]) => (window as any).received.filter((m: any) => m.type == t).length >= (k as number), [type, n], { timeout: 30_000 });
const pencil = (page: Page, id: string) => page.evaluate((m) => (globalThis as any).faustPlayground.scene.editInFaustcode((globalThis as any).faustPlayground.scene.getModuleById(m)), id);

describe("the resources edited in faustcode (stub of the same origin)", () => {
    it("the pencil opens faustcode on the file of the resource; a faustcode tab open takes it", async () => {
        const { context, page, errors } = await openApp();
        const id = await add(page);
        await flush(page);
        const doc = await documentId(page);
        // no faustcode tab: a window on the file
        const [popup] = await Promise.all([context.waitForEvent("page"), pencil(page, id)]);
        expect(popup.url()).toContain(`/faustcode/?open=faustmodular%3A${doc}%2FGain.dsp`);
        await popup.waitForLoadState();
        expect(await popup.evaluate(([d]) => (window as any).readResource(d, "Gain.dsp"), [doc])).toBe(GAIN);
        // a faustcode tab open answers: no new window
        let opened = 0;
        context.on("page", () => opened++);
        await pencil(page, id);
        await waitReceived(popup, "open-resource", 1);
        expect((await received(popup, "open-resource")).at(-1)).toMatchObject({ document: doc, file: "Gain.dsp", name: "Gain", sender: "faustmodular" });
        await page.waitForTimeout(800);
        expect(opened).toBe(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("a file saved by faustcode updates all the instances of its resource, and the answer says how many", async () => {
        const { context, page, errors } = await openApp();
        await add(page);
        await add(page);
        await flush(page);
        const doc = await documentId(page);
        const stub = await openStub(context);
        await stub.evaluate(async ([d, code]) => {
            await (window as any).writeResource(d, "Gain.dsp", code);
            (window as any).ring({ type: "resource-changed", document: d, file: "Gain.dsp", name: "Gain", sha1: "x" });
        }, [doc, GAIN_HALF]);
        await waitReceived(stub, "applied");
        expect((await received(stub, "applied"))[0]).toMatchObject({ document: doc, file: "Gain.dsp", ok: true, instances: 2 });
        expect(await codes(page)).toEqual([GAIN_HALF, GAIN_HALF]);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.documents.dirty)).toBe(true);
        // the bell of another document: ignored
        await stub.evaluate(() => (window as any).ring({ type: "resource-changed", document: "other", file: "Gain.dsp", name: "Gain", sha1: "x" }));
        await page.waitForTimeout(500);
        expect((await received(stub, "applied")).length).toBe(1);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("a code faustmodular cannot compile: the instances keep theirs, the file keeps the code of faustcode, the answer the error", async () => {
        const { context, page, errors } = await openApp();
        await add(page);
        await flush(page);
        const doc = await documentId(page);
        const stub = await openStub(context);
        await stub.evaluate(async ([d]) => {
            await (window as any).writeResource(d, "Gain.dsp", "process = nope;");
            (window as any).ring({ type: "resource-changed", document: d, file: "Gain.dsp", name: "Gain", sha1: "x" });
        }, [doc]);
        await waitReceived(stub, "applied");
        const answer = (await received(stub, "applied"))[0];
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/nope/);
        expect(await codes(page)).toEqual([GAIN]);
        // a step of the scene (autosave): the file is not written back
        await page.evaluate(() => { const s = (globalThis as any).faustPlayground.scene; s.markModified(); });
        await flush(page);
        await page.waitForTimeout(600);
        await flush(page);
        expect(await stub.evaluate(([d]) => (window as any).readResource(d, "Gain.dsp"), [doc])).toBe("process = nope;");
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("tells faustcode what faustmodular changes: a code (undo), a rename, a removal", async () => {
        const { context, page, errors } = await openApp();
        const id = await add(page);
        await flush(page);
        const doc = await documentId(page);
        const stub = await openStub(context);
        // an edit in faustmodular (a file dropped on the module), then undone
        await page.evaluate(([m, code]) => (globalThis as any).faustPlayground.scene.editModuleCode((globalThis as any).faustPlayground.scene.getModuleById(m), code), [id, GAIN_HALF]);
        await flush(page);
        await waitReceived(stub, "resource-changed");
        expect(await stub.evaluate(([d]) => (window as any).readResource(d, "Gain.dsp"), [doc])).toBe(GAIN_HALF);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        await flush(page);
        await waitReceived(stub, "resource-changed", 2);
        expect(await stub.evaluate(([d]) => (window as any).readResource(d, "Gain.dsp"), [doc])).toBe(GAIN);
        expect((await received(stub, "resource-changed")).every((m: any) => m.sender == "faustmodular" && m.file == "Gain.dsp")).toBe(true);
        // renamed
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.renameResource("Gain", "Level"))).toBeNull();
        await flush(page);
        await waitReceived(stub, "resource-renamed");
        expect((await received(stub, "resource-renamed"))[0]).toMatchObject({ document: doc, from: "Gain.dsp", to: "Level.dsp", name: "Level" });
        // its last instance removed: the resource stays; removed from the scene: told
        await page.evaluate(() => { const s = (globalThis as any).faustPlayground.scene; s.getModules()[0].deleteModule(); });
        await flush(page);
        expect((await received(stub, "resource-removed")).length).toBe(0);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.removeResource("Level"));
        await flush(page);
        await waitReceived(stub, "resource-removed");
        expect((await received(stub, "resource-removed"))[0]).toMatchObject({ document: doc, file: "Level.dsp" });
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);

    it("a resource added by faustcode (Save as ▸ faustmodular) becomes a resource and an instance of the scene", async () => {
        const { context, page, errors } = await openApp();
        await flush(page);
        const doc = await documentId(page);
        const stub = await openStub(context);
        await stub.evaluate(async ([d, code]) => {
            await (window as any).writeResource(d, "Echo.dsp", code);
            (window as any).ring({ type: "resource-added", document: d, file: "Echo.dsp", name: "Echo", sha1: "x", place: true });
        }, [doc, GAIN]);
        await waitReceived(stub, "applied");
        const added = (await received(stub, "applied"))[0];
        expect(added.error).toBeUndefined();
        expect(added).toMatchObject({ ok: true, instances: 1, file: "Echo.dsp" });
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.getModules().map((m: any) => m.moduleFaust.getName()))).toEqual(["Echo"]);
        expect(await codes(page)).toEqual([GAIN]);
        expect(errors).toEqual([]);
        await context.close();
    }, 240_000);
});

describe("the context menu of the stage: Modules, New module", () => {
    it("Modules… opens the Modules menu; New module makes a module there and opens it in faustcode", async () => {
        const { context, page, errors } = await openApp();
        await page.mouse.click(700, 500, { button: "right" });
        await page.locator(".context-menu .context-menu-item", { hasText: "Modules" }).click();
        await page.waitForSelector("#libraryContent", { state: "visible" });
        await page.locator("#libraryButtonMenu").click();

        await page.mouse.click(600, 450, { button: "right" });
        const at = await page.evaluate(() => (globalThis as any).faustPlayground.scene.toStage(600, 450));
        const [stub] = await Promise.all([page.waitForEvent("popup"), page.locator(".context-menu .context-menu-item").nth(3).click()]);
        const doc = await documentId(page);
        expect(stub.url()).toContain(`/faustcode/?open=faustmodular%3A${doc}%2FModule.dsp`);
        await stub.waitForLoadState();
        expect(await stub.evaluate(([d]) => (window as any).readResource(d, "Module.dsp"), [doc])).toContain("process = _;");
        const module = await page.evaluate(() => { const m = (globalThis as any).faustPlayground.scene.getModules()[0]; return { x: m.moduleView.x, y: m.moduleView.y }; });
        expect(module.x).toBeCloseTo(at.x, 0);
        expect(module.y).toBeCloseTo(at.y, 0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
