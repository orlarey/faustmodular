// What a module shows of its signals (Modules/Displays.ts): bargraphs, declared oscilloscope or spectrum.
import { describe, expect, it } from "vitest";
import { barFraction, bargraphsOf, declaredDisplay, Sweep } from "../../src/Modules/Displays";

describe("displays", () => {
    it("finds the bargraphs of a module, in nested groups", () => {
        const ui = [{ type: "vgroup", label: "M", address: "/M", items: [
            { type: "hslider", label: "gain", address: "/M/gain" },
            { type: "hgroup", label: "G", address: "/M/G", items: [{ type: "vbargraph", label: "level", address: "/M/G/level", min: -70, max: 0 }] },
            { type: "hbargraph", label: "value", address: "/M/value", min: -1, max: 1 },
        ] }];
        expect(bargraphsOf(ui).map((b) => b.address)).toEqual(["/M/G/level", "/M/value"]);
    });

    it("reads the display a module declares", () => {
        expect(declaredDisplay({ meta: [{ name: "Scope" }, { display: "scope" }] })).toBe("scope");
        expect(declaredDisplay({ meta: [{ display: " Spectrum " }] })).toBe("spectrum");
        expect(declaredDisplay({ meta: [{ display: "other" }] })).toBeNull();
        expect(declaredDisplay({})).toBeNull();
    });

    it("fills a bar in proportion, within [0, 1]", () => {
        expect(barFraction(-35, -70, 0)).toBe(0.5);
        expect(barFraction(10, -70, 0)).toBe(1);
        expect(barFraction(-100, -70, 0)).toBe(0);
        expect(barFraction(NaN, 0, 1)).toBe(0);
        expect(barFraction(1, 1, 1)).toBe(0);
    });

    // An envelope triggered at 60 bpm (a decay of 0.3 s every second, from 0), seen over 1 s: each image starts at the
    // same place on the attack, whatever the frames (the image is stable, it does not scroll).
    it("triggers a long duration: each image starts on the crossing, after the pre-trigger, and stays until the next", () => {
        const rate = 1000;                                             // samples per second, for the test
        const env = (n: number) => { const t = (n % rate) / rate; return t < 0.3 ? 1 - t / 0.3 : 0; };
        const sweep = new Sweep(100, 9);                               // 100 columns of 9 samples: 0.9 s, pre-trigger 10
        let n = 0;
        const images: string[] = [];
        for (let frame = 0; frame < 60; frame++) {                     // frames of irregular length
            const fresh = 40 + (frame * 37) % 70;
            const data = Float32Array.from({ length: fresh }, (_, i) => env(n + i));
            n += fresh;
            sweep.push(0, data, 0, 0.5, "rising", false);
            if (!sweep.sweeping && sweep.image.length == 100) images.push(JSON.stringify(sweep.image));
        }
        expect(images.length).toBeGreaterThan(0);
        // every complete image the same: the pre-trigger (at 0), then the attack at column 10
        expect(new Set(images).size).toBe(1);
        const image = JSON.parse(images[0]);
        expect(image.slice(0, 10).every((c: [number, number]) => c[1] == 0)).toBe(true);
        expect(image[10][1]).toBe(1);
    });

    it("runs free in auto mode without a crossing, and waits in normal mode", () => {
        const flat = new Float32Array(500).fill(0.2);
        const auto = new Sweep(20, 5);
        auto.push(0, flat, 0, 0.5, "rising", true);
        expect(auto.image.length).toBeGreaterThan(0);
        const normal = new Sweep(20, 5);
        normal.push(0, flat, 0, 0.5, "rising", false);
        expect(normal.image.length).toBe(0);
        // a falling crossing with the falling slope
        const down = new Sweep(20, 5);
        down.push(0, Float32Array.from([1, 1, 1, 0, 0]), 0, 0.5, "falling", false);
        expect(down.sweeping).toBe(true);
    });
});
