import { AccelerometerHandler, AccelerometerSlider, Axis } from "../Accelerometer";
import { Utilitary } from "../Utilitary";
import { ModuleClass } from "./ModuleClass";
import { choicesOf } from "../model/WidgetStyle";
import { positionOf, sliderRange, sliderSteps, SliderRange, valueAt } from "../model/SliderScale";

/*				FAUSTINTERFACE.JS

    HELPER FUNCTIONS TO CREATE FAUST INTERFACES

    FIRST PART --> DECODE JSON ENCODED INTERFACE
    SECOND PART --> ADD GRAPHICAL OBJECTS TO INTERFACE
*/

/********************************************************************
*************************** DECODE JSON *****************************
********************************************************************/
interface Iitems extends HTMLDivElement {
    label: string;
    items: Iitems[];
    type: string;
    meta: any[];
}

interface Iitem {
    label: string;
    init: string;
    address: string;
    type: string;
    min: string;
    max: string;
    step: string;
    meta: FaustMeta[];
}

interface FaustMeta {
    acc: string;
    noacc: string;
    unit: string;
    style?: string;
    scale?: string;
}

export interface AccParams {
    isEnabled: boolean;
    acc: string;
    address: string;
    min: number;
    max: number;
    init: number;
    label: string;
}

// interface describing values needed to use CodeFaustParser
export interface ElementCodeFaustParser {
    sliderName: string,
    newAccValue: string,
    isEnabled: boolean
}

export class FaustInterfaceControler {
    //array only used at init to fill all FaustInterfaceControler of a Modules (moduleControlers)
    faustControlers: FaustInterfaceControler[];
    name: string;
    itemParam: Iitem;
    unit: string;
    precision: string;
    hasAccelerometer: boolean;
    isEnabled: boolean;
    accDefault: string = "0 0 -10 0 10";
    acc: string;
    value: string;
    accParams: AccParams;
    range: SliderRange;

    accelerometerSlider: AccelerometerSlider;
    faustInterfaceView: FaustInterfaceView;

    interfaceCallback: (faustInterfaceControler: FaustInterfaceControler) => void;
    callbackEdit: (event: Event) => void;
    updateFaustCodeCallback: (details: ElementCodeFaustParser) => void
    setDSPValueCallback: (address: string, value: string) => void;

    constructor(interfaceCallback: (faustInterfaceControler: FaustInterfaceControler) => void, setDSPValueCallback: (address: string, value: string) => void) {
        this.interfaceCallback = interfaceCallback;
        this.setDSPValueCallback = setDSPValueCallback;
    }
    //parse interface json from faust webaudio-asm-wrapper to create corresponding FaustInterfaceControler
    parseFaustJsonUI(ui: Iitems[], module: ModuleClass): FaustInterfaceControler[] {
        this.faustControlers = [];
        for (var i = 0; i < ui.length; i++) {
            this.parse_group(ui[i], module);
        }
        return this.faustControlers;
    }

    parse_group(group: Iitems, module: ModuleClass): void {
        if (group.items)
            this.parse_items(group.items, module);
    }

    parse_item(item: any, module: ModuleClass): void {

        var params = module.getInterfaceParams();

        if (params && params[item.address]) {
            item.init = params[item.address];
        }

        if (item.type === "vgroup" || item.type === "hgroup" || item.type === "tgroup") {
            this.parse_items(item.items, module);
        } else if (item.type === "vslider" || item.type === "hslider" || item.type === "nentry") {
            var itemElement = <Iitem>item;

            var controler: FaustInterfaceControler = new FaustInterfaceControler(
                () => { this.interfaceCallback(controler) },
                (adress, value) => { this.setDSPValueCallback(adress, value) }
            );
            controler.name = itemElement.label;
            controler.itemParam = itemElement;
            controler.value = itemElement.init;
            this.faustControlers.push(controler)

        } else if (item.type === "button") {
            var itemElement = <Iitem>item;
            var controler: FaustInterfaceControler = new FaustInterfaceControler(
                (faustInterface) => { this.interfaceCallback(faustInterface) },
                (adress, value) => { this.setDSPValueCallback(adress, value) }
            );
            controler.itemParam = itemElement;
            controler.value = "0";
            this.faustControlers.push(controler)

        } else if (item.type === "checkbox") {
            var itemElement = <Iitem>item;
            var controler: FaustInterfaceControler = new FaustInterfaceControler(
                (faustInterface) => { this.interfaceCallback(faustInterface) },
                (adress, value) => { this.setDSPValueCallback(adress, value) }
            );
            controler.itemParam = itemElement;
            controler.value = String(itemElement.init ?? "0");      // its saved value, if any
            this.faustControlers.push(controler)
        }
    }

