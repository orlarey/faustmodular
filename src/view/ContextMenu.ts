/*				CONTEXTMENU.TS
    A context menu: a list of commands shown at the pointer, closed by a choice, a click elsewhere,
    Escape, the wheel or a resize. Used by the scene on its modules and on the empty stage, and as the
    dropdown of the File menu. A command with `items` opens a submenu on its right (hover or click).
*/

export interface MenuCommand {
    label: string;
    shortcut?: string;          // shown on the right ("⌘C", "Ctrl+C")
    enabled?: boolean;          // true by default
    action?: () => void;
    items?: MenuItem[];         // a submenu
    title?: string;             // tooltip
    checked?: boolean;          // a state (a check mark in a column on the left of the menu)
}

export type MenuItem = MenuCommand | "separator";

// The shortcut as written on this platform, from "mod+X", "shift+mod+X", "Delete": ⌘X, ⇧⌘X, ⌫ on a
// Mac; Ctrl+X, Ctrl+Shift+X, Del elsewhere.
export function shortcut(keys: string): string {
    const mac = typeof navigator != "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const parts = keys.split("+");
    const key = parts.pop()!;
    const mod = parts.includes("mod"), shift = parts.includes("shift");
    if (mac) return (shift ? "⇧" : "") + (mod ? "⌘" : "") + (key == "Delete" ? "⌫" : key);
    return [mod ? "Ctrl" : "", shift ? "Shift" : "", key == "Delete" ? "Del" : key].filter(Boolean).join("+");
}

let current: { element: HTMLElement; close: () => void } | null = null;

export function closeContextMenu(): void {
    current?.close();
}

// Shows the menu at (clientX, clientY), kept inside the window.
export function showContextMenu(clientX: number, clientY: number, items: MenuItem[]): HTMLElement {
    closeContextMenu();
    const menus: HTMLElement[] = [];
    // the menus open, the first one and its submenu (one level)
    const build = (list: MenuItem[], x: number, y: number, level: number): HTMLElement => {
        const menu = document.createElement("div");
        menu.className = "context-menu" + (level > 0 ? " context-submenu" : "");
        // a column of check marks when an item has a state
        const checks = list.some((item) => item != "separator" && item.checked !== undefined);
        menu.setAttribute("role", "menu");
        for (const item of list) {
            if (item == "separator") {
                const line = document.createElement("div");
                line.className = "context-menu-separator";
                menu.appendChild(line);
                continue;
            }
            const button = document.createElement("button");
            button.type = "button";
            button.className = "context-menu-item" + (item.items ? " has-submenu" : "");
            button.setAttribute("role", "menuitem");
            button.disabled = item.enabled === false;
            if (item.title) button.title = item.title;
            const label = document.createElement("span");
            label.textContent = item.label;
            if (checks) {
                const check = document.createElement("span");
                check.className = "context-menu-check";
                check.textContent = item.checked ? "\u2713" : "";
                label.prepend(check);
                if (item.checked !== undefined) button.setAttribute("aria-checked", String(!!item.checked));
            }
            button.appendChild(label);
            if (item.shortcut || item.items) {
                const keys = document.createElement("span");
                keys.className = "context-menu-shortcut";
                keys.textContent = item.items ? "\u25B8" : item.shortcut!;
                button.appendChild(keys);
            }
            if (item.items && item.enabled !== false) {
                const open = () => {
                    if (menus[level + 1]?.dataset.owner == item.label) return;
                    menus.splice(level + 1).forEach((m) => m.remove());
                    const r = button.getBoundingClientRect();
                    const sub = build(item.items!, r.right - 2, r.top - 4, level + 1);
                    sub.dataset.owner = item.label;
                    // on the left when there is no room on the right
                    const box = sub.getBoundingClientRect();
                    if (r.right - 2 + box.width > window.innerWidth - 4) sub.style.left = Math.max(4, r.left - box.width + 2) + "px";
                };
                button.addEventListener("mouseenter", open);
                button.addEventListener("click", (e) => { e.stopPropagation(); open(); });
            } else if (item.items) {
                button.addEventListener("mouseenter", () => menus.splice(level + 1).forEach((m) => m.remove()));
            } else {
                button.addEventListener("mouseenter", () => menus.splice(level + 1).forEach((m) => m.remove()));
                button.addEventListener("click", (e) => {
                    e.stopPropagation();
                    close();
                    item.action?.();
                });
            }
            menu.appendChild(button);
        }
        document.body.appendChild(menu);
        const box = menu.getBoundingClientRect();
        menu.style.left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4)) + "px";
        menu.style.top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4)) + "px";
        menus[level] = menu;
        return menu;
    };
    const menu = build(items, clientX, clientY, 0);

    const outside = (e: Event) => { if (!menus.some((m) => m.contains(e.target as Node))) close(); };
    const key = (e: KeyboardEvent) => { if (e.key == "Escape") close(); };
    const close = () => {
        menus.forEach((m) => m.remove());
        menus.length = 0;
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", key, true);
        document.removeEventListener("wheel", close, true);
        window.removeEventListener("resize", close);
        window.removeEventListener("blur", close);
        if (current?.element === menu) current = null;
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("wheel", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    current = { element: menu, close };
    return menu;
}

// The menu under an element (the dropdown of a button of the toolbar).
export function showMenuBelow(anchor: HTMLElement, items: MenuItem[]): HTMLElement {
    const r = anchor.getBoundingClientRect();
    return showContextMenu(r.left, r.bottom + 4, items);
}
