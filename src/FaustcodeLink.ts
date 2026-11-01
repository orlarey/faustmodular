/*				FAUSTCODELINK.TS
    Editing the code of modules in faustcode (https://github.com/orlarey/faustcode), a Faust
    workbench running in another window: syntax highlighting, completion, errors at their line,
    block diagram, oscilloscope and spectrum, documentation, MCP.

    faustmodular opens faustcode (FAUSTCODE_URL, with ?link=modular) in a window named
    "faustcode-modular", reused for all the modules. The two windows exchange messages with
    postMessage (they may have different origins); every message has a `type` and the `protocol`
    version (LINK_PROTOCOL):

        faustcode → faustmodular   faustcode-link-ready   { libfaust? }            ready to edit (the version of its
                                                                                   libfaust: a warning if it differs)
        faustmodular → faustcode   faustcode-link-edit    { id, name, code }       edit this code
        faustcode → faustmodular   faustcode-link-code    { id, code }             compiled new code
        faustmodular → faustcode   faustcode-link-result  { id, ok, error? }       applied or not
        faustmodular → faustcode   faustcode-link-close   { id }                   module removed

    `id` designates a module of this page (random, so that a faustcode window kept open does not
    update a module of a patch loaded later); `code` is the user's code, without the group of the
    module (model/ModuleCode). faustcode sends the code of a linked session each time it compiles
    without error (Cmd/Ctrl-S); a code with errors stays in faustcode, and the module keeps playing
    its current DSP. faustmodular only accepts messages from the faustcode window, with the
    origin of FAUSTCODE_URL, and sends its messages to that origin only.

    The faustcode URL can be changed with the parameter ?faustcode=<url> of faustmodular (a local
    faustcode, tests).
*/

import { Utilitary } from "./Utilitary";

export const FAUSTCODE_URL = "https://orlarey.github.io/faustcode/";
export const LINK_PROTOCOL = 1;
export const WINDOW_NAME = "faustcode-modular";
// faustcode loads libfaust (a few MB) before answering
export const READY_TIMEOUT_MS = 30_000;

// What the link needs from the scene, for a module of type M.
export interface FaustcodeLinkHost<M> {
    isAlive(module: M): boolean;
    nameOf(module: M): string;
    codeOf(module: M): string;                              // user's code
    apply(module: M, code: string): Promise<string | null>; // null, or why the code was not applied
    notify(message: string): void;
    libfaust?(): string;                                    // version of the libfaust of faustmodular
}

type LinkMessage = { type: string; protocol: number; [key: string]: unknown };

// URL of faustcode: ?faustcode=<http(s) url> of the page, or FAUSTCODE_URL.
export function faustcodeUrl(search: string = location.search): string {
    const requested = new URLSearchParams(search).get("faustcode");
    if (requested) {
        try {
            const url = new URL(requested, location.href);
            if (url.protocol == "https:" || url.protocol == "http:") return url.href;
        } catch {
            // ignored: default URL
        }
    }
    return FAUSTCODE_URL;
}

export class FaustcodeLink<M extends object> {
    private fWindow: Window | null = null;
    private fWarnedVersion = false;
    private fReady = false;
    private fPending: LinkMessage[] = [];
    private fTimer: ReturnType<typeof setTimeout> | null = null;
    private fModules = new Map<string, M>();
    private fIds = new WeakMap<M, string>();

    constructor(private fUrl: string, private fHost: FaustcodeLinkHost<M>) {
        window.addEventListener("message", (event) => this.onMessage(event));
    }

    get origin(): string {
        return new URL(this.fUrl, location.href).origin;
    }