    parse_items(items: Iitems[], node: ModuleClass): void {
        for (var i = 0; i < items.length; i++)
            this.parse_item(items[i], node);
    }

    setParams() {
        if (this.itemParam.meta != undefined) {
            for (var j = 0; j < this.itemParam.meta.length; j++) {
                if (this.itemParam.meta[j].unit) {
                    this.unit = this.itemParam.meta[j].unit;
                }
            }
        }
        if (this.unit == undefined) {
            this.unit = "";
        }

        if (this.itemParam.step != undefined) {
            // the decimals of the step (none for an integer step: "8", not "8.0")
            var step = this.itemParam.step.toString();
            var precision = step.includes('.') ? step.split('.').pop()!.length : 0;
            this.precision = String(precision);
            this.range = sliderRange(this.itemParam);
        }
        this.accParams = {
            isEnabled: this.isEnabled,
            acc: this.acc,
            address: this.itemParam.address,
            init: parseFloat(this.itemParam.init),
            max: parseFloat(this.itemParam.max),
            min: parseFloat(this.itemParam.min),
            label: this.itemParam.label
        }
    }

    // create and allocate right faustInterfaceView
    createFaustInterfaceElement(): HTMLElement | undefined {
        if (this.faustInterfaceView && this.faustInterfaceView.type) {
            if (this.faustInterfaceView.type === "vslider" || this.faustInterfaceView.type === "hslider" || this.faustInterfaceView.type === "nentry") {
                return this.faustInterfaceView.addFaustModuleSlider(this.itemParam, parseFloat(this.precision), this.unit, this.range)
            } else if (this.faustInterfaceView.type === "button") {
                return this.faustInterfaceView.addFaustButton(this.itemParam);
            } else if (this.faustInterfaceView.type === "checkbox") {
                return this.faustInterfaceView.addFaustCheckBox(this.itemParam);
            }
        }
    }

    // Set eventListner of the faustInterfaceView
    setEventListener() {
        if (this.faustInterfaceView && this.faustInterfaceView.type) {
            if (this.faustInterfaceView.type === "vslider" || this.faustInterfaceView.type === "hslider" || this.faustInterfaceView.type === "nentry") {
                this.faustInterfaceView.slider.addEventListener("input", (event) => {
                    this.interfaceCallback(this);
                    event.stopPropagation();
                    event.preventDefault();
                });
                this.faustInterfaceView.slider.addEventListener("mousedown", (e) => { e.stopPropagation() })
                this.faustInterfaceView.slider.addEventListener("touchstart", (e) => { e.stopPropagation() })
                this.faustInterfaceView.slider.addEventListener("touchmove", (e) => { e.stopPropagation() })
            } else if (this.faustInterfaceView.type === "button") {
                this.faustInterfaceView.button.addEventListener("mousedown", (e: Event) => {
                    e.stopPropagation();
                    this.interfaceCallback(this)

                })
                this.faustInterfaceView.button.addEventListener("mouseup", (e: Event) => {
                    e.stopPropagation();
                    this.interfaceCallback(this)
                })
                this.faustInterfaceView.button.addEventListener("touchstart", (e: Event) => {
                    e.stopPropagation();
                    this.interfaceCallback(this)
                })
                this.faustInterfaceView.button.addEventListener("touchend", (e: Event) => {
                    e.stopPropagation();
                    this.interfaceCallback(this)
                })
            } else if (this.faustInterfaceView.type === "checkbox") {
                this.faustInterfaceView.checkbox.addEventListener("change", (e: Event) => {
                    e.stopPropagation();
                    this.interfaceCallback(this);
                });
                ["mousedown", "touchstart", "pointerdown"].forEach((type) => this.faustInterfaceView.checkbox.addEventListener(type, (e) => e.stopPropagation()));
            }
        }
    }

