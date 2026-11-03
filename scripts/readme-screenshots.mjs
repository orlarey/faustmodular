/*				README-SCREENSHOTS.MJS
    The screenshots of the README (Documentation/screenshots/*.png), made from the application served by Vite
    and driven by Playwright (Chromium), in English, at twice the resolution of the screen.

    npm run screenshots                 (all)
    npm run screenshots -- hero menu    (some)
*/

import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "Documentation/screenshots");
const only = process.argv.slice(2);
const VIEW = { width: 1440, height: 900 };


const server = await createServer({ root, server: { port: 0 }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });

async function open(query = "?starter=0") {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, locale: "en-US" });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn("page error:", e.message));
    await page.goto(url + query);
    await page.waitForFunction(() => globalThis.faustPlayground?.documents?.current, null, { timeout: 60000 });
    await page.waitForTimeout(400);
    return { context, page };
}

// A module of the library at (x, y) of the stage; its id.
const add = (page, file, x, y) => page.evaluate(async ([f, xx, yy]) => {
    const { app, scene } = globalThis.faustPlayground;
    const before = scene.getModules().length;
    app.uploadUrl(app, null, xx, yy, location.origin + "/faust-modules/" + f);
    while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 20));
    return scene.getModules()[before].moduleId;
}, [file, x, y]);

const selector = (page, id) => page.evaluate((m) => "#" + globalThis.faustPlayground.scene.getModuleById(m).moduleView.fModuleContainer.id, id);

// The sequenced voice: Clock → Sequencer → Quantizer → VCO (pitch) → VCF → VCA → speakers, the gate of the
// Sequencer to the ADSR, the envelope to the gain of the VCA; an LFO on the cutoff of the VCF.
async function voice(page) {
    const m = {
        clock: await add(page, "modular/Clock.dsp", 150, 60),
        adsr: await add(page, "modular/ADSR.dsp", 150, 430),
        seq: await add(page, "modular/Sequencer.dsp", 450, 60),
        quant: await add(page, "modular/Quantizer.dsp", 790, 60),
        lfo: await add(page, "modular/LFO.dsp", 790, 380),
        vco: await add(page, "modular/VCO.dsp", 1100, 60),
        vcf: await add(page, "modular/VCF.dsp", 1100, 580),
        vca: await add(page, "modular/VCA.dsp", 1420, 330),
    };
    // the physical modules where the patch leaves room
    await page.evaluate(() => {
        const scene = globalThis.faustPlayground.scene;
        scene["moveModule"](scene.getAudioOutput(), 1760, 380);
        scene["moveModule"](scene.getAudioInput(), 30, 860);
    });
    await page.evaluate(async (m) => {
        const scene = globalThis.faustPlayground.scene;
        const set = (id, label, v) => {
            const module = scene.getModuleById(id);
            const c = module.moduleControles.find((x) => x.itemParam.label == label);
            if (c) scene.restoreParams(module, { [c.itemParam.address]: v });
        };
        set(m.clock, "Tempo", 150);
        const connect = (from, fp, to, tp) => scene.patch.connect({ module: from, port: fp }, { module: to, port: tp });
        const modulate = async (from, fp, to, label) => {
            const widget = scene.widgetsOf(scene.getModuleById(to)).find((w) => w.label == label);
            const [mode] = scene.allowedModesOf(to, widget.address);
            await scene.modulate({ module: from, port: fp }, to, widget.address, mode);
        };
        await modulate(m.clock, 0, m.seq, "Clock");
        connect(m.seq, 0, m.quant, 0);
        await modulate(m.quant, 0, m.vco, "Pitch");
        connect(m.vco, 2, m.vcf, 0);
        await modulate(m.lfo, 0, m.vcf, "Cutoff");
        connect(m.vcf, 0, m.vca, 0);
        await modulate(m.seq, 1, m.adsr, "Gate");
        await modulate(m.adsr, 0, m.vca, "Gain");
        connect(m.vca, 0, "output", 0);
        connect(m.vca, 0, "output", 1);
        await new Promise((r) => setTimeout(r, 800));
        scene.patchView.select([]);
        // a named scene, saved (no dot of modification)
        const documents = globalThis.faustPlayground.documents;
        await documents.rename("Sequenced voice");
        await documents.save();
    }, m);
    return m;
}

