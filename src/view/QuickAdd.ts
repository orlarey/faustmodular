/*				QUICKADD.TS
    The quick add: a double click on the empty stage, or Tab with the pointer over it, opens a search field
    there; typing finds the modules as the Modules menu does (Menu/Library.ts, model/LibrarySearch.ts), ↑ ↓
    choose, Enter or a click adds the module where the field was opened (its top left corner, as a module
    dropped there). Before anything is typed, the field offers the modules added last (model/RecentModules.ts):
    a module used again is a double click and Enter. Escape, a click elsewhere, the wheel or a blur closes it.
*/

import type { LibraryEntry } from "../Menu/Library";

const WIDTH = 320;          // px of the field and its list
const MARGIN = 8;           // px between it and the edges of the window
const ROWS = 10;            // results shown at most
const HEIGHT = 400;         // px of the field with a full list (css/Theme.css: .quick-add-list at most 320 px)

export interface QuickAddTexts {
    placeholder: string;    // in the empty field
    recent: string;         // the title of the modules added last
    none: string;           // no module found
    hint: string;           // the keys
}

export interface QuickAddHost {
    find(query: string): LibraryEntry[];
    recents(): LibraryEntry[];
    add(entry: LibraryEntry, clientX: number, clientY: number): void;
    texts(): QuickAddTexts;
}

export class QuickAdd {
    private fBox: HTMLElement | null = null;
    private fInput!: HTMLInputElement;
    private fList!: HTMLElement;
    private fEntries: LibraryEntry[] = [];
    private fActive = 0;
    private fAt = { x: 0, y: 0 };
    private fAbove = false;     // opened above the point (no room below): the field at the bottom, the list growing up
    private fClose = () => this.close();

    constructor(private fHost: QuickAddHost) {}

    get isOpen(): boolean {
        return this.fBox !== null;
    }

    // Opens the field at a point of the window; the module chosen is added there.
    open(clientX: number, clientY: number): void {
        this.close();
        const t = this.fHost.texts();
        this.fAt = { x: clientX, y: clientY };
        // the side is chosen once, so that the field does not move while the list grows or shrinks
        this.fAbove = clientY + HEIGHT + MARGIN > window.innerHeight && clientY > window.innerHeight - clientY;
        const box = document.createElement("div");
        box.className = "quick-add" + (this.fAbove ? " above" : "");
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-label", t.placeholder);
        const input = document.createElement("input");
        input.type = "text";
        input.className = "quick-add-input";
        input.placeholder = t.placeholder;
        input.setAttribute("aria-label", t.placeholder);
        input.autocomplete = "off";
        input.spellcheck = false;
        const list = document.createElement("ul");
        list.className = "quick-add-list";
        list.setAttribute("role", "listbox");
        const hint = document.createElement("div");
        hint.className = "quick-add-hint";
        hint.textContent = t.hint;
        box.append(input, list, hint);
        this.fBox = box;
        this.fInput = input;
        this.fList = list;
        document.body.appendChild(box);

        input.addEventListener("input", () => this.render());
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();        // not the shortcuts of the stage (Delete, undo, Tab...)
            if (e.key == "ArrowDown" || e.key == "ArrowUp") {
                e.preventDefault();
                if (this.fEntries.length == 0) return;
                this.fActive = (this.fActive + (e.key == "ArrowDown" ? 1 : -1) + this.fEntries.length) % this.fEntries.length;
                this.showActive();
            } else if (e.key == "Enter") {
                e.preventDefault();
                this.choose(this.fActive);
            } else if (e.key == "Escape" || e.key == "Tab") {
                e.preventDefault();
                this.close();
            }
        });
        // a click elsewhere, the wheel, the window left: closed
        document.addEventListener("pointerdown", this.onPointerDown, true);
        document.addEventListener("wheel", this.fClose, { capture: true, passive: true });
        window.addEventListener("blur", this.fClose);
        this.render();
        this.place();
        input.focus();
    }

    close(): void {
        if (!this.fBox) return;
        this.fBox.remove();
        this.fBox = null;
        document.removeEventListener("pointerdown", this.onPointerDown, true);
        document.removeEventListener("wheel", this.fClose, true);
        window.removeEventListener("blur", this.fClose);
    }

    private onPointerDown = (e: PointerEvent) => {
        if (this.fBox && !this.fBox.contains(e.target as Node)) this.close();
    };

    private choose(i: number): void {
        const entry = this.fEntries[i];
        if (!entry) return;
        const { x, y } = this.fAt;
        this.close();
        this.fHost.add(entry, x, y);
    }

    // The results of the query, or the modules added last.
    private render(): void {
        const t = this.fHost.texts();
        const query = this.fInput.value;
        const recent = query.trim() == "";
        this.fEntries = (recent ? this.fHost.recents() : this.fHost.find(query)).slice(0, ROWS);
        this.fActive = 0;
        this.fList.replaceChildren();
        if (recent && this.fEntries.length > 0) {
            const title = document.createElement("li");
            title.className = "quick-add-title";
            title.textContent = t.recent;
            this.fList.appendChild(title);
        }
        if (!recent && this.fEntries.length == 0) {
            const none = document.createElement("li");
            none.className = "quick-add-none";
            none.textContent = t.none;
            this.fList.appendChild(none);
        }
        this.fEntries.forEach((entry, i) => {
            const li = document.createElement("li");
            li.className = "quick-add-item";
            li.setAttribute("role", "option");
            li.title = entry.summary ?? "";
            const name = document.createElement("span");
            name.className = "quick-add-name";
            name.textContent = entry.name;
            const family = document.createElement("span");
            family.className = "quick-add-family";
            family.textContent = entry.family;
            li.append(name, family);
            li.addEventListener("pointerenter", () => { this.fActive = i; this.showActive(false); });
            // pointerdown, not click: the field keeps the focus, the stage does not see it
            li.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); this.choose(i); });
            this.fList.appendChild(li);
        });
        this.showActive();
        this.place();
    }

    private showActive(scroll = true): void {
        const items = Array.from(this.fList.querySelectorAll(".quick-add-item"));
        items.forEach((li, i) => {
            li.classList.toggle("active", i == this.fActive);
            li.setAttribute("aria-selected", i == this.fActive ? "true" : "false");
        });
        if (scroll) (items[this.fActive] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
    }

    // Its top left corner at the point, or its bottom left corner when it opens above; inside the window.
    private place(): void {
        const box = this.fBox;
        if (!box) return;
        box.style.left = Math.max(MARGIN, Math.min(this.fAt.x, window.innerWidth - MARGIN - WIDTH)) + "px";
        box.style.maxHeight = (this.fAbove ? this.fAt.y : window.innerHeight - this.fAt.y) - MARGIN + "px";
        if (this.fAbove) {
            box.style.top = "";
            box.style.bottom = window.innerHeight - this.fAt.y + "px";
        } else {
            box.style.bottom = "";
            box.style.top = this.fAt.y + "px";
        }
    }
}