    //attach acceleromterSlider to faustInterfaceControler
    //give the acc or noacc values
    //if no accelerometer value, it create a default noacc one
    createAccelerometer() {
        if (this.itemParam.meta) {
            var meta = this.itemParam.meta
            for (var i = 0; i < meta.length; i++) {
                if (meta[i].acc) {
                    this.acc = meta[i].acc;
                    this.accParams.acc = this.acc
                    this.accParams.isEnabled = true;
                    AccelerometerHandler.registerAcceleratedSlider(this.accParams, this)
                    this.accelerometerSlider.callbackValueChange = (address, value) => { this.callbackValueChange(address, value) }
                    this.accelerometerSlider.isEnabled = true;
                    this.faustInterfaceView.slider.classList.add("allowed");
                    this.faustInterfaceView.group.classList.add(Axis[this.accelerometerSlider.axis])
                    if (Utilitary.isAccelerometerOn) {
                        this.accelerometerSlider.isActive = true;
                        this.faustInterfaceView.slider.classList.remove("allowed");
                        this.faustInterfaceView.slider.classList.add("not-allowed");
                        this.faustInterfaceView.slider.disabled = true;
                    }
                } else if (meta[i].noacc) {
                    this.acc = meta[i].noacc;
                    this.accParams.acc = this.acc;
                    this.accParams.isEnabled = false;
                    AccelerometerHandler.registerAcceleratedSlider(this.accParams, this)
                    this.accelerometerSlider.callbackValueChange = (address, value) => { this.callbackValueChange(address, value) }
                    this.accelerometerSlider.isEnabled = false;
                    this.faustInterfaceView.slider.parentElement!.classList.add("disabledAcc")
                }
            }
            if (this.accelerometerSlider == undefined) {
                this.acc = this.accDefault;
                this.accParams.acc = this.acc;
                this.accParams.isEnabled = false;
                AccelerometerHandler.registerAcceleratedSlider(this.accParams, this);
                (this.accelerometerSlider as any).callbackValueChange = (address, value) => { this.callbackValueChange(address, value) }
                (this.accelerometerSlider as any).isEnabled = false;
                if (this.faustInterfaceView.slider != undefined) {
                    this.faustInterfaceView.slider.parentElement!.classList.add("disabledAcc")
                }
            }
        } else {
            this.acc = this.accDefault;
            this.accParams.acc = this.acc;
            this.accParams.isEnabled = false;
            AccelerometerHandler.registerAcceleratedSlider(this.accParams, this)
            this.accelerometerSlider.callbackValueChange = (address, value) => { this.callbackValueChange(address, value) }
            this.accelerometerSlider.isEnabled = false;
            if (this.faustInterfaceView.slider != undefined) {
                this.faustInterfaceView.slider.parentElement!.classList.add("disabledAcc")
            }
        }
    }

    //callback to update the dsp value
    callbackValueChange(address: string, value: number) {
        this.setDSPValueCallback(address, String(value));
        this.faustInterfaceView.slider.value = String(positionOf(this.range, value))
        this.faustInterfaceView.output.textContent = String(value.toFixed(parseFloat(this.precision)));
        this.faustInterfaceView.syncChoice();

    }
}

