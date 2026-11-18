// faustcode's Open… and Revert to saved (faustcode, spec_documents.md, « La boîte Ouvrir », « Enregistrer et
// compiler »), with faustmodular served by the same origin: the volumes, the documents of the Library, the scenes of
// faustmodular and their resources; a working copy reverted to the saved content. Skipped without faustcode.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import fs from "fs";
import path from "path";
import zlib from "zlib";

const FAUSTCODE = path.join(process.env.FAUSTCODE_DIR ?? path.resolve(__dirname, "../../../faustcode"), "webapp", "index.html");
const present = fs.existsSync(FAUSTCODE);

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
    if (!present) return;
    server = await createServer({ root: path.resolve(__dirname, "../.."), server: { port: 0 }, logLevel: "error" });
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await chromium.launch();     // the autoplay policy of a real browser: faustcode opens without a gesture
}, 60_000);

afterAll(async () => {
    await browser?.close();
    await server?.close();
});

const GAIN = 'import("stdfaust.lib");\nprocess = *(hslider("gain", 0.5, 0, 1, 0.01));';

const label = (fc: Page) => fc.evaluate(() => document.getElementById("session-label")?.textContent ?? "");
const editorText = (fc: Page) => fc.evaluate(() => document.querySelector("#view-container .cm-content")?.textContent ?? "");
const rows = (fc: Page) => fc.evaluate(() => Array.from(document.querySelectorAll(".open-dialog .open-row .store-module-name")).map((e) => e.textContent!.trim()));
const crumbs = (fc: Page) => fc.evaluate(() => document.querySelector(".open-dialog .open-crumbs")?.textContent ?? "");
const menu = async (fc: Page, item: string) => {
    await fc.click("#file-menu-btn");
    await fc.locator(".file-menu .file-menu-item", { hasText: item }).first().click();
};

