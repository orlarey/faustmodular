// ● Record in the transport (src/audio/Recorder.ts): a Sync Clock to the output, a recording of one bar asked with the
// transport stopped. The transport starts, the file is downloaded: WAV 24 bits, one bar exactly (2 s at 120 BPM),
// and the gates of the Sync Clock in it at the very samples where the timeline reaches each sixteenth: the
// recording starts at the start of the bar, to the sample.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, Browser } from "playwright";
import { createServer, ViteDevServer } from "vite";
import path from "path";
import fs from "fs";
import { frameOfTick } from "../../src/audio/Recording";
import type { TimelineRule } from "../../src/sync/TimelineCore";
import { github } from "../helpers/github";
import { decodeFlac } from "../helpers/flac-decode";
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

// The samples of a WAV PCM 24 bits: one array per channel.
function readWav(bytes: Buffer): { sampleRate: number; channels: number[][] } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = view.getUint16(22, true), sampleRate = view.getUint32(24, true), bits = view.getUint16(34, true);
    expect(bits).toBe(24);
    const fmtSize = view.getUint32(16, true);
    const data = 12 + 8 + fmtSize + 8;
    const frames = view.getUint32(data - 4, true) / (3 * n);
    const channels = Array.from({ length: n }, () => new Array<number>(frames));
    for (let i = 0; i < frames; i++) {
        for (let c = 0; c < n; c++) {
            const o = data + (i * n + c) * 3;
            const x = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
            channels[c][i] = (x & 0x800000 ? x - 0x1000000 : x) / 8388607;
        }
    }
    return { sampleRate, channels };
}

// A page with a Sync Clock to the output (its gate on both channels).
async function sceneWithClock(page: import("playwright").Page, search = "?starter=0"): Promise<void> {
        await page.goto(url + search);
        await page.waitForFunction(() => (globalThis as any).faustPlayground?.scene?.recorder && (globalThis as any).faustPlayground?.documents?.current, null, { timeout: 60_000 });
        await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            app.uploadUrl(app, null, 300, 150, location.origin + "/faust-modules/modular/SyncClock.dsp");
            while (scene.getModules().length == 0) await new Promise((r) => setTimeout(r, 20));
            const id = scene.getModules()[0].moduleId;
            while (!scene.audioGraph.getNode(id)) await new Promise((r) => setTimeout(r, 20));
            scene.patch.connect({ module: id, port: 0 }, { module: "output", port: 0 });
            scene.patch.connect({ module: id, port: 0 }, { module: "output", port: 1 });
            const ac = scene.masterVolume.node.context as AudioContext;
            await ac.resume();
            await new Promise((r) => setTimeout(r, 300));
        });
}

// ● ▸ a choice of its menu.
async function recordMenu(page: import("playwright").Page, item: string): Promise<void> {
    await page.locator(".transportRecord").click();
    await page.locator(".context-menu-item", { hasText: item }).click();
}

