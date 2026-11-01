/*				WIDGETSTYLE.TS
    Styles of the widgets given by the metadata of the Faust code, as faustcode and the Faust UIs
    honour them.
*/

// The choices of a slider shown as a menu or radio buttons, as in faustcode and the Faust UIs:
// [style:menu{'sine':0;'triangle':1}] or [style:radio{'off':0;'on':1}]. null for another style.
export function choicesOf(meta: Array<{ style?: string }> | undefined): { kind: "menu" | "radio"; items: Array<{ label: string; value: number }> } | null {
    for (const m of meta ?? []) {
        const match = /^\s*(menu|radio)\s*\{(.*)\}\s*$/s.exec(m.style ?? "");
        if (!match) continue;
        const items: Array<{ label: string; value: number }> = [];
        // the labels are quoted with ' in the source, and with - in the JSON of the compiled DSP
        for (const item of match[2].matchAll(/(?:'([^']*)'|-([^;:]*?)-)\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
            items.push({ label: item[1] ?? item[2], value: Number(item[3]) });
        }
        if (items.length > 0) return { kind: match[1] as "menu" | "radio", items };
    }
    return null;
}
