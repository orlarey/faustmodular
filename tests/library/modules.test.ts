// Every module of the library must compile, and its arity must stay within the
// 32-channel limit of the multi-I/O engine (Documentation/multi-io/PLAN.md, §5.6).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { compileJson } from "../helpers/faust";

const root = path.resolve(__dirname, "../../public/faust-modules");
const index: Record<string, string[]> = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"));
const files = Object.values(index).flat();

describe("library modules", () => {
    it("index.json only references existing files", () => {
        const missing = files.filter(f => !fs.existsSync(path.join(root, "..", f)));
        expect(missing).toEqual([]);
    });

    it("all indexed modules compile, with at most 32 inputs and 32 outputs", async () => {
        const arities: Record<string, string> = {};
        for (const file of files) {
            const json = await compileJson(path.basename(file), fs.readFileSync(path.join(root, "..", file), "utf8"));
            expect(json.inputs, file).toBeLessThanOrEqual(32);
            expect(json.outputs, file).toBeLessThanOrEqual(32);
            arities[file] = `${json.inputs}x${json.outputs}`;
        }
        // Any arity change of a library module affects existing patches: review it explicitly.
        expect(arities).toMatchSnapshot();
    }, 300_000);
});