describe("recording from the transport", () => {
    it("records one bar from its start, to the sample, as a WAV 24 bits", async () => {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await sceneWithClock(page);
        // the ● menu: the file WAV, then one bar
        expect(await page.locator(".transportRecord").isVisible()).toBe(true);
        const download = page.waitForEvent("download", { timeout: 30_000 });
        await recordMenu(page, "File: WAV");
        await recordMenu(page, "Record 1 bars");
        const file = await download;
        const name = file.suggestedFilename();
        expect(name).toMatch(/^[A-Za-z0-9_-]+-\d{8}-\d{6}\.wav$/);
        const bytes = fs.readFileSync((await file.path())!);
        const { sampleRate, channels } = readWav(bytes);
        const info = await page.evaluate(() => {
            const { scene } = (globalThis as any).faustPlayground;
            const r = scene.recorder;
            return { startFrame: r.startFrame, startTick: r.startTick, rule: scene.sync.rule, material: r.last.material, playing: scene.sync.timeline.playing };
        });
        // one bar of 4/4 at 120 BPM: 2 s exactly; 2 channels
        expect(channels.length).toBe(2);
        expect(channels[0].length).toBe(2 * sampleRate);
        expect(info.startTick % (4 * 960)).toBe(0);
        expect(info.playing).toBe(true);
        // the gates of the Sync Clock (a sixteenth: 240 ticks), at the samples where the timeline reaches them
        const rule = info.rule as TimelineRule;
        const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((k) => frameOfTick(rule, info.startTick + 240 * k)! - info.startFrame);
        const edges: number[] = [];
        const left = channels[0];
        for (let i = 0; i < left.length; i++) if (left[i] > 0.4 && (i == 0 || left[i - 1] <= 0.4)) edges.push(i);
        expect(edges).toEqual(expected);
        expect(edges[0]).toBe(0);
        // its description, for the store
        expect(info.material).toMatchObject({ format: "fauststore-material", kind: "recording", channels: 2, frames: 2 * sampleRate, timeline: { tempo: 120, meter: 4, startTick: info.startTick, lengthTicks: 3840 } });
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);

    it("records in FLAC, then publishes the scene and its recording in one commit, linked", async () => {
        const MANIFEST = JSON.stringify({ format: "fauststore", version: 1, name: "Test store" });
        const gh = github({ "fauststore.json": MANIFEST, "README.md": "# store" });
        const context = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
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
        await sceneWithClock(page, "?starter=0&store=o/r");
        await page.evaluate(async () => {
            const { documents, publishing } = (globalThis as any).faustPlayground;
            await documents.rename("Horloge");
            await publishing.configure("o/r", "good");
        });
        // FLAC (the file by default)
        const download = page.waitForEvent("download", { timeout: 30_000 });
        await recordMenu(page, "File: FLAC");
        await recordMenu(page, "Record 1 bars");
        const file = await download;
        expect(file.suggestedFilename()).toMatch(/^Horloge-\d{8}-\d{6}\.flac$/);
        const local = decodeFlac(new Uint8Array(fs.readFileSync((await file.path())!)));
        expect(local.channels.length).toBe(2);
        expect(local.total).toBe(2 * local.sampleRate);
        expect(local.channels[0][0]).toBeGreaterThan(0.4 * 8388607);    // a gate at the first sample
        // File ▸ Publish the scene and its recording (one store in write: directly)
        await page.waitForFunction(() => (globalThis as any).faustPlayground.scene.recorder.state == "idle");
        const before = gh.head;
        await page.locator("#documentsButtonMenu").click();
        await page.locator(".context-menu-item", { hasText: "Publish the scene and its recording" }).click();
        for (let i = 0; i < 200 && gh.head == before; i++) await new Promise((r) => setTimeout(r, 50));
        expect(gh.head).not.toBe(before);
        expect(gh.commit(gh.head).parents).toEqual([before]);        // one commit
        const files = gh.files();
        expect(files.has("scenes/Horloge/Horloge.jfaust")).toBe(true);
        const flacPath = [...files.keys()].find((k) => /^materials\/Horloge-\d{8}-\d{6}\/Horloge-\d{8}-\d{6}\.flac$/.test(k))!;
        expect(flacPath).toBeTruthy();
        // the media in the store: the same samples as the file downloaded
        const stored = decodeFlac(new Uint8Array(Buffer.from(files.get(flacPath)!, "latin1")));
        expect(Array.from(stored.channels[0])).toEqual(Array.from(local.channels[0]));
        const fiche = JSON.parse(files.get(flacPath.replace(/\.flac$/, ".json"))!);
        expect(fiche).toMatchObject({ kind: "recording", recordingOf: "scenes/Horloge/Horloge.jfaust", frames: 2 * local.sampleRate, timeline: { tempo: 120, meter: 4, lengthTicks: 3840 } });
        const index = parseIndex(JSON.parse(files.get("index.json")!))!;
        expect(index.scenes.find((s) => s.path == "scenes/Horloge/Horloge.jfaust")!.recordings).toEqual([flacPath.replace(/\.flac$/, ".json")]);
        // the link copied recalls the scene of the recording (?recording=)
        // (copied; when the page may not write the clipboard, the message gives it)
        // (after the commit, the store is read again, then the link copied and said)
        await page.waitForFunction(() => /Published to o\/r/.test(document.body.innerText), null, { timeout: 15_000 });
        const link = await page.evaluate(async () => (await navigator.clipboard.readText().catch(() => "")) || (/https?:\S+\?recording=\S+/.exec(document.body.innerText)?.[0] ?? ""));
        expect(link).toMatch(/\?recording=https:\/\/github\.com\/o\/r\/blob\/[0-9a-f]{40}\/materials\//);
        // the scene changed (a second module) and published again: the recording keeps its own
        await page.evaluate(async () => {
            const { app, scene } = (globalThis as any).faustPlayground;
            app.uploadUrl(app, null, 300, 400, location.origin + "/faust-modules/modular/SyncClock.dsp");
            while (scene.getModules().length < 2) await new Promise((r) => setTimeout(r, 20));
        });
        await page.waitForTimeout(600);
        const beforeAgain = gh.head;
        await page.locator("#documentsButtonMenu").click();
        await page.locator(".context-menu-item", { hasText: "Publish the scene to my store" }).click();
        // already in the store: the dialog says it will be replaced
        await page.locator(".publishDialog button", { hasText: "Publish" }).click();
        for (let i = 0; i < 200 && gh.head == beforeAgain; i++) await new Promise((r) => setTimeout(r, 50));
        expect(JSON.parse(gh.files().get("scenes/Horloge/Horloge.jfaust")!).modules.filter((m: any) => m.kind == "faust").length).toBe(2);
        // ?recording= at the head of the branch: the version of the recording (one module), found by its SHA-1
        const recall = await context.newPage();
        recall.on("pageerror", (e) => errors.push(e.message));
        await recall.goto(url + "?starter=0&recording=" + encodeURIComponent("https://github.com/o/r/blob/HEAD/" + flacPath));
        await recall.waitForFunction(() => {
            const fp = (globalThis as any).faustPlayground;
            // a new document (named "Horloge 2" if the name is taken in this browser), with the one module of the recording
            return /^Horloge( \d+)?$/.test(fp?.documents?.current?.name ?? "") && fp.scene.getModules().length == 1;
        }, null, { timeout: 60_000 });
        // said so: the scene of the recording, the one it was made with
        await recall.waitForFunction(() => document.body.innerText.includes("as it was when it was recorded"), null, { timeout: 10_000 });
        expect(new URL(recall.url()).searchParams.get("recording")).toBeNull();
        // the File menu lists the recordings of the store, with their actions
        await recall.locator("#documentsButtonMenu").click();
        await recall.locator(".context-menu-item", { hasText: "Open from a store" }).hover();
        await recall.locator(".context-menu-item", { hasText: "Test store" }).hover();
        expect(await recall.locator(".context-menu-item", { hasText: "Recordings" }).count()).toBeGreaterThan(0);
        expect(errors).toEqual([]);
        await context.close();
    }, 120_000);
});
