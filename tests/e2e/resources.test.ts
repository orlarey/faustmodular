// The resources of a scene (Documentation/SCENE-RESOURCES-SPEC.md): modules of the same name and code share a
// resource; editing one module edits its resource, so all its instances (R4); Make unique and Rename, undone
// by Ctrl-Z; a file with two codes under one name is opened as two resources; a resource without instance
// stays, and can be removed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, Page } from "playwright";
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

const GAIN = 'process = *(hslider("gain", 0.5, 0, 1, 0.01));';
const GAIN2 = 'process = *(hslider("gain", 0.5, 0, 1, 0.01)) : *(0.5);';

async function open(): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url + "?starter=0");
    await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
    return { page, errors };
}

// The modules: id, name, user's code, and their parameters.
const modules = (page: Page) => page.evaluate(() => {
    const { scene } = (globalThis as any).faustPlayground;
    return scene.getModules().map((m: any) => {
        const source: string = m.moduleFaust.getSource();
        const code = /environment\{\n([\s\S]*)\n\}\.process/.exec(source)?.[1] ?? source;
        const params: Record<string, string> = {};
        m.moduleControles.forEach((c: any) => { params[c.itemParam.address] = c.value; });
        return { id: m.moduleId as string, name: m.moduleFaust.getName() as string, code, params };
    });
});
const resources = (page: Page) => page.evaluate(() => (globalThis as any).faustPlayground.scene.getResources().map((r: any) => r.name).sort());
const add = (page: Page, name: string, code: string) => page.evaluate(async ([name, code]) => {
    const m = await (globalThis as any).faustPlayground.scene.addModuleFromCode(name, code, { x: 200 + Math.random() * 400, y: 200 });
    return typeof m == "string" ? m : m.moduleId as string;
}, [name, code]);

describe("the resources of a scene", () => {
    it("shares a resource; an edit reaches all its instances; Make unique; Rename, undone", async () => {
        const { page, errors } = await open();
        const a = await add(page, "Gain", GAIN);
        const b = await add(page, "Gain", GAIN);
        expect((await modules(page)).map((m) => m.name)).toEqual(["Gain", "Gain"]);
        expect(await resources(page)).toEqual(["Gain"]);

        // an edit of one module: both instances
        expect(await page.evaluate(([id, code]) => { const s = (globalThis as any).faustPlayground.scene; return s.editModuleCode(s.getModuleById(id), code); }, [a, GAIN2])).toBeNull();
        expect((await modules(page)).map((m) => m.code)).toEqual([GAIN2, GAIN2]);
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.lastEditedInstances)).toBe(2);

        // a value on b, then b made unique: its own resource, its value kept
        await page.evaluate((id) => { const m = (globalThis as any).faustPlayground.scene.getModuleById(id); m.moduleControles[0].faustInterfaceView.slider.value = "80"; m.moduleControles[0].faustInterfaceView.slider.dispatchEvent(new Event("input")); }, b);
        const value = (await modules(page))[1].params["/Gain/gain"];
        expect(value).not.toBe("0.5");
        expect(await page.evaluate((id) => { const s = (globalThis as any).faustPlayground.scene; return s.makeUnique(s.getModuleById(id)); }, b)).toBeNull();
        let ms = await modules(page);
        expect(ms.map((m) => m.name)).toEqual(["Gain", "Gain-2"]);
        expect(ms[1].params).toEqual({ "/Gain-2/gain": value });
        expect(await resources(page)).toEqual(["Gain", "Gain-2"]);
        // editing Gain no longer touches Gain-2
        await page.evaluate(([id, code]) => { const s = (globalThis as any).faustPlayground.scene; return s.editModuleCode(s.getModuleById(id), code); }, [a, GAIN]);
        ms = await modules(page);
        expect(ms.map((m) => m.code)).toEqual([GAIN, GAIN2]);

        // rename Gain-2, then undo
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.renameResource("Gain-2", "Half"))).toBeNull();
        ms = await modules(page);
        expect(ms[1]).toMatchObject({ name: "Half", params: { "/Half/gain": value } });
        expect(await page.evaluate(() => (globalThis as any).faustPlayground.scene.renameResource("Half", "Gain"))).toMatch(/Gain/);   // taken
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.undo());
        ms = await modules(page);
        expect(ms[1]).toMatchObject({ name: "Gain-2", params: { "/Gain-2/gain": value } });
        expect(errors).toEqual([]);
        await page.close();
    }, 240_000);

    it("opens a file holding two codes under one name as two resources; a resource without instance stays, removable", async () => {
        const { page, errors } = await open();
        await page.evaluate(async ([g1, g2]) => {
            const { scene } = (globalThis as any).faustPlayground;
            const file = JSON.parse(scene.saveScene(false));
            file.version = 3;
            delete file.resources;
            const wrap = (code: string) => `process = vgroup("Gain",environment{\n${code}\n}.process);`;
            file.modules.push({ id: "1", kind: "faust", name: "Gain", code: wrap(g1), x: 100, y: 100, inputs: 1, outputs: 1, params: { "/Gain/gain": 0.1 }, acc: [] });
            file.modules.push({ id: "2", kind: "faust", name: "Gain", code: wrap(g2), x: 400, y: 100, inputs: 1, outputs: 1, params: { "/Gain/gain": 0.2 }, acc: [] });
            await scene.recallScene(JSON.stringify(file));
        }, [GAIN, GAIN2]);
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.getModules().length == 2, null, { timeout: 60_000 });
        const ms = await modules(page);
        expect(ms.map((m) => [m.name, m.code, m.params])).toEqual([["Gain", GAIN, { "/Gain/gain": "0.1" }], ["Gain-2", GAIN2, { "/Gain-2/gain": "0.2" }]]);
        // the last instance of Gain-2 removed: the resource stays, then is removed
        await page.evaluate(() => { const s = (globalThis as any).faustPlayground.scene; s.getModules()[1].deleteModule(); });
        expect(await resources(page)).toEqual(["Gain", "Gain-2"]);
        await page.evaluate(() => (globalThis as any).faustPlayground.scene.removeResource("Gain-2"));
        expect(await resources(page)).toEqual(["Gain"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 240_000);

    it("a code dropped on a module replaces the code of its resource; adding the same code again reuses the resource", async () => {
        const { page, errors } = await open();
        const a = await add(page, "Gain", GAIN);
        await add(page, "Gain", GAIN);
        await page.evaluate(([id, code]) => { const s = (globalThis as any).faustPlayground.scene; return s.getModuleById(id).update("Dropped", `process = vgroup("Dropped",environment{\n${code}\n}.process);`); }, [a, GAIN2]);
        expect((await modules(page)).map((m) => [m.name, m.code])).toEqual([["Gain", GAIN2], ["Gain", GAIN2]]);
        await add(page, "Gain", GAIN);           // another code under this name: a new resource
        await add(page, "Gain", GAIN2);          // the code of Gain: an instance of it
        expect((await modules(page)).map((m) => m.name)).toEqual(["Gain", "Gain", "Gain-2", "Gain"]);
        expect(errors).toEqual([]);
        await page.close();
    }, 240_000);
});