// A value set by the program (recall, undo, depth of a modulation): applied as it is, the slider
// only showing it (with a logarithmic scale, the position is not exact).
export function setControlerValue(controler: FaustInterfaceControler, value: number, apply: (address: string, value: number) => void): void {
    var text = controler.precision !== undefined ? value.toFixed(parseFloat(controler.precision)) : String(value);
    controler.value = text;
    var view = controler.faustInterfaceView;
    if (view?.slider && controler.range) view.slider.value = String(positionOf(controler.range, value));
    if (view?.output) view.output.textContent = text + " " + (controler.unit ?? "");
    if (view?.checkbox) {
        view.checkbox.checked = value >= 0.5;
        view.setLit(value >= 0.5);
    }
    view?.syncChoice();
    apply(controler.itemParam.address, Number(text));
}

/********************************************************************
********************* ADD GRAPHICAL ELEMENTS ***********************
********************************************************************/
// An arc of the knob (radius 18 around the center of a 48 × 48 box), from angle a0 to a1 in degrees,
// 0 at the top, clockwise.
function knobArc(a0: number, a1: number): string {
    var point = (a: number) => {
        var r = (a - 90) * Math.PI / 180;
        return `${(24 + 18 * Math.cos(r)).toFixed(2)} ${(24 + 18 * Math.sin(r)).toFixed(2)}`;
    };
    return `M ${point(a0)} A 18 18 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${point(a1)}`;
}

export class FaustInterfaceView {
    type: string;
    slider: HTMLInputElement;
    button: HTMLInputElement;
    checkbox: HTMLInputElement;
    output: HTMLElement;
    group: HTMLElement;
    label: HTMLElement;
    // a menu or radio buttons in place of the slider ([style:menu{...}], [style:radio{...}]); the
    // slider, hidden, stays the state of the widget (saving, undo, modulation, accelerometer)
    private fChoice: { select?: HTMLSelectElement; radios?: HTMLInputElement[]; values: number[] } | null = null;
    // a number entry (nentry) in place of the slider, which stays the state of the widget as for a choice
    private fEntry: { input: HTMLInputElement; precision: number } | null = null;
    // a knob ([style:knob]) in place of the slider, which stays the state of the widget
    private fKnob: { value: SVGPathElement; pointer: SVGLineElement } | null = null;
    private fItemParam: Iitem | null = null;
    private fRange: SliderRange | null = null;
    // a value typed in place of the value shown (a double click on it), set by the module
    onValueTyped: ((value: number) => void) | null = null;

    constructor(type: string) {
        this.type = type;
    }
    addFaustModuleSlider(itemParam: Iitem, precision: number, unit: string, range: SliderRange = sliderRange(itemParam)): HTMLElement {

        var group = document.createElement("div");
        group.className = "control-group";

        var info: HTMLDivElement = document.createElement("div");
        info.className = "slider-info";
        info.setAttribute("min", itemParam.min);
        info.setAttribute("max", itemParam.max);
        info.setAttribute("step", itemParam.step);
        info.setAttribute("precision", String(precision));
        var lab: HTMLSpanElement = document.createElement("span");
        lab.className = "label";
        lab.appendChild(document.createTextNode(itemParam.label));
        this.label = lab;
        info.appendChild(lab);
        var val: HTMLSpanElement = document.createElement("span");
        val.className = "value";
        this.output = val;

        var myValue: string = Number(itemParam.init).toFixed(precision);

        val.appendChild(document.createTextNode("" + myValue + " " + unit));
        val.setAttribute("units", unit);
        info.appendChild(val);

        group.appendChild(info);

        this.fRange = range;
        if (range.log) group.classList.add("control-log");

        var slider: HTMLInputElement = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = String(sliderSteps(range));
        slider.value = String(positionOf(range, parseFloat(itemParam.init)));
        slider.step = "1";
        this.slider = slider;
        group.appendChild(slider);

        this.group = group
        this.fItemParam = itemParam;
        var choices = choicesOf(itemParam.meta);
        if (choices) this.addChoices(choices, group, slider, val);
        else if (itemParam.type == "nentry") this.addEntry(group, slider, val, precision);
        else if ((itemParam.meta ?? []).some((m: any) => String(m.style ?? "").trim().toLowerCase() == "knob")) this.addKnob(group, info, lab, val, slider, itemParam);
        if (!choices && itemParam.type != "nentry") this.editableValue(val);
        // a vslider is shown as an hslider: the modules are laid out as a column of widgets
        return group;
    }

