/*				UILAYOUT.TS
    The layout of the interface of a module, from the JSON description of its DSP: the groups of Faust
    (vgroup, hgroup, tgroup) as sections, and their widgets in the order of the code.

    A group is shown as a section with its label above its widgets, except:
    - the root group (the module is wrapped in a group named after it: its name is in the title bar);
    - a group named as the module (case ignored): the library modules repeat it, vgroup("VCO", ...);
    - a group without label, or with the label Faust generates for it ("0x00");
    - a group whose widgets are all hidden ([hidden:1]).
    Its widgets stay grouped in its container: an hgroup lays them out as a row (wrapped when too wide), a
    tgroup as tabs, one per child, titled with its label (ModuleClass.createFaustInterface).
    The level of a section is the number of sections around it, plus one.

    Widgets with [hidden:1] are kept (their controller holds the value: saving, undo, modulation) and
    not shown. [tooltip:...] gives the tooltip of a widget or of a section.
*/

export interface UIItem {
    type: string;
    label: string;
    address?: string;
    items?: UIItem[];
    meta?: Array<Record<string, string>>;
}

export interface LayoutGroup {
    kind: "group";
    type: string;                   // vgroup, hgroup, tgroup
    label: string | null;           // the section label shown, null if none
    title: string;                  // the label of the group in the code (the title of a tab)
    tooltip: string | null;
    level: number;                  // 1 for a section not inside another section
    children: LayoutNode[];
}

export interface LayoutWidget {
    kind: "widget";
    item: UIItem;
    hidden: boolean;
    tooltip: string | null;
}

export type LayoutNode = LayoutGroup | LayoutWidget;

// The value of a metadata key of an item ([key:value] in its label), undefined if absent.
export function metaValue(item: { meta?: Array<Record<string, string>> }, key: string): string | undefined {
    for (const m of item.meta ?? []) {
        if (key in m) return m[key];
    }
    return undefined;
}

export function isHidden(item: UIItem): boolean {
    const v = metaValue(item, "hidden")?.trim().toLowerCase();
    return v !== undefined && v != "0" && v != "false";
}

const GENERATED_GROUP = /^0x[0-9a-f]+$/i;

function visible(node: LayoutNode): boolean {
    return node.kind == "widget" ? !node.hidden : node.children.some(visible);
}

export function uiLayout(ui: UIItem[], moduleName: string): LayoutNode[] {
    const name = moduleName.trim().toLowerCase();
    const build = (item: UIItem, depth: number, level: number): LayoutNode => {
        if (!item.items) {
            return { kind: "widget", item, hidden: isHidden(item), tooltip: metaValue(item, "tooltip") ?? null };
        }
        const label = item.label.trim();
        const named = depth > 0 && label != "" && !GENERATED_GROUP.test(label) && label.toLowerCase() != name;
        const group: LayoutGroup = {
            kind: "group", type: item.type, label: named ? label : null, title: label, tooltip: metaValue(item, "tooltip") ?? null,
            level: named ? level : level - 1, children: [],
        };
        group.children = item.items.map((child) => build(child, depth + 1, named ? level + 1 : level));
        if (!group.children.some(visible)) group.label = null;
        return group;
    };
    return ui.map((item) => build(item, 0, 1));
}

// The widgets of a layout, in order.
export function layoutWidgets(nodes: LayoutNode[]): LayoutWidget[] {
    return nodes.flatMap((n) => n.kind == "widget" ? [n] : layoutWidgets(n.children));
}
