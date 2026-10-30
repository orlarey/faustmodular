// Web Audio behaviours the multi-channel engine relies on, measured in Chromium (Playwright).
// Usage: node Documentation/multi-io/probes/webaudio.cjs
const { chromium } = require("playwright");

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const r = await page.evaluate(async () => {
        const res = {};
        const C = (n = 128) => new OfflineAudioContext(4, n, 48000);
        // 1) fan-in is summed on a merger input; selective disconnect(dest, out, in) works
        let ctx = C();
        const c1 = new ConstantSourceNode(ctx, { offset: 1 }), c2 = new ConstantSourceNode(ctx, { offset: 2 });
        const m = new ChannelMergerNode(ctx, { numberOfInputs: 4 });
        c1.connect(m, 0, 0); c2.connect(m, 0, 0); c2.connect(m, 0, 2);
        c2.disconnect(m, 0, 2);
        m.connect(ctx.destination); c1.start(); c2.start();
        let buf = await ctx.startRendering();
        res.mergerSum = [0, 1, 2, 3].map(i => buf.getChannelData(i)[10]);
        // 2) cycle without DelayNode: the feedback path contributes nothing
        ctx = C();
        const s = new ConstantSourceNode(ctx, { offset: 1 }), g1 = new GainNode(ctx, { gain: 0.5 }), g2 = new GainNode(ctx, { gain: 0.5 });
        s.connect(g1); g1.connect(g2); g2.connect(g1); g1.connect(ctx.destination); s.start();
        buf = await ctx.startRendering();
        res.cycleNoDelay = buf.getChannelData(0)[10];
        // 3) cycle with DelayNode(0): delay is clamped to one render quantum (128 samples)
        ctx = C(512);
        const s3 = new ConstantSourceNode(ctx, { offset: 1 }), g3 = new GainNode(ctx, { gain: 0.5 }), d = new DelayNode(ctx, { delayTime: 0 });
        s3.connect(g3); g3.connect(d); d.connect(g3); g3.connect(ctx.destination); s3.start();
        buf = await ctx.startRendering();
        const ch = buf.getChannelData(0);
        res.cycleWithDelay = [0, 127, 128, 255, 256, 384].map(i => ch[i]);
        // 4) channel limits of splitter / merger
        try { new ChannelMergerNode(ctx, { numberOfInputs: 33 }); res.merger33 = "ok"; } catch (e) { res.merger33 = e.name; }
        try { new ChannelSplitterNode(ctx, { numberOfOutputs: 33 }); res.splitter33 = "ok"; } catch (e) { res.splitter33 = e.name; }
        return res;
    });
    console.log(JSON.stringify(r, null, 1));
    await browser.close();
})();