describe.skipIf(!present)("faustcode: Open… and Revert to saved", () => {
    it("opens from the volumes, where the document is; reverts the working copy", async () => {
        const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push("faustmodular: " + e.message));
        await page.goto(url + "?starter=0");
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        await page.evaluate(async (code) => (await (globalThis as any).faustPlayground.scene.addModuleFromCode("Gain", code, { x: 300, y: 200 })).moduleId, GAIN);
        await page.evaluate(() => (globalThis as any).faustPlayground.documents.flush());

        const fc = await context.newPage();
        fc.on("pageerror", (e) => errors.push("faustcode: " + e.message));
        fc.on("dialog", (d) => void d.accept());
        await fc.goto(url + "faustcode/");
        // no ENTER screen: faustcode lands on a document (a blank one, the first time)
        await expect.poll(() => label(fc), { timeout: 60_000 }).toMatch(/\.dsp/);
        expect(await fc.locator("#audio-gate:not(.hidden)").count()).toBe(0);

        // a document of the Library: New file, saved
        await menu(fc, "New file");
        await expect.poll(() => label(fc), { timeout: 30_000 }).toMatch(/^untitled.*\.dsp$/);
        const name = (await label(fc)).trim();
        if (!(await fc.locator("#view-container .cm-content").count())) await fc.selectOption("#view-select", "dsp");
        await expect.poll(() => editorText(fc), { timeout: 20_000 }).not.toBe("");
        const saved = await editorText(fc);

        // Revert to saved: the working copy goes, ● too
        await fc.click("#view-container .cm-content");
        await fc.keyboard.press("End");
        await fc.keyboard.type(" // changed");
        await expect.poll(() => label(fc)).toContain("●");
        await menu(fc, "Revert to saved");
        await expect.poll(() => label(fc)).toBe(name);
        expect(await editorText(fc)).toBe(saved);

        // Cmd/Ctrl-O: the four volumes, the Library with the open document checked
        await fc.keyboard.press("Control+o");
        await fc.waitForSelector(".open-dialog");
        expect(await fc.evaluate(() => Array.from(document.querySelectorAll(".open-volume")).map((b) => b.textContent))).toEqual(["Library", "Disk", "Stores", "faustmodular"]);
        expect(await rows(fc)).toContain(`✓ ${name}`);
        await fc.fill(".open-search", "nothing-like-this");
        expect(await rows(fc)).toEqual([]);
        await fc.fill(".open-search", "");

        // faustmodular ▸ its scene ▸ the resource Gain: opened as a document whose origin is the resource
        await fc.click(".open-volume[data-volume=faustmodular]");
        await expect.poll(() => rows(fc)).toContain("Untitled");
        await fc.locator(".open-dialog .open-row", { hasText: "Untitled" }).click();
        await expect.poll(() => rows(fc)).toEqual(["Gain"]);
        expect(await crumbs(fc)).toBe("faustmodular ▸ Untitled");
        await fc.locator(".open-dialog .open-row", { hasText: "Gain" }).click();
        await expect.poll(() => label(fc), { timeout: 30_000 }).toBe("Gain.dsp — faustmodular ▸ Untitled ▸ Gain");
        expect(await fc.locator(".open-dialog").count()).toBe(0);

        // a click on the origin in the header: Open… where the document is
        await fc.click("#session-label");
        await fc.waitForSelector(".open-dialog");
        await expect.poll(() => crumbs(fc)).toBe("faustmodular ▸ Untitled");
        await expect.poll(() => rows(fc)).toEqual(["✓ Gain"]);
        // Backspace in the empty search: up one level; Escape closes
        await fc.focus(".open-search");
        await fc.keyboard.press("Backspace");
        await expect.poll(() => crumbs(fc)).toBe("faustmodular");
        await fc.keyboard.press("Escape");
        expect(await fc.locator(".open-dialog").count()).toBe(0);

        // back to the Library document, with the search and Enter
        await fc.keyboard.press("Control+o");
        await fc.click(".open-volume[data-volume=library]");
        await fc.fill(".open-search", name.replace(/\.dsp$/, ""));
        await fc.keyboard.press("Enter");
        await expect.poll(() => label(fc), { timeout: 30_000 }).toBe(name);

        // Stores: none followed, said; Disk: Open a file of the device…
        await fc.keyboard.press("Control+o");
        await fc.click(".open-volume[data-volume=stores]");
        await expect.poll(() => fc.textContent(".open-dialog .open-list")).toContain("No store followed");
        await fc.click(".open-volume[data-volume=disk]");
        await expect.poll(() => fc.textContent(".open-dialog .open-actions")).toContain("Open a file of the device…");
        await fc.keyboard.press("Escape");

        expect(errors).toEqual([]);
        await context.close();
    }, 180_000);

    it("opens without ENTER; the speaker of the Run view starts the sound; a shared link on a phone keeps Tap to play", async () => {
        const code = zlib.deflateRawSync(Buffer.from('import("stdfaust.lib");\nprocess = os.osc(440) * hslider("gain", 0.1, 0, 1, 0.01);')).toString("base64url");
        const link = url + `faustcode/?code=${code}&name=Sine.dsp&view=run`;
        const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
        const fc = await context.newPage();
        const errors: string[] = [];
        fc.on("pageerror", (e) => errors.push(e.message));
        await fc.goto(link);
        await expect.poll(() => label(fc), { timeout: 60_000 }).toBe("Sine.dsp");
        expect(await fc.locator("#audio-gate:not(.hidden)").count()).toBe(0);
        const speaker = () => fc.evaluate(() => document.getElementById("run-audio-toggle")?.className ?? "");
        await expect.poll(speaker, { timeout: 30_000 }).toContain("is-off");
        await expect.poll(speaker, { timeout: 10_000 }).toContain("awaits-gesture");
        await fc.click("#run-audio-toggle");
        await expect.poll(speaker, { timeout: 20_000 }).toContain("is-on");
        expect(await speaker()).not.toContain("awaits-gesture");
        expect(errors).toEqual([]);
        await context.close();

        // a phone: the shared link shows Tap to play (the sound and the motion sensors in one tap)
        const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const p = await phone.newPage();
        await p.goto(link);
        await p.waitForSelector("#audio-gate:not(.hidden)", { timeout: 60_000 });
        expect(await p.textContent("#audio-gate-button")).toBe("Tap to play");
        await p.tap("#audio-gate-button");
        await p.waitForSelector("#audio-gate.hidden", { state: "attached", timeout: 30_000 });
        await expect.poll(() => p.evaluate(() => document.getElementById("run-audio-toggle")?.className ?? ""), { timeout: 30_000 }).toContain("is-on");
        await phone.close();
    }, 180_000);

    it("mounts a folder: browsed in Open…, a file opened in place with the .lib of its folder, saved, reloaded when changed outside", async () => {
        const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
        const fc = await context.newPage();
        const errors: string[] = [];
        fc.on("pageerror", (e) => errors.push(e.message));
        fc.on("dialog", (d) => void d.accept());
        await fc.goto(url + "faustcode/");
        await expect.poll(() => label(fc), { timeout: 60_000 }).toMatch(/\.dsp/);
        // a folder of the device, played by a folder of the private storage (the same interface): fx/echo.dsp
        // imports fx/mylib.lib, which no document of the Library has
        await fc.evaluate(async () => {
            const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("test-folder", { create: true });
            const fx = await root.getDirectoryHandle("fx", { create: true });
            const put = async (dir: any, name: string, text: string) => { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); };
            await put(root, "top.dsp", "process = _;");
            await put(fx, "mylib.lib", "half = *(0.5);");
            await put(fx, "echo.dsp", 'm = library("mylib.lib");\nprocess = m.half;');
            (window as any).showDirectoryPicker = async () => root;
        });
        const fileText = (path: string[]) => fc.evaluate(async (parts) => {
            let dir: any = await (await navigator.storage.getDirectory()).getDirectoryHandle("test-folder");
            for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
            return (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
        }, path);
        const writeOutside = (text: string) => fc.evaluate(async (t) => {
            await new Promise((r) => setTimeout(r, 30));
            const fx = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("test-folder")).getDirectoryHandle("fx");
            const w = await (await fx.getFileHandle("echo.dsp")).createWritable(); await w.write(t); await w.close();
            window.dispatchEvent(new Event("focus"));
        }, text);
        const compileErrors = () => fc.evaluate(async () => {
            const st = await (await fetch("/api/state")).json();
            return (await (await fetch(`/api/${st.sha1}/errors.log`)).text()).trim();
        });

        // Open… ▸ Disk ▸ Mount a folder…: its content; fx/ browsed
        await fc.keyboard.press("Control+o");
        await fc.click(".open-volume[data-volume=disk]");
        await fc.locator(".open-actions button", { hasText: "Mount a folder…" }).click();
        await expect.poll(() => rows(fc)).toEqual(["fx/", "top.dsp"]);
        expect(await crumbs(fc)).toBe("Disk ▸ test-folder");
        await fc.locator(".open-dialog .open-row", { hasText: "fx/" }).click();
        await expect.poll(() => rows(fc)).toEqual(["echo.dsp", "mylib.lib"]);
        expect(await crumbs(fc)).toBe("Disk ▸ test-folder ▸ fx");

        // echo.dsp opened in place; it compiles with the mylib.lib of its folder
        await fc.locator(".open-dialog .open-row", { hasText: "echo.dsp" }).click();
        await expect.poll(() => label(fc), { timeout: 30_000 }).toBe("echo.dsp — Disk ▸ test-folder/fx/echo.dsp");
        expect(await compileErrors()).toBe("");
        // the folder in the root of Disk, the dialog opened where the document is
        await fc.click("#session-label");
        await expect.poll(() => crumbs(fc)).toBe("Disk ▸ test-folder ▸ fx");
        await expect.poll(() => rows(fc)).toEqual(["✓ echo.dsp", "mylib.lib"]);
        await fc.keyboard.press("Escape");

        // Save writes the file of the folder
        if (!(await fc.locator("#view-container .cm-content").count())) await fc.selectOption("#view-select", "dsp");
        await fc.click("#view-container .cm-content");
        await fc.keyboard.press("Control+a");
        await fc.keyboard.type('m = library("mylib.lib");\nprocess = m.half : m.half;');
        await fc.keyboard.press("Control+s");
        await expect.poll(() => fileText(["fx", "echo.dsp"]), { timeout: 20_000 }).toBe('m = library("mylib.lib");\nprocess = m.half : m.half;');
        await expect.poll(() => label(fc)).toBe("echo.dsp — Disk ▸ test-folder/fx/echo.dsp");

        // changed outside, the document not modified: reloaded
        await writeOutside('m = library("mylib.lib");\nprocess = m.half, m.half;');
        await expect.poll(() => editorText(fc), { timeout: 20_000 }).toBe('m = library("mylib.lib");process = m.half, m.half;');
        expect(await label(fc)).not.toContain("●");

        // changed outside, the document modified: the banner; Reload takes the file
        await fc.click("#view-container .cm-content");
        await fc.keyboard.press("End");
        await fc.keyboard.type(" // mine");
        await expect.poll(() => label(fc)).toContain("●");
        await writeOutside("process = _ * 0.25;");
        await fc.waitForSelector(".app-banner", { timeout: 20_000 });
        await fc.locator(".app-banner button", { hasText: "Reload" }).click();
        await expect.poll(() => editorText(fc), { timeout: 20_000 }).toBe("process = _ * 0.25;");
        await expect.poll(() => label(fc)).toBe("echo.dsp — Disk ▸ test-folder/fx/echo.dsp");

        // the folder of the open document cannot be unmounted
        await fc.keyboard.press("Control+o");
        await fc.click(".open-volume[data-volume=disk]");
        await expect.poll(() => rows(fc)).toContain("test-folder/");
        await fc.locator(".open-dialog .open-row", { hasText: "test-folder/" }).click();
        await fc.locator(".open-actions button", { hasText: "Unmount" }).click();
        await fc.waitForTimeout(300);
        expect(await crumbs(fc)).toBe("Disk ▸ test-folder");
        await fc.keyboard.press("Escape");

        expect(errors).toEqual([]);
        await context.close();
    }, 180_000);
});
