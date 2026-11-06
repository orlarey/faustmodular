/*				STOREDIALOG.TS
    Writing to a store (Documentation/STORE-SPEC.md, "Publier", "L'autorisation"): the token for it, made on GitHub (a
    fine-grained token, for that repository only, with the permission Contents: read and write); checked before it is
    kept, the store then in read and write. The token is kept in the browser, and only sent to GitHub.
*/

import { Utilitary } from "../Utilitary";
import type { Publishing } from "../store/Publishing";
import { PublishError } from "../store/StorePublisher";

const TOKEN_PAGE = "https://github.com/settings/personal-access-tokens/new";

// The text of an error of publication.
export function publishErrorText(e: unknown, store: string): string {
    const t = Utilitary.messageResource;
    const reason = e instanceof PublishError ? e.reason : "network";
    const texts: Record<string, string> = {
        token: t.storePublishToken, rights: t.storePublishRights, empty: t.storePublishEmpty,
        notFound: t.storePublishNotFound, network: t.storePublishNetwork, conflict: t.storePublishConflict,
    };
    return (texts[reason] ?? t.storePublishNetwork).replace("%s", store);
}

export class StoreDialog {
    private fElement: HTMLElement | null = null;

    constructor(private fPublishing: Publishing) { }

    // Opened for a store (owner/repo); `then`: once its token is checked.
    open(store: string, then?: () => void): void {
        if (this.fElement) return;
        const t = Utilitary.messageResource;
        const overlay = document.createElement("div");
        overlay.className = "storeDialogOverlay";
        const box = document.createElement("div");
        box.className = "storeDialog";
        box.setAttribute("role", "dialog");
        const title = document.createElement("div");
        title.className = "storeDialogTitle";
        title.textContent = t.storeDialogTitle.replace("%s", store);
        const field = (label: string, input: HTMLInputElement) => {
            const row = document.createElement("label");
            row.className = "storeDialogField";
            const span = document.createElement("span");
            span.textContent = label;
            row.append(span, input);
            return row;
        };
        const token = document.createElement("input");
        token.type = "password";
        token.placeholder = "github_pat_…";
        token.value = this.fPublishing.tokens.get(store) ?? "";
        token.autocomplete = "off";
        const help = document.createElement("div");
        help.className = "storeDialogHelp";
        help.textContent = t.storeDialogHelp + " ";
        const link = document.createElement("a");
        link.href = TOKEN_PAGE;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = t.storeDialogCreateToken;
        help.appendChild(link);
        const status = document.createElement("div");
        status.className = "storeDialogStatus";
        const buttons = document.createElement("div");
        buttons.className = "storeDialogButtons";
        const button = (label: string, action: () => void, primary = false) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "button" + (primary ? " primary" : "");
            b.textContent = label;
            b.addEventListener("click", action);
            buttons.appendChild(b);
            return b;
        };
        const close = () => {
            overlay.remove();
            this.fElement = null;
        };
        const verify = button(t.storeDialogVerify, async () => {
            verify.disabled = true;
            status.className = "storeDialogStatus";
            status.textContent = t.storeLoading;
            try {
                const ok = await this.fPublishing.configure(store, token.value);
                status.classList.add("ok");
                status.textContent = t.storeVerified.replace("%s", ok.key).replace("%b", ok.branch) + (ok.private ? "" : " " + t.storePublic);
                if (then) { close(); then(); }
            } catch (e) {
                status.classList.add("error");
                status.textContent = publishErrorText(e, store);
            }
            verify.disabled = false;
        }, true);
        button(t.storeDialogClose, close);
        box.append(title, field(t.storeDialogToken, token), help, status, buttons);
        overlay.appendChild(box);
        overlay.addEventListener("click", (e) => { if (e.target == overlay) close(); });
        box.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key == "Escape") close();
            if (e.key == "Enter") verify.click();
        });
        document.body.appendChild(overlay);
        this.fElement = overlay;
        token.focus();
    }
}
