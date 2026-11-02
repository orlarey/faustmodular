/*				DISPLAYS.TS
    What a module shows of its signals:

    - its bargraphs (hbargraph, vbargraph): a bar and the value, refreshed at each frame from the values
      the DSP reports (setOutputParamHandler of faustwasm). Any Faust module can measure what it wants:
      attach(_, an.rms_envelope_rect(0.05) : ba.linear2db : hbargraph("RMS[unit:dB]", -70, 0));
    - an oscilloscope or a spectrum of its output, for a module that declares it:
      declare display "scope";   or   declare display "spectrum";
      Drawn as faustcode draws them (ScopeDraw.ts). The display reads the widgets of the module by their
      label: View (waveform 0, spectrum 1; without it, the declared display), Time (ms, 20 without
      one: up to half the buffer of the analyser the waveform is triggered, beyond it scrolls, each
      column of pixels showing the minimum and maximum of its samples), Trigger (auto, normal), Slope
      (rising, falling), Threshold, Scale (log, linear), and Width and Height (the size of the display,
      set by the grip at its bottom right corner, so saved and undone with the module). The widgets
      of the other view are hidden. The Scope module of the library (display/Scope.dsp) has them all;
      a pass-through module (process = _;) can be put anywhere in a patch.

    The displays are rebuilt with the interface of the module (recompilation), and stop when it is
    removed.
*/

import { Colors, drawScopeGrid, drawSpectrum, drawWave, peakText, triggerIndex, yOfSample } from "./ScopeDraw";

interface UIItem {
    type: string;
    label: string;
    address: string;
    min?: number;
    max?: number;
    items?: UIItem[];
    meta?: Array<Record<string, string>>;
}

interface OutputNode extends AudioNode {
    getJSON(): string;
    setOutputParamHandler?(handler: ((path: string, value: number) => void) | null): void;
}

interface Bar {
    item: UIItem;
    fill: HTMLElement;
    value: HTMLElement;
    unit: string;
}

export type DisplayKind = "scope" | "spectrum";

// The display declared by a module (declare display "scope";).
export function declaredDisplay(json: { meta?: Array<Record<string, string>> }): DisplayKind | null {
    for (const m of json.meta ?? []) {
        const v = (m.display ?? "").trim().toLowerCase();
        if (v == "scope" || v == "spectrum") return v;
    }
    return null;
}

// A slider by its label (case ignored).
function findSlider(ui: UIItem[], label: string): UIItem | undefined {
    for (const item of ui) {
        if (item.items) {
            const found = findSlider(item.items, label);
            if (found) return found;
        } else if ((item.type == "hslider" || item.type == "vslider" || item.type == "nentry") && item.label.trim().toLowerCase() == label) {
            return item;
        }
    }
    return undefined;
}

export function bargraphsOf(ui: UIItem[]): UIItem[] {
    const found: UIItem[] = [];
    const walk = (items: UIItem[]) => items.forEach((i) => {
        if (i.items) walk(i.items);
        else if (i.type == "hbargraph" || i.type == "vbargraph") found.push(i);
    });
    walk(ui);
    return found;
}

