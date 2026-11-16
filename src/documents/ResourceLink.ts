/*				RESOURCELINK.TS
    The contract with faustcode (Documentation/SCENE-RESOURCES-SPEC.md, "Le contrat avec faustcode"). The two
    applications are served by the same origin: they share OPFS, the Web Locks and BroadcastChannel. A resource of a
    scene is a file, faustmodular/documents/<document>/resources/<file>, written under a lock and conditionally
    (DocumentStore.writeResourceFiles); the channel only rings the bell, it never carries code:

        resource-changed   both            document, file, name, sha1      the file has a new code
        resource-added     faustcode       document, file, name, sha1, place?   a new file: a new resource (an instance
                                                                           at the center of the view if `place`)
        resource-renamed   faustmodular    document, from, to, name        the file `from` is now `to` (name: its name)
        resource-removed   faustmodular    document, file, name            the resource left the scene
        applied            faustmodular    document, file, name, sha1, ok, instances, error?
        open-resource      faustmodular    document, file, name, request   a faustcode tab opens it (the pencil)
        opened             faustcode       request                         the answer to open-resource

    Every message carries channel, version and sender ("faustmodular" or "faustcode"); a message that is not well
    formed is ignored. faustcode is at ../faustcode/ of faustmodular (the same origin), or at ?faustcode=<url> of the
    same origin (a checkout served by the server of faustmodular: FAUSTCODE_DIR).
*/

export const CHANNEL = "faustmodular-resources";
export const CHANNEL_VERSION = 1;
export const OPEN_TIMEOUT_MS = 500;
export const FAUSTCODE_WINDOW = "faustcode";

export type Sender = "faustmodular" | "faustcode";

export type ResourceMessage =
    | { type: "resource-changed"; document: string; file: string; name: string; sha1: string }
    | { type: "resource-added"; document: string; file: string; name: string; sha1: string; place?: boolean }
    | { type: "resource-renamed"; document: string; from: string; to: string; name: string }
    | { type: "resource-removed"; document: string; file: string; name: string }
    | { type: "applied"; document: string; file: string; name: string; sha1: string; ok: boolean; instances: number; error?: string }
    | { type: "open-resource"; document: string; file: string; name: string; request: string }
    | { type: "opened"; request: string };

export type Envelope = ResourceMessage & { channel: typeof CHANNEL; version: number; sender: Sender };

const FIELDS: Record<ResourceMessage["type"], string[]> = {
    "resource-changed": ["document", "file", "name", "sha1"],
    "resource-added": ["document", "file", "name", "sha1"],
    "resource-renamed": ["document", "from", "to", "name"],
    "resource-removed": ["document", "file", "name"],
    "applied": ["document", "file", "name", "sha1"],
    "open-resource": ["document", "file", "name", "request"],
    "opened": ["request"],
};

// A message of the channel, or null if it is not one (another channel, another version, a field missing).
export function parseResourceMessage(data: unknown): Envelope | null {
    if (typeof data != "object" || data === null) return null;
    const m = data as Record<string, unknown>;
    if (m.channel != CHANNEL || m.version != CHANNEL_VERSION) return null;
    if (m.sender != "faustmodular" && m.sender != "faustcode") return null;
    const fields = FIELDS[m.type as ResourceMessage["type"]];
    if (!fields || fields.some((f) => typeof m[f] != "string")) return null;
    if (m.type == "applied" && (typeof m.ok != "boolean" || typeof m.instances != "number")) return null;
    // a file of the folder of resources, never a path
    for (const f of ["file", "from", "to"]) {
        if (m[f] !== undefined && (typeof m[f] != "string" || !/^[^/\\]+\.dsp$/.test(m[f] as string))) return null;
    }
    return m as unknown as Envelope;
}

// The faustcode of this faustmodular: ?faustcode=<url> of the page if it has the same origin, else ../faustcode/.
export function faustcodeUrl(href: string = location.href): string {
    const here = new URL(href);
    const requested = here.searchParams.get("faustcode");
    if (requested) {
        try {
            const url = new URL(requested, here);
            if (url.origin == here.origin) return url.href;
        } catch {
            // ignored: the default
        }
    }
    return new URL("../faustcode/", here).href;
}

// The address that opens a resource in faustcode.
export function openResourceUrl(base: string, document: string, file: string): string {
    const url = new URL(base);
    url.searchParams.set("open", `faustmodular:${document}/${file}`);
    return url.href;
}

/******************** THE CHANNEL ********************/

export interface ResourceLinkHost {
    // a message of faustcode about a document (changed, added); the answer `applied` is posted by the host
    receive(message: ResourceMessage): void;
}

export class ResourceLink {
    private fChannel: BroadcastChannel | null;
    private fWaiting = new Map<string, () => void>();       // request -> answered
    private fWindow: Window | null = null;                    // the faustcode window this page opened

    constructor(private fHost: ResourceLinkHost, private fUrl = faustcodeUrl()) {
        this.fChannel = typeof BroadcastChannel != "undefined" ? new BroadcastChannel(CHANNEL) : null;
        this.fChannel?.addEventListener("message", (e) => this.onMessage(e.data));
    }

    get url(): string {
        return this.fUrl;
    }

    private onMessage(data: unknown): void {
        const m = parseResourceMessage(data);
        if (!m || m.sender != "faustcode") return;
        if (m.type == "opened") {
            this.fWaiting.get(m.request)?.();
            return;
        }
        if (m.type == "resource-changed" || m.type == "resource-added") this.fHost.receive(m);
    }

    post(message: ResourceMessage): void {
        this.fChannel?.postMessage({ ...message, channel: CHANNEL, version: CHANNEL_VERSION, sender: "faustmodular" });
    }

    // Opens a resource in faustcode: a faustcode tab already open takes it (it answers within OPEN_TIMEOUT_MS), else a
    // window is opened. Called from a click (the pencil): the window is opened at once if no tab can answer.
    async open(document: string, file: string, name: string): Promise<"tab" | "window" | "blocked"> {
        const request = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const answered = new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => { this.fWaiting.delete(request); resolve(false); }, OPEN_TIMEOUT_MS);
            this.fWaiting.set(request, () => { clearTimeout(timer); this.fWaiting.delete(request); resolve(true); });
        });
        this.post({ type: "open-resource", document, file, name, request });
        if (await answered) {
            try { if (this.fWindow && !this.fWindow.closed) this.fWindow.focus(); } catch { /* ignored */ }
            return "tab";
        }
        this.fWindow = window.open(openResourceUrl(this.fUrl, document, file), FAUSTCODE_WINDOW);
        return this.fWindow ? "window" : "blocked";
    }
}
