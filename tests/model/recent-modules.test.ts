// The modules added last (src/model/RecentModules.ts): their keys, the newest first, at most 8, a user
// module by its id whatever the address of the page.
import { describe, expect, it } from "vitest";
import { RECENT_KEY, RECENT_MAX, recentKey, recentModules, recordRecent } from "../../src/model/RecentModules";

function memory(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("recent modules", () => {
    it("knows a module by its absolute address, a user module by its id", () => {
        const base = "https://faustmodular.grame.fr/?starter=0";
        expect(recentKey("faust-modules/faustlib/Compressor.dsp", base)).toBe("https://faustmodular.grame.fr/faust-modules/faustlib/Compressor.dsp");
        expect(recentKey("https://faustmodular.grame.fr/faust-modules/faustlib/Compressor.dsp", base)).toBe("https://faustmodular.grame.fr/faust-modules/faustlib/Compressor.dsp");
        expect(recentKey("https://faustmodular.grame.fr/?starter=0#user-module:u12", base)).toBe("#user-module:u12");
        expect(recentKey("https://raw.githubusercontent.com/o/s/HEAD/modules/A/A.dsp", base)).toBe("https://raw.githubusercontent.com/o/s/HEAD/modules/A/A.dsp");
    });

    it("keeps the newest first, once each, at most 8", () => {
        const s = memory();
        expect(recentModules(s)).toEqual([]);
        recordRecent(s, "a");
        recordRecent(s, "b");
        recordRecent(s, "a");
        expect(recentModules(s)).toEqual(["a", "b"]);
        for (let i = 0; i < 12; i++) recordRecent(s, "m" + i);
        expect(recentModules(s)).toHaveLength(RECENT_MAX);
        expect(recentModules(s)[0]).toBe("m11");
    });

    it("survives a storage that fails or holds anything", () => {
        const s = memory();
        s.data.set(RECENT_KEY, "{not json");
        expect(recentModules(s)).toEqual([]);
        s.data.set(RECENT_KEY, JSON.stringify(["a", 3, null, "b"]));
        expect(recentModules(s)).toEqual(["a", "b"]);
        const failing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
        expect(recentModules(failing)).toEqual([]);
        expect(() => recordRecent(failing, "a")).not.toThrow();
        expect(recentModules(null)).toEqual([]);
    });
});
