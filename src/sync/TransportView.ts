/*				TRANSPORTVIEW.TS
    The transport of the toolbar (Documentation/FAUST-SYNC-SPEC.md, § 8.1): play / stop, the tempo, the position
    (bar:beat) of the timeline shared with the other Faust applications of the browser, and back to the start.
    Playing, stopping or changing the tempo here does it in all of them; what they do shows here.
*/

import type { SharedTimeline } from "./SharedTimeline";
import { commonNow } from "./SharedTimeline";
import { barBeat, TEMPO_MAX, TEMPO_MIN } from "./Timeline";

export class TransportView {
    readonly element: HTMLElement;
    private fPlay: HTMLElement;
    private fRewind: HTMLElement;
    private fTempo: HTMLInputElement;
    private fPosition: HTMLElement;
    private fSync: SharedTimeline | null = null;
    private fShown = "";

    constructor(private fTexts: () => { play: string; stop: string; rewind: string; tempo: string; position: string; transport: string }) {
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
        this.element.title = texts.transport + (this.fSync && this.fSync.peers.size > 0 ? ` (${this.fSync.peers.size + 1})` : "");
        if (t && document.activeElement !== this.fTempo) this.fTempo.value = String(t.tempo);
    }

    private showPosition(): void {
        const sync = this.fSync;
        if (!sync) return;
        const { bar, beat } = barBeat(sync.positionAt(commonNow()), sync.timeline.meter);
        const text = `${bar}:${beat}`;
        if (text != this.fShown) {
            this.fShown = text;
            this.fPosition.textContent = text;
        }
    }
}