// A screenshot of a part of the page: a box around elements, with a margin.
async function clip(page, file, boxes, margin = 24) {
    const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - margin), top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - margin);
    const right = Math.min(VIEW.width, Math.max(...boxes.map((b) => b.x + b.width)) + margin), bottom = Math.min(VIEW.height, Math.max(...boxes.map((b) => b.y + b.height)) + margin);
    await page.screenshot({ path: path.join(out, file), clip: { x: left, y: top, width: right - left, height: bottom - top } });
}
const box = async (page, sel) => page.locator(sel).first().boundingBox();

const shots = {
    async hero() {
        const { context, page } = await open();
        await voice(page);
        await page.evaluate(() => globalThis.faustPlayground.scene.fit());
        await page.waitForTimeout(500);
        await page.mouse.move(VIEW.width - 2, VIEW.height - 2);
        await page.screenshot({ path: path.join(out, "hero.png") });
        await context.close();
    },

    // The first visit: a SineVCO to the speakers.
    async start() {
        const { context, page } = await open("");
        await page.waitForFunction(() => globalThis.faustPlayground.scene.getModules().length > 0, null, { timeout: 60000 });
        await page.waitForTimeout(600);
        await page.mouse.move(VIEW.width - 2, VIEW.height - 2);
        await page.screenshot({ path: path.join(out, "start.png") });
        await context.close();
    },

    // The Modules menu, searching.
    async modules() {
        const { context, page } = await open();
        await page.getByText("Modules", { exact: true }).first().click();
        await page.waitForTimeout(400);
        await page.keyboard.type("reverb", { delay: 40 });
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, "modules.png"), clip: { x: 0, y: 0, width: VIEW.width, height: 600 } });
        await context.close();
    },

    // The menu of an output port: to the speakers.
    async speakers() {
        const { context, page } = await open();
        const vcf = await add(page, "modular/VCF.dsp", 520, 220);
        const vco = await add(page, "modular/VCO.dsp", 160, 160);
        await page.evaluate(([o, f]) => {
            const scene = globalThis.faustPlayground.scene;
            scene.patch.connect({ module: o, port: 2 }, { module: f, port: 0 });
            scene.patch.connect({ module: f, port: 0 }, { module: "output", port: 0 });
            scene.patchView.select([]);
        }, [vco, vcf]);
        await page.waitForTimeout(500);
        const sel = await selector(page, vcf);
        const port = await box(page, `${sel} .port-output`);
        await page.mouse.click(port.x + port.width / 2, port.y + port.height / 2);
        await page.waitForTimeout(300);
        await clip(page, "speakers.png", [await box(page, sel), await box(page, ".context-menu"), await box(page, await selector(page, vco))]);
        await context.close();
    },

    // Modulation: an LFO on the cutoff of a VCF, the ring of its depth; a cable aimed at a widget.
    async modulation() {
        const { context, page } = await open();
        const vcf = await add(page, "modular/VCF.dsp", 560, 140);
        const lfo = await add(page, "modular/LFO.dsp", 180, 260);
        await page.evaluate(async ([l, f]) => {
            const scene = globalThis.faustPlayground.scene;
            const widget = scene.widgetsOf(scene.getModuleById(f)).find((w) => w.label == "Cutoff");
            await scene.modulate({ module: l, port: 0 }, f, widget.address, scene.allowedModesOf(f, widget.address)[0]);
            scene.patchView.select([]);
        }, [lfo, vcf]);
        await page.waitForTimeout(600);
        await clip(page, "modulation.png", [await box(page, await selector(page, vcf)), await box(page, await selector(page, lfo))]);
        await context.close();
    },

    // The Orbit interface of a module.
    async orbit() {
        const { context, page } = await open();
        const vco = await add(page, "modular/VCO.dsp", 300, 120);
        await page.evaluate((o) => {
            const scene = globalThis.faustPlayground.scene;
            scene.toggleOrbit([o]);
            scene.patchView.select([]);
        }, vco);
        await page.waitForTimeout(900);
        await clip(page, "orbit.png", [await box(page, await selector(page, vco))]);
        await context.close();
    },

    // The interface of a module: groups, knobs, a value typed.
    async interface() {
        const { context, page } = await open();
        const comp = await add(page, "faustlib/Compressor.dsp", 220, 120);
        const eq = await add(page, "faustlib/ParametricEQ.dsp", 760, 120);
        await page.evaluate(() => globalThis.faustPlayground.scene.patchView.select([]));
        await page.waitForTimeout(500);
        await clip(page, "interface.png", [await box(page, await selector(page, comp)), await box(page, await selector(page, eq))]);
        await context.close();
    },

    // The magnifier: zoomed out, the module under the pointer at its real size.
    async magnifier() {
        const { context, page } = await open();
        const m = await voice(page);
        await page.evaluate(() => globalThis.faustPlayground.scene.setView(0.42, 150, 140));
        await page.waitForTimeout(300);
        const vcf = await box(page, await selector(page, m.vcf));
        await page.mouse.move(vcf.x + vcf.width / 2, vcf.y + vcf.height * 0.4, { steps: 4 });
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(out, "magnifier.png") });
        await context.close();
    },

    // The alignment guides: the centres of two modules, the edges of another.
    async align() {
        const { context, page } = await open();
        const a = await add(page, "modular/VCO.dsp", 200, 120);
        const b = await add(page, "modular/VCA.dsp", 600, 300);
        await page.evaluate(() => globalThis.faustPlayground.scene.patchView.select([]));
        await page.waitForTimeout(400);
        const sa = await selector(page, a), sb = await selector(page, b);
        const ba = await box(page, sa), bb = await box(page, sb);
        // VCA dragged by its title so that its centre comes 2 px from the centre of the VCO, under it
        const grab = { x: bb.x + bb.width / 2, y: bb.y + 14 };
        const target = { x: grab.x + (ba.x + ba.width / 2) - (bb.x + bb.width / 2) + 2, y: ba.y + ba.height + 60 + 14 };
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 12 });
        await page.waitForTimeout(200);
        await clip(page, "align.png", [ba, await box(page, sb)], 50);
        await page.mouse.up();
        await context.close();
    },

    // The File menu.
    async file() {
        const { context, page } = await open();
        await voice(page);
        await page.evaluate(() => globalThis.faustPlayground.scene.fit());
        await page.getByText("File", { exact: true }).first().click();
        await page.waitForTimeout(300);
        await clip(page, "file.png", [await box(page, ".context-menu"), { x: 0, y: 0, width: 420, height: 40 }], 16);
        await context.close();
    },

    // The volume on the speaker of the output module, being set.
    async volume() {
        const { context, page } = await open();
        const sine = await add(page, "modular/SineVCO.dsp", 900, 300);
        await page.evaluate((s) => {
            const scene = globalThis.faustPlayground.scene;
            scene.patch.connectBus(s, "output");
            scene.patchView.select([]);
        }, sine);
        await page.waitForTimeout(400);
        const icon = await box(page, "#moduleOutput .volume-icon");
        await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
        await page.mouse.down();
        await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2 + 6, { steps: 2 });
        await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2 + 35, { steps: 6 });
        await page.waitForTimeout(150);
        await clip(page, "volume.png", [await box(page, "#moduleOutput"), await box(page, await selector(page, sine))], 30);
        await page.mouse.up();
        await context.close();
    },
};

for (const [name, shot] of Object.entries(shots)) {
    if (only.length && !only.includes(name)) continue;
    console.log(name);
    await shot();
}
await browser.close();
await server.close();
