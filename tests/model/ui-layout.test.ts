// The layout of the interface of a module (src/model/UILayout.ts), on the JSON of compiled modules.
import { describe, expect, it } from "vitest";
import { compileJson } from "../helpers/faust";
import { LayoutNode, layoutWidgets, uiLayout } from "../../src/model/UILayout";

// The module as the application stores it: wrapped in a group named after it.
const wrap = (name: string, body: string) => `process = vgroup("${name}", environment{\nimport("stdfaust.lib");\n${body}\n}.process);`;

// The sections (label and level) and the widgets, as an outline.
function outline(nodes: LayoutNode[], indent = ""): string[] {
    return nodes.flatMap((n) => n.kind == "widget"
        ? [`${indent}${n.item.label}${n.hidden ? " (hidden)" : ""}${n.tooltip ? ` [${n.tooltip}]` : ""}`]
        : [...(n.label ? [`${indent}# ${n.label} (${n.type}, level ${n.level})`] : []), ...outline(n.children, n.label ? indent + "  " : indent)]);
}

describe("interface layout", () => {
    it("shows the groups as sections, not the root nor a group named as the module", async () => {
        const json = await compileJson("m", wrap("Synth", `process = vgroup("Synth", hgroup("[0]Osc", hslider("[0]freq", 440, 20, 2000, 1) * hslider("[1]gain", 0.5, 0, 1, 0.01))
            + vgroup("[1]Env", hslider("[0]attack", 0.01, 0, 1, 0.01) + vgroup("[1]Advanced", hslider("curve", 0, -1, 1, 0.01))) + hslider("[2]volume", 0.5, 0, 1, 0.01));`));
        expect(outline(uiLayout(json.ui, "Synth"))).toEqual([
            "# Osc (hgroup, level 1)",
            "  freq",
            "  gain",
            "# Env (vgroup, level 1)",
            "  attack",
            "  # Advanced (vgroup, level 2)",
            "    curve",
            "volume",
        ]);
    });

    it("leaves out the groups Faust generates (0x00), named as the module in another case, or all hidden", async () => {
        const json = await compileJson("m", wrap("Flanger", `process = vgroup("[0]FLANGER", hgroup("[0]", hslider("Speed", 1, 0, 10, 0.1)) + vgroup("[1]Secret", hslider("x[hidden:1]", 0, 0, 1, 0.1))) + hslider("[1]Depth[tooltip:how much]", 0.5, 0, 1, 0.01);`));
        const layout = uiLayout(json.ui, "Flanger");
        expect(outline(layout)).toEqual(["Speed", "x (hidden)", "Depth [how much]"]);
        expect(layoutWidgets(layout).map((w) => w.item.address)).toEqual(["/Flanger/FLANGER/0x00/Speed", "/Flanger/FLANGER/Secret/x", "/Flanger/Depth"]);
    });

    it("keeps the bargraphs and the number entries in their place", async () => {
        const json = await compileJson("m", wrap("Meter", `process = _ <: attach(_, abs : hbargraph("[2]level", 0, 1)) : *(vgroup("Gain", nentry("[1]gain", 1, 0, 4, 0.1)));`));
        expect(outline(uiLayout(json.ui, "Meter"))).toEqual(["# Gain (vgroup, level 1)", "  gain", "level"]);
    });
});
