/*				TRANSPORTVIEW.TS
    The transport of the toolbar (Documentation/FAUST-SYNC-SPEC.md, § 8.1): play / stop, the tempo, the position
    (bar:beat) of the timeline shared with the other Faust applications of the browser, and back to the start.
    Playing, stopping or changing the tempo here does it in all of them; what they do shows here.
*/

import type { SharedTimeline } from "./SharedTimeline";
import { barBeat, TEMPO_MAX, TEMPO_MIN } from "./Timeline";

export class TransportView {
    readonly element: HTMLElement;
    private fPlay: HTMLElement;
    private fRewind: HTMLElement;
    private fTempo: HTMLInputElement;
    private fPosition: HTMLElement;
    private fSync: SharedTimeline | null = null;
    private fShown = "";

    constructor(private fTexts: () => { play: string; stop: string; rewind: string; tempo: string; position: string; transport: string; clocks: string; correction: string; gates: string; gate: string }) {
        this.element = document.createElement("div");
        this.element.id = "transport";
        this.element.className = "transport disabled";
        this.fRewind = document.createElement("div");
        this.fRewind.className = "transportRewind";
        this.fRewind.textContent = "\u23EE";
        this.fPlay = document.createElement("div");
        this.fPlay.className = "transportPlay";
        this.fTempo = document.createElement("input");
        this.fTempo.type = "number";
        this.fTempo.className = "transportTempo";
        this.fTempo.min = String(TEMPO_MIN);
        this.fTempo.max = String(TEMPO_MAX);
        this.fTempo.step = "1";
        const bpm = document.createElement("span");
        bpm.className = "transportUnit";
        bpm.textContent = "BPM";
        this.fPosition = document.createElement("span");
        this.fPosition.className = "transportPosition";
        this.element.append(this.fRewind, this.fPlay, this.fTempo, bpm, this.fPosition);
        this.fPlay.addEventListener("click", () => this.toggle());
        this.fRewind.addEventListener("click", () => this.rewind());
        this.fTempo.addEventListener("change", () => {
            const tempo = Number(this.fTempo.value);
            if (this.fSync && Number.isFinite(tempo) && tempo > 0) this.fSync.operate({ type: "tempo", tempo });
            this.show();
        });
        this.fTempo.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key == "Enter") this.fTempo.blur();
        });
        const loop = () => { this.showPosition(); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
    }

    // The timeline, once its node is ready.
    attach(sync: SharedTimeline): void {
        this.fSync = sync;
        this.element.classList.remove("disabled");
        sync.onChange(() => this.show());
        this.show();
    }

    private toggle(): void {
        const sync = this.fSync;
        if (!sync) return;
        sync.operate(sync.timeline.playing ? { type: "stop" } : { type: "play" });
    }

    // Back to the start: playing, from the first beat of the first bar (a start, for the sequencers).
    private rewind(): void {
        const sync = this.fSync;
        if (!sync) return;
        sync.operate(sync.timeline.playing ? { type: "play", fromStart: true } : { type: "locate", beat: 0 });
    }

    private show(): void {
        const t = this.fSync?.timeline;
        const texts = this.fTexts();
        const playing = !!t?.playing;
        this.element.classList.toggle("playing", playing);
        this.element.classList.toggle("stopped", !playing);
        this.fPlay.textContent = playing ? "■" : "▶";
        this.fPlay.title = playing ? texts.stop : texts.play;
        this.fRewind.title = texts.rewind;
        this.fTempo.title = texts.tempo;
        this.fPosition.title = texts.position;
        this.fDiagnosed = 0;
        if (t && document.activeElement !== this.fTempo) this.fTempo.value = String(t.tempo);
    }

    // The clocks of the other applications and the corrections of the position, in the tooltip (each second).
    private fDiagnosed = 0;
    private diagnose(): void {
        const sync = this.fSync, now = performance.now();
        if (!sync || now - this.fDiagnosed < 1000) return;
        this.fDiagnosed = now;
        const texts = this.fTexts(), d = sync.diagnosis();
        const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""));
        let title = texts.transport + "\n" + fill(texts.clocks, { peers: d.peers, frozen: d.frozen, count: d.corrections });
        if (d.last) title += "\n" + fill(texts.correction, { shift: (d.last.shift >= 0 ? "+" : "") + d.last.shift.toFixed(3), ago: Math.round(d.last.ago), reason: d.last.reason });
        title += "\n" + fill(texts.gates, { count: d.gates, jumps: d.frameJumps });
        if (d.gate) title += "\n" + fill(texts.gate, { kind: d.gate.kind, value: d.gate.value, expected: d.gate.expected, ago: Math.round(d.gate.ago) });
        if (this.element.title != title) this.element.title = title;
    }

    private showPosition(): void {
        const sync = this.fSync;
        if (!sync) return;
        this.diagnose();
        const { bar, beat } = barBeat(sync.positionNow(), sync.timeline.meter);
        const text = `${bar}:${beat}`;
        if (text != this.fShown) {
            this.fShown = text;
            this.fPosition.textContent = text;
        }
    }
}
