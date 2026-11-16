import { describe, expect, it } from "vitest";
import { CHANNEL, faustcodeUrl, openResourceUrl, parseResourceMessage } from "../../src/documents/ResourceLink";

const env = { channel: CHANNEL, version: 1, sender: "faustcode" };

describe("the channel with faustcode", () => {
    it("reads the messages, and nothing else", () => {
        expect(parseResourceMessage({ ...env, type: "resource-changed", document: "d", file: "VCO.dsp", name: "VCO", sha1: "x" })).not.toBeNull();
        expect(parseResourceMessage({ ...env, type: "opened", request: "r" })).not.toBeNull();
        expect(parseResourceMessage({ ...env, type: "applied", document: "d", file: "VCO.dsp", name: "VCO", sha1: "x", ok: true, instances: 2 })).not.toBeNull();
        expect(parseResourceMessage({ ...env, type: "applied", document: "d", file: "VCO.dsp", name: "VCO", sha1: "x", ok: true })).toBeNull();
        expect(parseResourceMessage({ ...env, version: 2, type: "opened", request: "r" })).toBeNull();
        expect(parseResourceMessage({ ...env, channel: "other", type: "opened", request: "r" })).toBeNull();
        expect(parseResourceMessage({ ...env, sender: "x", type: "opened", request: "r" })).toBeNull();
        expect(parseResourceMessage({ ...env, type: "unknown" })).toBeNull();
        expect(parseResourceMessage({ ...env, type: "resource-changed", document: "d", file: "VCO.dsp", name: "VCO" })).toBeNull();
        expect(parseResourceMessage(null)).toBeNull();
    });

    it("refuses a file that is a path", () => {
        expect(parseResourceMessage({ ...env, type: "resource-changed", document: "d", file: "../index.json", name: "x", sha1: "x" })).toBeNull();
        expect(parseResourceMessage({ ...env, type: "resource-changed", document: "d", file: "a/b.dsp", name: "x", sha1: "x" })).toBeNull();
        expect(parseResourceMessage({ ...env, type: "resource-changed", document: "d", file: "VCO.txt", name: "x", sha1: "x" })).toBeNull();
    });

    it("finds faustcode next to faustmodular, or at an address of the same origin", () => {
        expect(faustcodeUrl("https://orlarey.github.io/faustmodular/")).toBe("https://orlarey.github.io/faustcode/");
        expect(faustcodeUrl("http://localhost:5173/")).toBe("http://localhost:5173/faustcode/");
        expect(faustcodeUrl("http://localhost:5173/?faustcode=/fc/")).toBe("http://localhost:5173/fc/");
        expect(faustcodeUrl("https://orlarey.github.io/faustmodular/?faustcode=https://evil.example/")).toBe("https://orlarey.github.io/faustcode/");
    });

    it("opens a resource by its document and its file", () => {
        expect(openResourceUrl("https://orlarey.github.io/faustcode/", "abc", "VCO-2.dsp")).toBe("https://orlarey.github.io/faustcode/?open=faustmodular%3Aabc%2FVCO-2.dsp");
    });
});
