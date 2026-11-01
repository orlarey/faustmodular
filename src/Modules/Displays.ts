/*				DISPLAYS.TS
    What a module shows of its signals:

    - its bargraphs (hbargraph, vbargraph): a bar and the value, refreshed at each frame from the values
      the DSP reports (setOutputParamHandler of faustwasm). Any Faust module can measure what it wants:
      attach(_, an.rms_envelope_rect(0.05) : ba.linear2db : hbargraph("RMS[unit:dB]", -70, 0));
    - an oscilloscope or a spectrum of its output, for a module that declares it:
      declare display "scope";   or   declare display "spectrum";
      The duration shown by an oscilloscope is the value of its slider labelled "Time" (in ms), 20 ms
      without one: up to the buffer of the analyser it is triggered on a rising zero crossing, beyond
      it scrolls, each column of pixels showing the minimum and maximum of its samples.
      (a pass-through module, process = _;, can then be put anywhere in a patch).

    The displays are rebuilt with the interface of the module (recompilation), and stop when it is
    removed.
*/

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

export class ModuleDisplays {
    private fBars: Bar[] = [];
    private fValues = new Map<string, number>();
    private fCanvas: HTMLCanvasElement | null = null;
    private fAnalyser: AnalyserNode | null = null;
    private fKind: DisplayKind | null = null;
    private fFrame = 0;
    private fBuffer: Float32Array<ArrayBuffer> | null = null;
    private fElements: HTMLElement[] = [];
    private fTimeAddress: string | null = null;         // the "Time" slider of an oscilloscope
    private fRoll: Array<[number, number]> = [];        // scrolling oscilloscope: [min, max] per column
    private fRollCarry = 0;                             // samples of the next column already counted
    private fLastFrame = 0;

    constructor(private fContainer: HTMLElement, private fNode: OutputNode, context: BaseAudioContext) {
        const json = JSON.parse(fNode.getJSON());
        for (const item of bargraphsOf(json.ui ?? [])) this.addBar(item);
        this.fKind = declaredDisplay(json);
        this.fTimeAddress = findSlider(json.ui ?? [], "time")?.address ?? null;
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
        this.fContainer.appendChild(group);
        this.fElements.push(group);
        this.fBars.push({ item, fill, value, unit });
    }

    private addCanvas(context: BaseAudioContext): void {
        const canvas = document.createElement("canvas");
        canvas.className = "display-canvas display-" + this.fKind;
        canvas.width = 320;
        canvas.height = 140;
        this.fContainer.appendChild(canvas);
        this.fElements.push(canvas);
        this.fCanvas = canvas;
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = this.fKind == "spectrum" ? 0.75 : 0;
        try {
            this.fNode.connect(analyser);
        } catch (e) {
            console.warn("display: the module has no output", e);
        }
        this.fAnalyser = analyser;
        this.fBuffer = new Float32Array(this.fKind == "spectrum" ? analyser.frequencyBinCount : analyser.fftSize);
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
        if (this.fCanvas && this.fAnalyser && this.fBuffer) {
            if (this.fKind == "scope") this.drawScope(); else this.drawSpectrum();
        }
        this.fFrame = requestAnimationFrame(() => this.draw());
    }

    private colors(): { line: string; grid: string } {
        const style = getComputedStyle(this.fCanvas!);
        return { line: style.getPropertyValue("--fp-accent").trim() || "#7af0c0", grid: "rgba(255, 255, 255, 0.08)" };
    }

    // The duration shown by the oscilloscope, in seconds.
    private scopeDuration(): number {
        let ms = 20;
        if (this.fTimeAddress) {
            const v = (this.fNode as any).getParamValue?.(this.fTimeAddress);
            if (typeof v == "number" && v > 0) ms = v;
        }
        return ms / 1000;
    }

