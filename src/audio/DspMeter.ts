/*				DSPMETER.TS
    The load of the audio thread by the Faust modules, and the dropouts of the audio device.

    The load. Chrome gives no render capacity (AudioContext.renderCapacity) and no high resolution clock in the
    AudioWorkletGlobalScope (no performance.now(); Date.now() at 1 ms). The time spent is measured anyway, by the
    statistics of that clock:
    - a module loaded before any Faust module (install) wraps registerProcessor: the process() of every processor
      registered after it (the Faust modules, the recorder…) notes the time it ends; the first of them in a block of
      128 frames (a new currentFrame) closes the block before: its time is the end of its last processor minus the
      start of its first. The native nodes computed between two processors are counted, those before the first or
      after the last are not;
    - each time is a whole number of milliseconds, mostly 0. The blocks of a buffer of the device are computed back
      to back: their counts add up to that of the whole burst (floor(end) − floor(start)), within 1 ms; the bursts
      are not locked to the ticks of the clock (the device has its own clock, the thread is scheduled), so that
      their errors average out over half a second (tests/model/dsp-meter.test.ts). Checked where the truth is known
      (tests/e2e/dsp-meter.test.ts): overloaded, the thread is busy all the time, the load is the inverse of the pace
      of the context; the meter counts 93 to 96 % of it (the native nodes outside the processors are not counted);
    - the meter processor (faustmodular-dsp-meter, pulled through a gain at 0) sends the sum, and the frames elapsed,
      every half second: the load is the time spent over the duration of those frames, smoothed (LOAD_TAU).
    The modules are computed in blocks of 128 frames, the device asks for a buffer of several blocks: a load of 100 %
    leaves no margin, the dropouts start before.

    The dropouts: AudioContext.playbackStats (Chrome, the Audio Playback Stats proposal), the underruns of the
    device since the context started; their new ones at each report. Not every browser has it (null).
*/

export const PROCESSOR_NAME = "faustmodular-dsp-meter";
export const REPORT_EVERY = 0.5;        // s of audio between two reports
export const LOAD_TAU = 1;              // s: the time constant of the smoothing of the load
export const HIGH = 0.7;                // a load from this one is shown in amber
export const DROPOUT_WINDOW = 10;       // s: a dropout is shown in red for so long

// The code of the AudioWorkletGlobalScope (a module of its own, loaded before any processor to measure).
export const METER_WORKLET = `
const state = { busy: 0, blocks: 0, frame: -1, first: 0, last: 0 };
const wrapped = new WeakSet();
const register = globalThis.registerProcessor;
function wrap(process) {
    const measured = function (inputs, outputs, parameters) {
        const frame = currentFrame;
        if (frame !== state.frame) {
            if (state.frame >= 0) { state.busy += state.last - state.first; state.blocks++; }
            state.frame = frame;
            state.first = Date.now();
        }
        try {
            return process.call(this, inputs, outputs, parameters);
        } finally {
            state.last = Date.now();
        }
    };
    wrapped.add(measured);
    return measured;
}
globalThis.registerProcessor = function (name, processorClass) {
    const prototype = processorClass && processorClass.prototype;
    if (name !== "${PROCESSOR_NAME}" && prototype && typeof prototype.process === "function" && !wrapped.has(prototype.process)) {
        try { prototype.process = wrap(prototype.process); } catch (e) { /* not measured */ }
    }
    return register.call(globalThis, name, processorClass);
};
class DspMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.start = currentFrame;
    }
    process() {
        const frames = currentFrame - this.start;
        if (frames >= sampleRate * ${REPORT_EVERY}) {
            this.port.postMessage({ busy: state.busy, blocks: state.blocks, frames, sampleRate });
            state.busy = 0;
            state.blocks = 0;
            this.start = currentFrame;
        }
        return true;
    }
}
register.call(globalThis, "${PROCESSOR_NAME}", DspMeterProcessor);
`;

// A report of the meter processor: busy, the ms counted; frames, the audio elapsed.
export interface MeterReport {
    busy: number;
    blocks: number;
    frames: number;
    sampleRate: number;
}

export function isReport(data: any): data is MeterReport {
    return !!data && ["busy", "blocks", "frames", "sampleRate"].every((k) => typeof data[k] == "number" && Number.isFinite(data[k]))
        && data.frames > 0 && data.sampleRate > 0;
}

