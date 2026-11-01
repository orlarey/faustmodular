// Sliders shown as a menu or radio buttons ([style:menu{...}], [style:radio{...}]), as in faustcode.
import { describe, expect, it } from "vitest";
import { choicesOf } from "../../src/model/WidgetStyle";

describe("menu and radio styles", () => {
    it("reads the choices as the compiled JSON gives them (labels between dashes)", () => {
        expect(choicesOf([{ style: "menu{-sine-:0;-triangle-:1;-square-:2;-saw-:3}" }])).toEqual({
            kind: "menu",
            items: [{ label: "sine", value: 0 }, { label: "triangle", value: 1 }, { label: "square", value: 2 }, { label: "saw", value: 3 }],
        });
        expect(choicesOf([{ unit: "Hz" } as any, { style: "radio{-off-:0;-half-:0.5;-full-:1}" }])).toEqual({
            kind: "radio",
            items: [{ label: "off", value: 0 }, { label: "half", value: 0.5 }, { label: "full", value: 1 }],
        });
    });

    it("reads them as written in the source (labels between quotes)", () => {
        expect(choicesOf([{ style: "menu{'low pass':-1;'high pass':1e1}" }])!.items).toEqual([{ label: "low pass", value: -1 }, { label: "high pass", value: 10 }]);
    });

    it("leaves the other styles to the slider", () => {
        expect(choicesOf([{ style: "knob" }])).toBeNull();
        expect(choicesOf([{ style: "menu{}" }])).toBeNull();
        expect(choicesOf(undefined)).toBeNull();
    });
});