    private drawScope(): void {
        const analyser = this.fAnalyser!;
        const sampleRate = analyser.context.sampleRate;
        const samples = Math.max(16, Math.round(this.scopeDuration() * sampleRate));
        if (samples <= analyser.fftSize / 2) this.drawTriggered(samples); else this.drawRolling(samples);
    }

    // The waveform from a rising zero crossing (a stable image of a periodic signal), in [−1, 1].
    private drawTriggered(shown: number): void {
        const canvas = this.fCanvas!, g = canvas.getContext("2d")!, data = this.fBuffer!;
        this.fAnalyser!.getFloatTimeDomainData(data);
        this.fRoll = [];
        let start = 0;
        for (let i = 1; i < data.length - shown; i++) {
            if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
        }
        const { line, grid } = this.colors();
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.strokeStyle = grid;
        g.beginPath();
        g.moveTo(0, canvas.height / 2);
        g.lineTo(canvas.width, canvas.height / 2);
        g.stroke();
        g.strokeStyle = line;
        g.lineWidth = 1.5;
        g.beginPath();
        for (let i = 0; i < shown; i++) {
            const x = (i / (shown - 1)) * canvas.width;
            const y = (0.5 - Math.max(-1, Math.min(1, data[start + i])) * 0.45) * canvas.height;
            if (i == 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
    }

    // A long duration scrolls: the samples that arrived since the last frame are reduced to the
    // minimum and maximum of each column of pixels.
    private drawRolling(duration: number): void {
        const canvas = this.fCanvas!, g = canvas.getContext("2d")!, data = this.fBuffer!;
        const analyser = this.fAnalyser!;
        analyser.getFloatTimeDomainData(data);
        const now = analyser.context.currentTime;
        const elapsed = this.fLastFrame > 0 ? Math.max(0, now - this.fLastFrame) : 0;
        this.fLastFrame = now;
        const perColumn = duration / canvas.width;                 // samples per column
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
        if (this.fRoll.length > canvas.width) this.fRoll.splice(0, this.fRoll.length - canvas.width);
        const { line, grid } = this.colors();
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.strokeStyle = grid;
        g.beginPath();
        g.moveTo(0, canvas.height / 2);
        g.lineTo(canvas.width, canvas.height / 2);
        g.stroke();
        g.strokeStyle = line;
        g.lineWidth = 1.5;
        g.beginPath();
        const y = (v: number) => (0.5 - Math.max(-1, Math.min(1, v)) * 0.45) * canvas.height;
        const offset = canvas.width - this.fRoll.length;
        // one continuous line, through the extent of each column
        this.fRoll.forEach(([lo, hi], i) => {
            const x = offset + i + 0.5;
            if (i == 0) g.moveTo(x, y(hi)); else g.lineTo(x, y(hi));
            g.lineTo(x, y(lo));
        });
        g.stroke();
    }

    // The magnitude spectrum in dB (−100..0), on a logarithmic frequency axis from 20 Hz.
    private drawSpectrum(): void {
        const canvas = this.fCanvas!, g = canvas.getContext("2d")!, data = this.fBuffer!;
        const analyser = this.fAnalyser!;
        analyser.getFloatFrequencyData(data);
        const nyquist = analyser.context.sampleRate / 2;
        const fmin = 20, ratio = Math.log(nyquist / fmin);
        const { line, grid } = this.colors();
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.strokeStyle = grid;
        for (const f of [100, 1000, 10000]) {
            const x = (Math.log(f / fmin) / ratio) * canvas.width;
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x, canvas.height);
            g.stroke();
        }
        g.strokeStyle = line;
        g.lineWidth = 1.5;
        g.beginPath();
        let started = false;
        for (let k = 1; k < data.length; k++) {
            const f = (k * nyquist) / data.length;
            if (f < fmin) continue;
            const x = (Math.log(f / fmin) / ratio) * canvas.width;
            const db = Number.isFinite(data[k]) ? data[k] : -100;
            const y = (1 - barFraction(db, -100, 0)) * canvas.height;
            if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
        }
        g.stroke();
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