    // Opens the code of a module in faustcode.
    edit(module: M): void {
        let id = this.fIds.get(module);
        if (!id) {
            id = randomId();
            this.fIds.set(module, id);
            this.fModules.set(id, module);
        }
        const message = this.message("faustcode-link-edit", { id, name: this.fHost.nameOf(module), code: this.fHost.codeOf(module) });
        if (!this.fWindow || this.fWindow.closed) {
            const url = new URL(this.fUrl, location.href);
            url.searchParams.set("link", "modular");
            this.fReady = false;
            this.fPending = [message];
            this.fWindow = window.open(url.href, WINDOW_NAME);
            if (!this.fWindow) {
                this.fPending = [];
                this.fHost.notify(this.resource("faustcodePopupBlocked"));
                return;
            }
            this.startTimeout();
        } else if (!this.fReady) {
            this.fPending = this.fPending.filter((m) => m.id != id).concat(message);
        } else {
            this.post(message);
            try { this.fWindow.focus(); } catch { /* ignored */ }
        }
    }

    // A module was removed: faustcode no longer sends it code.
    forget(module: M): void {
        const id = this.fIds.get(module);
        if (!id) return;
        this.fIds.delete(module);
        this.fModules.delete(id);
        if (this.fReady) this.post(this.message("faustcode-link-close", { id }));
    }

    isLinked(module: M): boolean {
        return this.fIds.has(module);
    }

    private async onMessage(event: MessageEvent): Promise<void> {
        if (!this.fWindow || event.source !== this.fWindow || event.origin !== this.origin) return;
        const data = event.data;
        if (!data || typeof data != "object" || typeof data.type != "string" || !data.type.startsWith("faustcode-link-")) return;
        if (data.protocol !== LINK_PROTOCOL) {
            console.warn("faustcode link: unsupported protocol", data.protocol);
            return;
        }
        switch (data.type) {
            case "faustcode-link-ready":
                // the same compiler and Faust libraries in both applications, or a warning (once)
                if (typeof data.libfaust == "string" && this.fHost.libfaust && data.libfaust != this.fHost.libfaust() && !this.fWarnedVersion) {
                    this.fWarnedVersion = true;
                    this.fHost.notify(this.resource("faustcodeLibfaustMismatch").replace("{faustcode}", data.libfaust).replace("{faustmodular}", this.fHost.libfaust()));
                }
                this.fReady = true;
                this.stopTimeout();
                this.fPending.forEach((m) => this.post(m));
                this.fPending = [];
                break;
            case "faustcode-link-code": {
                if (typeof data.id != "string" || typeof data.code != "string") return;
                const module = this.fModules.get(data.id);
                let error: string | null;
                if (!module || !this.fHost.isAlive(module)) {
                    error = "the module is no longer in faustmodular";
                } else {
                    error = await this.fHost.apply(module, data.code);
                    if (error != null) {
                        this.fHost.notify(this.resource("faustcodeUpdateFailed")
                            .replace("{name}", this.fHost.nameOf(module)).replace("{error}", error.split("\n")[0]));
                    }
                }
                this.post(this.message("faustcode-link-result", error == null ? { id: data.id, ok: true } : { id: data.id, ok: false, error }));
                break;
            }
        }
    }

    private message(type: string, fields: Record<string, unknown>): LinkMessage {
        return { type, protocol: LINK_PROTOCOL, ...fields };
    }

    private post(message: LinkMessage): void {
        if (this.fWindow && !this.fWindow.closed) this.fWindow.postMessage(message, this.origin);
    }

    private startTimeout(): void {
        this.stopTimeout();
        this.fTimer = setTimeout(() => {
            this.fTimer = null;
            if (!this.fReady) this.fHost.notify(this.resource("faustcodeNoAnswer").replace("{url}", this.fUrl));
        }, READY_TIMEOUT_MS);
    }

    private stopTimeout(): void {
        if (this.fTimer) clearTimeout(this.fTimer);
        this.fTimer = null;
    }

    private resource(key: "faustcodePopupBlocked" | "faustcodeNoAnswer" | "faustcodeUpdateFailed" | "faustcodeLibfaustMismatch"): string {
        return Utilitary.messageResource[key];
    }
}

function randomId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
}
