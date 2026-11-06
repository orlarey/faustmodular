/*				STOREDIALOG.TS
    My store (Documentation/STORE-SPEC.md, "Publier", "L'autorisation"): the repository one publishes to, and the
    token to write to it, made on GitHub (a fine-grained token, for that repository only, with the permission
    Contents: read and write); checked before it is kept. The token is kept in the browser, and only sent to GitHub.
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

    // Opened; `then`: once a store is configured (to go on publishing).
    open(then?: () => void): void {
        if (this.fElement) return;
        const t = Utilitary.messageResource;
        const my = this.fPublishing.myStore;
        const overlay = document.createElement("div");
        overlay.className = "storeDialogOverlay";
        const box = document.createElement("div");
        box.className = "storeDialog";
        box.setAttribute("role", "dialog");
        const title = document.createElement("div");
        title.className = "storeDialogTitle";
        title.textContent = t.storeDialogTitle;
        const field = (label: string, input: HTMLInputElement) => {
            const row = document.createElement("label");
            row.className = "storeDialogField";
            const span = document.createElement("span");
            span.textContent = label;
            row.append(span, input);
            return row;
        };
        const repo = document.createElement("input");
        repo.type = "text";
        repo.placeholder = t.storePlaceholder;
        repo.value = my.repo ?? "";
        repo.spellcheck = false;
        const token = document.createElement("input");
        token.type = "password";
        token.placeholder = "github_pat_…";
        token.value = my.token ?? "";
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
                const ok = await this.fPublishing.configure(repo.value, token.value);
                status.classList.add("ok");
                status.textContent = t.storeVerified.replace("%s", ok.key).replace("%b", ok.branch) + (ok.private ? "" : " " + t.storePublic);
                if (then) { close(); then(); }
            } catch (e) {
                status.classList.add("error");
                status.textContent = publishErrorText(e, repo.value.trim());
            }
            verify.disabled = false;
        }, true);
        button(t.storeDialogForget, () => {
            this.fPublishing.myStore.forget();
            repo.value = "";
            token.value = "";
            status.className = "storeDialogStatus";
            status.textContent = t.storeForgotten;
        });
        button(t.storeDialogClose, close);
        box.append(title, field(t.storeDialogRepo, repo), field(t.storeDialogToken, token), help, status, buttons);
        overlay.appendChild(box);
        overlay.addEventListener("click", (e) => { if (e.target == overlay) close(); });
        box.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key == "Escape") close();
            if (e.key == "Enter") verify.click();
        });
        document.body.appendChild(overlay);
        this.fElement = overlay;
        (my.repo ? token : repo).focus();
    }
}
