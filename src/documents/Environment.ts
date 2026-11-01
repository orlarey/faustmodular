/*				ENVIRONMENT.TS
    The environment of libraries shipped with the application (Documentation/DOCUMENT-SPEC.md,
    "Les bibliothèques Faust sont épinglées"): the .lib files libfaust reads, stored once by hash.
    A new document records it, with the version of libfaust.
*/

import type { FaustCompiler } from "@grame/faustwasm";
import type { FaustEnvironment } from "./DocumentFormat";
import type { DocumentStore } from "./DocumentStore";

export const LIBRARIES_DIRECTORY = "/usr/share/faust";

export function shippedLibraries(compiler: FaustCompiler): Map<string, string> {
    const fs = compiler.fs();
    const files = new Map<string, string>();
    for (const name of fs.readdir(LIBRARIES_DIRECTORY) as string[]) {
        if (!name.endsWith(".lib")) continue;
        files.set(name, fs.readFile(`${LIBRARIES_DIRECTORY}/${name}`, { encoding: "utf8" }) as string);
    }
    return files;
}

export async function shippedEnvironment(compiler: FaustCompiler, store: DocumentStore): Promise<FaustEnvironment> {
    return { libfaust: compiler.version(), libraries: await store.putEnvironment(shippedLibraries(compiler)) };
}
