// The index of the library (public/faust-modules/library-index.json) gives the hash of each module's
// code: it decides whether an instance is a library module or a user module (status by content).
// Rebuilt by `npm run library-index` when a module of the library changes.
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
// @ts-ignore: a Node.js script
import { currentHashes } from "../../scripts/build-library-index.mjs";
import { sha1 } from "../../src/documents/Sha1";

const root = path.resolve(__dirname, "../..");
const index = JSON.parse(readFileSync(path.join(root, "public/faust-modules/library-index.json"), "utf8"));

describe("library index", () => {
    it("is up to date with the modules of the library (npm run library-index)", () => {
        expect(index.modules).toEqual(currentHashes());
    });

    it("uses the hash of the documents", async () => {
        const [p, hash] = Object.entries(index.modules)[0] as [string, string];
        expect(await sha1(readFileSync(path.join(root, "public", p), "utf8"))).toBe(hash);
    });

    it("keeps past versions apart from the current ones", () => {
        const current = new Set(Object.values(index.modules));
        for (const [hash, past] of Object.entries(index.history) as Array<[string, { path: string }]>) {
            expect(current.has(hash)).toBe(false);
            expect(index.modules[past.path] ?? past.path).toBeTruthy();
        }
    });
});