    // A knob: the label above, the value below; a vertical drag turns it (200 px for the whole range, 2000
    // with Shift), a double click sets it back to its initial value. The slider, hidden, is its state: the
    // positions of the slider (a logarithmic scale included) are the angles of the knob, from -135° to 135°.
    private addKnob(group: HTMLElement, info: HTMLElement, label: HTMLElement, value: HTMLElement, slider: HTMLInputElement, itemParam: Iitem): void {
        group.classList.add("control-knob");
        slider.classList.add("choice-slider");
        label.title = itemParam.label;
        info.remove();
        var NS = "http://www.w3.org/2000/svg" as const;
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("class", "knob");
        svg.setAttribute("viewBox", "0 0 48 48");
        var track = document.createElementNS(NS, "path");
        track.setAttribute("class", "knob-track");
        track.setAttribute("d", knobArc(-135, 135));
        var arc = document.createElementNS(NS, "path");
        arc.setAttribute("class", "knob-value");
        var body = document.createElementNS(NS, "circle");
        body.setAttribute("class", "knob-body");
        body.setAttribute("cx", "24");
        body.setAttribute("cy", "24");
        body.setAttribute("r", "14");
        var pointer = document.createElementNS(NS, "line");
        pointer.setAttribute("class", "knob-pointer");
        svg.append(track, arc, body, pointer);
        group.insertBefore(label, slider);
        group.insertBefore(svg, slider);
        group.insertBefore(value, slider);
        this.fKnob = { value: arc, pointer };
        var steps = Number(slider.max);
        var drag: { y: number; position: number } | null = null;
        var set = (position: number) => {
            var p = String(Math.round(Math.min(steps, Math.max(0, position))));
            if (p == slider.value) return;
            slider.value = p;
            slider.dispatchEvent(new Event("input"));
        };
        svg.addEventListener("pointerdown", (e: PointerEvent) => {
            if (e.pointerType == "mouse" && e.button != 0) return;
            e.stopPropagation();
            e.preventDefault();
            svg.setPointerCapture(e.pointerId);
            drag = { y: e.clientY, position: Number(slider.value) };
        });
        svg.addEventListener("pointermove", (e: PointerEvent) => {
            if (!drag) return;
            // by steps from the previous position, so that pressing or releasing Shift does not jump
            drag.position += ((drag.y - e.clientY) / (e.shiftKey ? 2000 : 200)) * steps;
            drag.y = e.clientY;
            set(drag.position);
        });
        var end = () => { drag = null; };
        svg.addEventListener("pointerup", end);
        svg.addEventListener("pointercancel", end);
        svg.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            set(this.position(parseFloat(itemParam.init)));
        });
        ["mousedown", "touchstart"].forEach((type) => svg.addEventListener(type, (e) => e.stopPropagation()));
        slider.addEventListener("input", () => this.syncChoice());
        this.syncChoice();
    }

    // The value of a slider or a knob: a double click turns it into a text field; Enter (or a click
    // elsewhere) sets the value typed, Escape gives up.
    private editableValue(value: HTMLElement): void {
        value.classList.add("value-editable");
        value.title = Utilitary.messageResource?.valueEditHint ?? "";
        value.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            this.editValue(value);
        });
    }

    private editValue(value: HTMLElement): void {
        if (!this.onValueTyped || value.querySelector("input")) return;
        var unit = value.getAttribute("units") ?? "";
        var shown = value.textContent ?? "";
        var input = document.createElement("input");
        input.type = "text";
        input.className = "value-input";
        input.inputMode = "decimal";
        input.spellcheck = false;
        input.value = shown.replace(unit, "").trim();
        value.textContent = "";
        value.appendChild(input);
        input.focus();
        input.select();
        var done = false;
        var finish = (commit: boolean) => {
            if (done) return;
            done = true;
            var text = input.value.trim().replace(",", ".");
            value.textContent = shown;
            var typed = Number(text);
            if (commit && text != "" && isFinite(typed)) this.onValueTyped?.(typed);
        };
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key == "Enter") finish(true);
            else if (e.key == "Escape") finish(false);
        });
        input.addEventListener("blur", () => finish(true));
        ["mousedown", "touchstart", "pointerdown", "dblclick"].forEach((type) => input.addEventListener(type, (e) => e.stopPropagation()));
    }

    // A number entry: typed values, kept in the range of the widget, set through the hidden slider.
    private addEntry(group: HTMLElement, slider: HTMLInputElement, value: HTMLElement, precision: number): void {
        group.classList.add("control-entry");
        slider.classList.add("choice-slider");
        value.classList.add("choice-value");
        var input = document.createElement("input");
        input.type = "number";
        input.className = "entry";
        input.min = this.fItemParam!.min;
        input.max = this.fItemParam!.max;
        input.step = this.fItemParam!.step;
        var range = this.fRange ?? sliderRange(this.fItemParam!);
        input.addEventListener("change", () => {
            var v = Number(input.value);
            if (isNaN(v)) { this.syncChoice(); return; }
            v = Math.min(range.max, Math.max(range.min, v));
            slider.value = String(this.position(v));
            slider.dispatchEvent(new Event("input"));
            input.blur();
        });
        ["mousedown", "touchstart", "pointerdown"].forEach((type) => input.addEventListener(type, (e) => e.stopPropagation()));
        var unit = value.getAttribute("units");
        var box = document.createElement("div");
        box.className = "entry-box";
        box.appendChild(input);
        if (unit) {
            var u = document.createElement("span");
            u.className = "entry-unit";
            u.textContent = unit;
            box.appendChild(u);
        }
        group.appendChild(box);
        this.fEntry = { input, precision };
        slider.addEventListener("input", () => this.syncChoice());
        this.syncChoice();
    }

    // The value of a choice as a position of the slider.
    private position(value: number): number {
        return positionOf(this.fRange ?? sliderRange(this.fItemParam!), value);
    }

    private addChoices(choices: NonNullable<ReturnType<typeof choicesOf>>, group: HTMLElement, slider: HTMLInputElement, value: HTMLElement): void {
        group.classList.add("control-choice", "control-" + choices.kind);
        slider.classList.add("choice-slider");
        value.classList.add("choice-value");
        var values = choices.items.map((item) => item.value);
        var choose = (v: number) => {
            slider.value = String(this.position(v));
            slider.dispatchEvent(new Event("input"));
        };
        if (choices.kind == "menu") {
            var select = document.createElement("select");
            select.className = "choice-menu";
            choices.items.forEach((item, i) => {
                var option = document.createElement("option");
                option.value = String(i);
                option.textContent = item.label;
                select.appendChild(option);
            });
            // the choice made, the menu gives the focus back (keyboard shortcuts of the scene)
            select.addEventListener("change", () => { choose(values[Number(select.value)]); select.blur(); });
            ["mousedown", "touchstart", "pointerdown"].forEach((type) => select.addEventListener(type, (e) => e.stopPropagation()));
            group.appendChild(select);
            this.fChoice = { select, values };
        } else {
            var box = document.createElement("div");
            box.className = "choice-radios";
            var name = "radio-" + Math.random().toString(36).slice(2);
            var radios: HTMLInputElement[] = choices.items.map((item, i) => {
                var label = document.createElement("label");
                var radio = document.createElement("input");
                radio.type = "radio";
                radio.name = name;
                radio.value = String(i);
                radio.addEventListener("change", () => { if (radio.checked) choose(values[i]) });
                ["mousedown", "touchstart", "pointerdown"].forEach((type) => label.addEventListener(type, (e) => e.stopPropagation()));
                label.append(radio, document.createTextNode(item.label));
                box.appendChild(label);
                return radio;
            });
            group.appendChild(box);
            this.fChoice = { radios, values };
        }
        // the slider changed by the program (undo, recall, modulation of the values saved...)
        slider.addEventListener("input", () => this.syncChoice());
        this.syncChoice();
    }

    // Shows the choice of the slider's value (the nearest one).
    syncChoice(): void {
        if (this.fKnob && this.slider) {
            var angle = -135 + 270 * (Number(this.slider.value) / Math.max(1, Number(this.slider.max)));
            this.fKnob.value.setAttribute("d", angle > -134.9 ? knobArc(-135, angle) : "");
            var r = (angle - 90) * Math.PI / 180;
            this.fKnob.pointer.setAttribute("x1", String(24 + 5 * Math.cos(r)));
            this.fKnob.pointer.setAttribute("y1", String(24 + 5 * Math.sin(r)));
            this.fKnob.pointer.setAttribute("x2", String(24 + 12 * Math.cos(r)));
            this.fKnob.pointer.setAttribute("y2", String(24 + 12 * Math.sin(r)));
        }
        if (this.fEntry && this.slider) {
            var range = this.fRange ?? sliderRange(this.fItemParam!);
            this.fEntry.input.value = valueAt(range, Number(this.slider.value)).toFixed(this.fEntry.precision);
        }
        if (!this.fChoice || !this.slider) return;
        var position = Number(this.slider.value);
        var values = this.fChoice.values;
        var index = 0;
        values.forEach((v, i) => { if (Math.abs(this.position(v) - position) < Math.abs(this.position(values[index]) - position)) index = i; });
        if (this.fChoice.select) this.fChoice.select.value = String(index);
        this.fChoice.radios?.forEach((r, i) => { r.checked = i == index; });
    }

    // A checkbox: a button as the others, with a LED that keeps its state (the convention of hardware
    // synthesizers: a button without LED is momentary, with a LED it latches). The checkbox, hidden in
    // it, is the state; checked from its value (saved, or its init).
    addFaustCheckBox(itemParam: Iitem): HTMLElement {
        var group = document.createElement("div");
        group.className = "control-group control-button control-checkbox";
        var pill: HTMLLabelElement = document.createElement("label");
        pill.className = "pill";
        var checkbox: HTMLInputElement = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = parseFloat(itemParam.init) >= 0.5;
        this.checkbox = checkbox;
        var led = document.createElement("span");
        led.className = "led";
        var text = document.createElement("span");
        text.className = "label";
        text.textContent = itemParam.label;
        this.label = text;
        pill.append(checkbox, led, text);
        // a click toggles the checkbox, and must not start a drag of the module
        ["mousedown", "touchstart", "pointerdown"].forEach((type) => pill.addEventListener(type, (e) => e.stopPropagation()));
        group.appendChild(pill);
        this.group = group;
        this.setLit(checkbox.checked);
        return group;
    }

    // Lit: a checkbox checked (its LED), a button held down; or the value a modulation drives them to.
    setLit(on: boolean): void {
        this.group?.classList.toggle("lit", on);
    }

    // A button, centered on its own row, as wide as half the module (Theme.css).
    addFaustButton(itemParam: Iitem): HTMLElement {
        var group = document.createElement("div");
        group.className = "control-group control-button";
        var button = document.createElement("input");
        button.type = "button";
        this.button = button;
        this.button.value = itemParam.label;
        group.appendChild(button);
        this.group = group;
        return group;
    }
}
