/*				TRANSPORTVIEW.TS
    The transport of the toolbar (Documentation/FAUST-SYNC-SPEC.md, § 8.1): play / stop, the tempo, the position
    (bar:beat) of the timeline shared with the other Faust applications of the browser, and back to the start.
    Playing, stopping or changing the tempo here does it in all of them; what they do shows here.
*/

import type { SharedTimeline } from "./SharedTimeline";
import { barBeat, TEMPO_MAX, TEMPO_MIN } from "./Timeline";
import type { Recorder } from "../audio/Recorder";
import { showContextMenu } from "../view/ContextMenu";

// The texts of ● Record.
export interface RecordTexts {
    record: string; recordUntilStop: string; recordBars: string; recordWaiting: string; recording: string; recordStop: string;
}

const RECORD_BARS = "faustmodular-record-bars";
const BAR_CHOICES = [1, 2, 4, 8, 16, 32];

export class TransportView {
    readonly element: HTMLElement;
    private fPlay: HTMLElement;
    private fRewind: HTMLElement;
    private fTempo: HTMLInputElement;
    private fPosition: HTMLElement;
    private fRecord: HTMLElement;
    private fRecorder: Recorder | null = null;
    private fRecordTexts: (() => RecordTexts) | null = null;
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
        // ● Record (src/audio/Recorder.ts), once the recorder is attached
        this.fRecord = document.createElement("div");
        this.fRecord.className = "transportRecord hidden";
        this.fRecord.textContent = "\u25CF";
        this.fRecord.addEventListener("click", () => this.record());
        this.element.append(this.fRewind, this.fPlay, this.fRecord, this.fTempo, bpm, this.fPosition);
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

    // The recorder of the main output, and its texts.
    attachRecorder(recorder: Recorder, texts: () => RecordTexts): void {
        this.fRecorder = recorder;
        this.fRecordTexts = texts;
        this.fRecord.classList.remove("hidden");
        recorder.onChange(() => this.showRecord());
        this.showRecord();
    }

    // ●: idle, a menu (until stopped, or a number of bars); waiting or recording: stop.
    private record(): void {
        const recorder = this.fRecorder, texts = this.fRecordTexts?.();
        if (!recorder || !texts) return;
        if (recorder.state != "idle") { recorder.stop(); return; }
        let last: number | null = null;
        try { const v = localStorage.getItem(RECORD_BARS); last = v === null || v == "0" ? null : Number(v); } catch { /* none */ }
        const choose = (bars: number | null) => {
            try { localStorage.setItem(RECORD_BARS, String(bars ?? 0)); } catch { /* not kept */ }
            void recorder.start(bars);
        };
        const r = this.fRecord.getBoundingClientRect();
        showContextMenu(r.left, r.bottom + 4, [
            { label: texts.recordUntilStop, checked: last === null, action: () => choose(null) },
            "separator",
            ...BAR_CHOICES.map((n) => ({ label: texts.recordBars.replace("%n", String(n)), checked: last === n, action: () => choose(n) })),
        ]);
    }

    private showRecord(): void {
        const recorder = this.fRecorder, texts = this.fRecordTexts?.();
        if (!recorder || !texts) return;
        const state = recorder.state;
        this.fRecord.classList.toggle("waiting", state == "waiting");
        this.fRecord.classList.toggle("recording", state == "recording" || state == "writing");
        this.fRecord.title = state == "idle" ? texts.record
            : state == "waiting" ? texts.recordWaiting
                : texts.recording.replace("%n", recorder.bars ? String(recorder.bars) : "∞") + "\n" + texts.recordStop;
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
        const recording = this.fRecorder?.state == "recording";
        const text = recording
            ? `${bar}:${beat} \u25CF${Math.floor(this.fRecorder!.elapsedBars()) + 1}${this.fRecorder!.bars ? "/" + this.fRecorder!.bars : ""}`
            : `${bar}:${beat}`;
        if (text != this.fShown) {
            this.fShown = text;
            this.fPosition.textContent = text;
        }
    }
}
