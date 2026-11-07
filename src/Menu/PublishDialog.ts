/*				PUBLISHDIALOG.TS
    Publishing a scene to a store, with its modules (store/ScenePlan.ts): what will be published, and a choice for the
    modules whose name is taken in the store by another code (a new version, another name, or not published). Shown
    when there is something to decide or to know (a module to publish, the scene already there).
*/

import { Utilitary } from "../Utilitary";
import { ModuleChoice, PlanRow } from "../store/ScenePlan";

export function showPublishDialog(store: string, scene: string, replaced: boolean, rows: PlanRow[], publish: (rows: PlanRow[]) => void): void {
    const t = Utilitary.messageResource;
    const overlay = document.createElement("div");
    overlay.className = "storeDialogOverlay";
    const box = document.createElement("div");
    box.className = "storeDialog publishDialog";
    box.setAttribute("role", "dialog");
    const title = document.createElement("div");
    title.className = "storeDialogTitle";
    title.textContent = t.publishDialogTitle.replace("%s", scene).replace("%t", store);
    box.appendChild(title);
    const line = (text: string, className = "storeDialogHelp") => {
        const div = document.createElement("div");
        div.className = className;
        div.textContent = text;
        box.appendChild(div);
        return div;
    };
    if (replaced) line(t.publishDialogReplace);
    const actionable = rows.filter((r) => r.status == "new" || r.status == "conflict");
    if (actionable.length) {
        line(t.publishDialogModules, "publishDialogHeading");
        const list = document.createElement("div");
        list.className = "publishDialogModules";
        for (const row of actionable) {
            const item = document.createElement("label");
            item.className = "publishDialogModule";
            const name = document.createElement("span");
            name.className = "publishDialogName";
            name.textContent = row.name;
            const select = document.createElement("select");
            const option = (value: ModuleChoice, text: string) => {
                const o = document.createElement("option");
                o.value = value;
                o.textContent = text;
                select.appendChild(o);
            };
            const otherName = row.other?.split("/")[1] ?? "";
            if (row.status == "new") {
                option("publish", t.publishChoiceNew.replace("%p", row.path));
            } else {
                if (!row.inScene) option("version", t.publishChoiceVersion.replace("%s", row.name));
                option("other", t.publishChoiceOther.replace("%s", otherName));
            }
            option("skip", t.publishChoiceSkip);
            select.value = row.choice;
            select.addEventListener("change", () => { row.choice = select.value as ModuleChoice; });
            const note = document.createElement("span");
            note.className = "publishDialogNote";
            note.textContent = row.status == "new" ? "" : row.inScene ? t.publishConflictScene : t.publishConflictStore;
            item.append(name, select, note);
            list.appendChild(item);
        }
        box.appendChild(list);
    }
    const kept = rows.filter((r) => r.status == "library" || r.status == "same" || r.status == "older");
    if (kept.length) {
        const label = (r: PlanRow) => r.name + " (" + (r.status == "library" ? t.publishKeptLibrary : r.status == "same" ? t.publishKeptSame : t.publishKeptOlder) + ")";
        line(t.publishDialogKept + " " + kept.map(label).join(", "));
    }
    line(t.publishDialogSound);
    const buttons = document.createElement("div");
    buttons.className = "storeDialogButtons";
    const close = () => overlay.remove();
    const button = (label: string, action: () => void, primary = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "button" + (primary ? " primary" : "");
        b.textContent = label;
        b.addEventListener("click", action);
        buttons.appendChild(b);
        return b;
    };
    button(t.publishDialogPublish, () => { close(); publish(rows); }, true);
    button(t.storeDialogClose, close);
    box.appendChild(buttons);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target == overlay) close(); });
    box.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key == "Escape") close(); });
    document.body.appendChild(overlay);
}
