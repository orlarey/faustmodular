// A disk in memory for the File System Access API (showOpenFilePicker, showSaveFilePicker), which
// Playwright cannot drive: installed before the pages of a context load. window.__files holds the
// files (name -> content); window.__nextOpen names the file the next Open picks (none: cancelled);
// window.__nextSave the file the next Save as picks (none: the name suggested); window.__pickers
// counts the pickers shown.
import type { BrowserContext, Page } from "playwright";

export async function installFakeFiles(target: BrowserContext | Page): Promise<void> {
    await target.addInitScript(() => {
        const w = window as any;
        w.__files = {};
        w.__pickers = { open: 0, save: 0 };
        w.__nextOpen = null;
        w.__nextSave = null;
        const handle = (name: string) => ({
            kind: "file",
            name,
            getFile: async () => new File([w.__files[name] ?? ""], name),
            createWritable: async () => {
                let content = "";
                return {
                    write: async (data: Blob | string) => { content += typeof data == "string" ? data : await data.text(); },
                    close: async () => { w.__files[name] = content; },
                };
            },
            queryPermission: async () => "granted",
            requestPermission: async () => "granted",
        });
        w.showOpenFilePicker = async () => {
            w.__pickers.open++;
            if (!w.__nextOpen) throw new DOMException("cancelled", "AbortError");
            return [handle(w.__nextOpen)];
        };
        w.showSaveFilePicker = async (options: { suggestedName?: string }) => {
            w.__pickers.save++;
            return handle(w.__nextSave ?? options?.suggestedName ?? "scene.jfaust");
        };
    });
}

export const files = (page: Page) => page.evaluate(() => ({ files: (window as any).__files as Record<string, string>, pickers: (window as any).__pickers as { open: number; save: number } }));
