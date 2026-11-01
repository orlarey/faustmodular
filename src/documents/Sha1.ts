/*				SHA1.TS
    Identity of a content (Documentation/DOCUMENT-SPEC.md, "Le code"): the SHA-1 of the text in
    UTF-8, line endings normalized to \n. The identity faustcode gives its sessions.
*/

export function normalizeText(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

export async function sha1(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(normalizeText(text));
    const digest = await globalThis.crypto.subtle.digest("SHA-1", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