// The load of a report: the time spent over the duration of the audio elapsed (1 = all of it).
export function loadOf(report: MeterReport): number {
    return Math.max(0, report.busy / (1000 * report.frames / report.sampleRate));
}

// The load shown: the first one as is, then an exponential mean (time constant `tau`) over dt seconds.
export function smooth(previous: number | null, next: number, dt: number, tau = LOAD_TAU): number {
    if (previous === null) return next;
    const a = 1 - Math.exp(-dt / tau);
    return previous + a * (next - previous);
}

export interface PlaybackCounts {
    underrunEvents: number;
    underrunDuration: number;   // s
    totalDuration: number;      // s
}

// The counts of the device (AudioContext.playbackStats), or null if the browser has none.
export function playbackCounts(context: BaseAudioContext): PlaybackCounts | null {
    const stats = (context as any).playbackStats;
    if (!stats || typeof stats.underrunEvents != "number") return null;
    return {
        underrunEvents: stats.underrunEvents,
        underrunDuration: Number(stats.underrunDuration) || 0,
        totalDuration: Number(stats.totalDuration) || 0,
    };
}

// The dropouts between two counts (none if the counts started again).
export function newDropouts(previous: PlaybackCounts | null, next: PlaybackCounts | null): number {
    if (!previous || !next) return 0;
    return Math.max(0, next.underrunEvents - previous.underrunEvents);
}

export type MeterLevel = "suspended" | "normal" | "high" | "dropouts";

export function meterLevel(running: boolean, load: number | null, recentDropouts: number): MeterLevel {
    if (!running) return "suspended";
    if (recentDropouts > 0) return "dropouts";
    return load !== null && load >= HIGH ? "high" : "normal";
}

// The percentage shown: at most 999.
export function percent(load: number): number {
    return Math.min(999, Math.round(load * 100));
}

export class DspMeter {
    private fLoad: number | null = null;
    private fCounts: PlaybackCounts | null;
    private fDropouts: number[] = [];       // the times (ms, performance.now) of the dropouts reported
    private fTotal = 0;
    private fListeners: Array<() => void> = [];

    private constructor(private fContext: BaseAudioContext, node: AudioWorkletNode) {
        this.fCounts = playbackCounts(fContext);
        node.port.onmessage = (e) => { if (isReport(e.data)) this.report(e.data); };
        fContext.addEventListener("statechange", () => this.emit());
    }

    // Loads the meter in the context: before any processor to measure. null if it could not be.
    static async install(context: BaseAudioContext): Promise<DspMeter | null> {
        try {
            const url = URL.createObjectURL(new Blob([METER_WORKLET], { type: "application/javascript" }));
            try {
                await context.audioWorklet.addModule(url);
            } finally {
                URL.revokeObjectURL(url);
            }
            const node = new AudioWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
            const silent = context.createGain();
            silent.gain.value = 0;
            node.connect(silent).connect(context.destination);
            return new DspMeter(context, node);
        } catch (e) {
            console.warn("no DSP meter:", e);
            return null;
        }
    }

    get running(): boolean {
        return this.fContext.state == "running";
    }

    // The load, smoothed (null before the first report).
    get load(): number | null {
        return this.fLoad;
    }

    // Whether the browser reports the dropouts.
    get reportsDropouts(): boolean {
        return this.fCounts !== null;
    }

    // The dropouts of the last DROPOUT_WINDOW seconds.
    get recentDropouts(): number {
        const since = performance.now() - DROPOUT_WINDOW * 1000;
        while (this.fDropouts.length > 0 && this.fDropouts[0] < since) this.fDropouts.shift();
        return this.fDropouts.length;
    }

    get totalDropouts(): number {
        return this.fTotal;
    }

    get level(): MeterLevel {
        return meterLevel(this.running, this.fLoad, this.recentDropouts);
    }

    onChange(listener: () => void): void {
        this.fListeners.push(listener);
    }

    private report(report: MeterReport): void {
        this.fLoad = smooth(this.fLoad, loadOf(report), report.frames / report.sampleRate);
        const counts = playbackCounts(this.fContext);
        const fresh = newDropouts(this.fCounts, counts);
        this.fCounts = counts;
        const now = performance.now();
        for (let i = 0; i < Math.min(fresh, 100); i++) this.fDropouts.push(now);
        this.fTotal += fresh;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.fListeners) listener();
    }
}
