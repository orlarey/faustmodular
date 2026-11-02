/*				CONTEXTMENU.TS
    A context menu: a list of commands shown at the pointer, closed by a choice, a click elsewhere,
    Escape, the wheel or a resize. Used by the scene on its modules and on the empty stage.
*/

export interface MenuCommand {
    label: string;
    shortcut?: string;          // shown on the right ("⌘C", "Ctrl+C")
    enabled?: boolean;          // true by default
    action: () => void;
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
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.setAttribute("role", "menu");
    for (const item of items) {
        if (item == "separator") {
            const line = document.createElement("div");
            line.className = "context-menu-separator";
            menu.appendChild(line);
            continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "context-menu-item";
        button.setAttribute("role", "menuitem");
        button.disabled = item.enabled === false;
        const label = document.createElement("span");
        label.textContent = item.label;
        button.appendChild(label);
        if (item.shortcut) {
            const keys = document.createElement("span");
            keys.className = "context-menu-shortcut";
            keys.textContent = item.shortcut;
            button.appendChild(keys);
        }
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            close();
            item.action();
        });
        menu.appendChild(button);
    }
    document.body.appendChild(menu);
    const box = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(clientX, window.innerWidth - box.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(clientY, window.innerHeight - box.height - 4)) + "px";

    const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key == "Escape") close(); };
    const close = () => {
        menu.remove();
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
