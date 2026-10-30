// Builds the example patches of public/json/ (format version 2) with the application itself:
// - the 1.x examples (tests/fixtures/v1/) are loaded and saved again; the "_Precompile" variants are
//   the same patches saved with their factories, compiled again from the source code (with the
//   current libfaust and options of src/FaustOptions.ts, not reused from the 1.x files);
// - the multichannel example is assembled from modules of the library.
// Usage: node scripts/build-examples.mjs   (needs Chromium for Playwright)
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const server = await createServer({ root, server: { port: 0 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

async function openApp() {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("pageerror", (e) => { throw e; });
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => globalThis.faustPlayground?.scene, null, { timeout: 60_000 });
    return page;
}

function write(name, json) {
    const file = path.join(root, "public/json", name + ".json");
    fs.writeFileSync(file, JSON.stringify(JSON.parse(json), null, 1) + "\n");
    console.log("written", path.relative(root, file));
}

// 1.x examples, saved again as version 2
for (const name of ["Small_Exemple", "Small_Exemple_Precompile", "Big_Exemple", "Big_Exemple_Precompile"]) {
    const page = await openApp();
    const v1 = fs.readFileSync(path.join(root, "tests/fixtures/v1", name.replace("_Precompile", "") + ".json"), "utf8");
    await page.evaluate((json) => globalThis.faustPlayground.scene.recallScene(json), v1);
    const saved = await page.evaluate((precompiled) => globalThis.faustPlayground.scene.saveScene(precompiled), name.endsWith("_Precompile"));
    write(name, saved);
    await page.close();
}

// Multichannel example: the 8 harmonics of an oscillator bank, the first 4 mixed to stereo
// port by port, the last 4 through 4 independent echoes mixed to stereo as a bus.
{
    const page = await openApp();
    const saved = await page.evaluate(async () => {
        const { app, scene } = globalThis.faustPlayground;
        const add = async (file, x, y) => {
            const name = file.split("/").pop().replace(".dsp", "");
            const code = `process = vgroup("${name}",environment{${await (await fetch("faust-modules/" + file)).text()}}.process);`;
            const before = scene.getModules().length;
            await app.compileFaust({ name, sourceCode: code, x, y, callback: (f) => app.createModule(f, name, code, x, y) });
            while (scene.getModules().length == before) await new Promise((r) => setTimeout(r, 50));
            return scene.getModules()[before].moduleId;
        };
        const bank = await add("multichannel/OscillatorBank8.dsp", 250, 150);
        const mixer = await add("multichannel/Mixer4to2.dsp", 700, 80);
        const delay = await add("multichannel/MultiDelay4.dsp", 700, 480);
        const connect = (a, i, b, j) => scene.patch.connect({ module: a, port: i }, { module: b, port: j });
        for (let k = 0; k < 4; k++) {
            connect(bank, k, mixer, k);
            connect(bank, k + 4, delay, k);
        }
        connect(mixer, 0, "output", 0);
        connect(mixer, 1, "output", 1);
        scene.patch.connectBus(delay, "output");
        scene.sceneName = "Multichannel_Example";
        return scene.saveScene(false);
    });
    write("Multichannel_Example", saved);
    await page.close();
}

await browser.close();
await server.close();