// The part of the bar filled for a value: (value − min)/(max − min), in [0, 1].
export function barFraction(value: number, min: number, max: number): number {
    if (!(max > min) || !Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// What the displays need from their module: where a bar goes, the values of its widgets (those of the
// interface, set at once), and how to set one (saved with the module, undone).
export interface DisplayHost {
    place?(address: string): HTMLElement | undefined;
    param?(address: string): number | undefined;
    setParam?(address: string, value: number): void;
}

// The widgets of the Scope module read by the display (by label, case ignored).
const SCOPE_WIDGETS = ["view", "time", "trigger", "slope", "threshold", "scale", "width", "height"] as const;
type ScopeWidget = typeof SCOPE_WIDGETS[number];
// The widgets that only matter in a view: hidden in the other one.
const WAVE_ONLY: ScopeWidget[] = ["time", "trigger", "slope", "threshold"];
const SPECTRUM_ONLY: ScopeWidget[] = ["scale"];

const SIZE = { width: 320, height: 140, minWidth: 160, minHeight: 80, maxWidth: 1600, maxHeight: 1000 };
const HOLD_MS = 20;            // a new triggered image at most every HOLD_MS (faustcode: holdoff)

export class ModuleDisplays {
    private fBars: Bar[] = [];
    private fValues = new Map<string, number>();
    private fCanvas: HTMLCanvasElement | null = null;
    private fFrameBox: HTMLElement | null = null;
    private fAnalyser: AnalyserNode | null = null;
    private fKind: DisplayKind | null = null;
    private fFrame = 0;
    private fTime: Float32Array<ArrayBuffer> | null = null;
    private fFreq: Float32Array<ArrayBuffer> | null = null;
    private fElements: HTMLElement[] = [];
    private fAddress = new Map<ScopeWidget, string>();
    private fRoll: Array<[number, number]> = [];        // scrolling oscilloscope: [min, max] per column
    private fRollCarry = 0;                             // samples of the next column already counted
    private fLastFrame = 0;
    private fLastWindow: Float32Array | null = null;    // the last triggered image (normal mode)
    private fLastTrigger = 0;
    private fView: "wave" | "spectrum" | null = null;
    private fResizing = false;

    constructor(private fContainer: HTMLElement, private fNode: OutputNode, context: BaseAudioContext, private fHost: DisplayHost = {}) {
        const json = JSON.parse(fNode.getJSON());
        for (const item of bargraphsOf(json.ui ?? [])) this.addBar(item);
        this.fKind = declaredDisplay(json);
        for (const name of SCOPE_WIDGETS) {
            const address = findSlider(json.ui ?? [], name)?.address;
            if (address) this.fAddress.set(name, address);
        }
        if (this.fKind) this.addCanvas(context);
        if (this.fBars.length > 0) {
            fNode.setOutputParamHandler?.((path, value) => { this.fValues.set(path, value) });
        }
        if (this.fBars.length > 0 || this.fKind) this.fFrame = requestAnimationFrame(() => this.draw());
    }

    get empty(): boolean {
        return this.fBars.length == 0 && !this.fKind;
    }

    private addBar(item: UIItem): void {
        const unit = (item.meta ?? []).find((m) => m.unit)?.unit ?? "";
        const group = document.createElement("div");
        group.className = "control-group display-bar " + item.type;
        group.dataset.display = item.address;
        const info = document.createElement("div");
        info.className = "slider-info";
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = item.label;
        const value = document.createElement("span");
        value.className = "value";
        value.textContent = "–";
        info.append(label, value);
        const track = document.createElement("div");
        track.className = "bar-track";
        const fill = document.createElement("div");
        fill.className = "bar-fill";
        track.appendChild(fill);
        group.append(info, track);
        (this.fHost.place?.(item.address) ?? this.fContainer).appendChild(group);
        this.fElements.push(group);
        this.fBars.push({ item, fill, value, unit });
    }

    // The value of a widget of the display: from the interface (set at once), else from the node.
    private param(name: ScopeWidget, fallback: number): number {
        const address = this.fAddress.get(name);
        if (!address) return fallback;
        const v = this.fHost.param?.(address) ?? (this.fNode as any).getParamValue?.(address);
        return typeof v == "number" && !isNaN(v) ? v : fallback;
    }

    // The canvas in a frame with a grip at its bottom right corner: dragging it resizes the display
    // (and the module), the size is kept in the Width and Height widgets of the module (hidden).
    private addCanvas(context: BaseAudioContext): void {
        const frame = document.createElement("div");
        frame.className = "display-frame";
        const canvas = document.createElement("canvas");
        canvas.className = "display-canvas display-" + this.fKind;
        frame.appendChild(canvas);
        if (this.fAddress.has("width") && this.fAddress.has("height")) {
            const grip = document.createElement("div");
            grip.className = "display-grip";
            frame.appendChild(grip);
            this.attachGrip(grip, frame);
        }
        this.fContainer.appendChild(frame);
        this.fElements.push(frame);
        this.fCanvas = canvas;
        this.fFrameBox = frame;
        this.applySize();
        const analyser = context.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0.5;
        try {
            this.fNode.connect(analyser);
        } catch (e) {
            console.warn("display: the module has no output", e);
        }
        this.fAnalyser = analyser;
        this.fTime = new Float32Array(analyser.fftSize);
        this.fFreq = new Float32Array(analyser.frequencyBinCount);
    }

    private size(): { width: number; height: number } {
        return { width: this.param("width", SIZE.width), height: this.param("height", SIZE.height) };
    }

    // The size of the widgets on the canvas (unless it is being resized).
    private applySize(): void {
        if (!this.fCanvas || this.fResizing) return;
        const { width, height } = this.size();
        const w = width + "px", h = height + "px";
        if (this.fCanvas.style.width != w) this.fCanvas.style.width = w;
        if (this.fCanvas.style.height != h) this.fCanvas.style.height = h;
    }

    private attachGrip(grip: HTMLElement, frame: HTMLElement): void {
        grip.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            grip.setPointerCapture(e.pointerId);
            const canvas = this.fCanvas!;
            // the stage is zoomed: screen pixels per CSS pixel
            const scale = frame.getBoundingClientRect().width / Math.max(1, frame.offsetWidth);
            const start = { x: e.clientX, y: e.clientY, width: canvas.offsetWidth, height: canvas.offsetHeight };
            this.fResizing = true;
            const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
            const move = (m: PointerEvent) => {
                canvas.style.width = clamp(start.width + (m.clientX - start.x) / scale, SIZE.minWidth, SIZE.maxWidth) + "px";
                canvas.style.height = clamp(start.height + (m.clientY - start.y) / scale, SIZE.minHeight, SIZE.maxHeight) + "px";
            };
            const end = () => {
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("pointerup", end);
                grip.removeEventListener("pointercancel", end);
                this.fResizing = false;
                this.fHost.setParam?.(this.fAddress.get("width")!, canvas.offsetWidth);
                this.fHost.setParam?.(this.fAddress.get("height")!, canvas.offsetHeight);
            };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", end);
            grip.addEventListener("pointercancel", end);
        });
    }

    // The view: the View widget (waveform 0, spectrum 1) if any, else the declared display. The widgets
    // of the other view are hidden.
    private view(): "wave" | "spectrum" {
        const view = this.fAddress.has("view") ? (this.param("view", 0) >= 0.5 ? "spectrum" : "wave") : this.fKind == "spectrum" ? "spectrum" : "wave";
        if (view != this.fView) {
            this.fView = view;
            const hide = new Set(view == "spectrum" ? WAVE_ONLY : SPECTRUM_ONLY);
            for (const name of [...WAVE_ONLY, ...SPECTRUM_ONLY]) {
                const address = this.fAddress.get(name);
                if (!address) continue;
                this.fContainer.querySelector(`[data-widget="${CSS.escape(address)}"]`)?.classList.toggle("display-off", hide.has(name));
            }
            this.fCanvas?.classList.toggle("display-spectrum", view == "spectrum");
            this.fRoll = [];
            this.fLastWindow = null;
        }
        return view;
    }

    private draw(): void {
        if (!this.fContainer.isConnected) {
            this.dispose();
            return;
        }
        for (const bar of this.fBars) {
            const v = this.fValues.get(bar.item.address);
            if (v === undefined) continue;
            bar.fill.style.width = (100 * barFraction(v, bar.item.min ?? 0, bar.item.max ?? 1)) + "%";
            bar.value.textContent = (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) + (bar.unit ? " " + bar.unit : "");
        }
        if (this.fCanvas && this.fAnalyser) {
            this.applySize();
            const g = this.prepare();
            if (g) {
                if (this.view() == "spectrum") this.drawSpectrumView(g); else this.drawScope(g);
            }
        }
        this.fFrame = requestAnimationFrame(() => this.draw());
    }

    // The canvas at the pixels of the screen (zoom and device pixel ratio), the context in CSS pixels.
    private prepare(): { g: CanvasRenderingContext2D; width: number; height: number } | null {
        const canvas = this.fCanvas!;
        // the drawing inside the border
        const width = canvas.clientWidth, height = canvas.clientHeight;
        if (width == 0 || height == 0) return null;
        const scale = (canvas.getBoundingClientRect().width / Math.max(1, canvas.offsetWidth)) * (window.devicePixelRatio || 1);
        const w = Math.round(width * scale), h = Math.round(height * scale);
        if (canvas.width != w || canvas.height != h) {
            canvas.width = w;
            canvas.height = h;
        }
        const g = canvas.getContext("2d")!;
        g.setTransform(w / width, 0, 0, h / height, 0, 0);
        g.clearRect(0, 0, width, height);
        return { g, width, height };
    }

    private colors(): Colors {
        const style = getComputedStyle(this.fCanvas!);
        return { line: style.getPropertyValue("--fp-accent").trim() || "#7af0c0", grid: "rgba(255, 255, 255, 0.08)", text: "rgba(255, 255, 255, 0.45)" };
    }

    private drawScope(c: { g: CanvasRenderingContext2D; width: number; height: number }): void {
        const analyser = this.fAnalyser!;
        const samples = Math.max(16, Math.round((this.param("time", 20) / 1000) * analyser.context.sampleRate));
        if (samples <= analyser.fftSize / 2) this.drawTriggered(c, samples); else this.drawRolling(c, samples);
    }

    // A window of the signal starting on a crossing of the threshold (Trigger auto: the last samples
    // when there is none; normal: the last image stays).
    private drawTriggered(c: { g: CanvasRenderingContext2D; width: number; height: number }, shown: number): void {
        const data = this.fTime!;
        this.fAnalyser!.getFloatTimeDomainData(data);
        this.fRoll = [];
        const threshold = this.param("threshold", 0);
        const normal = this.param("trigger", 0) >= 0.5;
        const slope = this.param("slope", 0) >= 0.5 ? "falling" : "rising";
        const now = performance.now();
        let window = this.fLastWindow;
        if (!window || now - this.fLastTrigger >= HOLD_MS) {
            const start = triggerIndex(data, shown, threshold, slope);
            if (start >= 0) {
                window = data.slice(start, start + shown);
                this.fLastTrigger = now;
            } else if (!normal || !window || window.length != shown) {
                window = data.slice(data.length - shown);
            }
            this.fLastWindow = window;
        }
        drawWave(c.g, c.width, c.height, window!, this.colors(), threshold);
    }

    // A long duration scrolls: the samples that arrived since the last frame are reduced to the
    // minimum and maximum of each column of pixels.
    private drawRolling(c: { g: CanvasRenderingContext2D; width: number; height: number }, duration: number): void {
        const { g, width, height } = c;
        const data = this.fTime!;
        const analyser = this.fAnalyser!;
        analyser.getFloatTimeDomainData(data);
        const now = analyser.context.currentTime;
        const elapsed = this.fLastFrame > 0 ? Math.max(0, now - this.fLastFrame) : 0;
        this.fLastFrame = now;
        const columns = Math.max(1, Math.round(width));
        const perColumn = duration / columns;                     // samples per column
        const fresh = Math.min(data.length, Math.round(elapsed * analyser.context.sampleRate));
        let total = this.fRollCarry + fresh;
        let index = data.length - fresh;
        while (total >= perColumn && index < data.length) {
            const take = Math.max(1, Math.round(perColumn - this.fRollCarry));
            let lo = Infinity, hi = -Infinity;
            for (let i = index; i < Math.min(data.length, index + take); i++) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
            if (lo <= hi) this.fRoll.push([lo, hi]);
            index += take;
            total -= perColumn;
            this.fRollCarry = 0;
        }
        this.fRollCarry = Math.max(0, total);
        if (this.fRoll.length > columns) this.fRoll.splice(0, this.fRoll.length - columns);
        const colors = this.colors();
        drawScopeGrid(g, width, height, colors);
        g.strokeStyle = colors.line;
        g.lineWidth = 1.5;
        g.beginPath();
        const offset = columns - this.fRoll.length;
        // one continuous line, through the extent of each column
        this.fRoll.forEach(([lo, hi], i) => {
            const x = ((offset + i + 0.5) / columns) * width;
            if (i == 0) g.moveTo(x, yOfSample(hi, height)); else g.lineTo(x, yOfSample(hi, height));
            g.lineTo(x, yOfSample(lo, height));
        });
        g.stroke();
    }

    private drawSpectrumView(c: { g: CanvasRenderingContext2D; width: number; height: number }): void {
        const analyser = this.fAnalyser!;
        analyser.getFloatFrequencyData(this.fFreq!);
        const peak = drawSpectrum(c.g, c.width, c.height, this.fFreq!, analyser.context.sampleRate, this.param("scale", 0) < 0.5, this.colors());
        // the strongest peak, also as the tooltip of the display
        const text = peak ? peakText(peak) : "";
        if (this.fCanvas!.title != text) {
            this.fCanvas!.title = text;
            this.fCanvas!.dataset.peak = peak ? `${peak.freq} ${peak.db}` : "";
        }
    }

    dispose(): void {
        cancelAnimationFrame(this.fFrame);
        try { this.fNode.setOutputParamHandler?.(null); } catch { /* destroyed */ }
        if (this.fAnalyser) {
            try { this.fNode.disconnect(this.fAnalyser); } catch { /* destroyed */ }
            this.fAnalyser = null;
        }
        this.fElements.forEach((e) => e.remove());
        this.fElements = [];
    }
}
