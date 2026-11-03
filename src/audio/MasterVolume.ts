/*				MASTERVOLUME.TS
    The volume of the whole scene: a gain between the physical output module and the audio device, as the
    volume of faustcode. The modules, their analyzers included, are before it.

    - The volume goes from 0 to 100 (%); the gain is (v / 100)², about −12 dB at 50 % (a perceptual curve),
      1 at 100 % (no boost). Its changes glide over 20 ms, without clicks.
    - Muted, the gain is 0 and the volume is kept: unmuted, it comes back. The audio keeps running (the
      analyzers, the modulations), unlike a suspended audio context.
    - The volume is remembered by the browser (localStorage), not by the scene: it is a setting of the
      listening, not of the patch (no history, no document).
    - A safety limiter follows the gain, for the ears and the speakers (a cycle of cables that blows up, a
      module badly set): a peak limiter linked across the channels, transparent under its ceiling (−1 dBFS,
      the gain is exactly 1 there), whose gain falls at once on a peak and comes back in about 100 ms; NaN and
      infinite samples are silenced. It tells when it acts (onLimit), shown on the speaker.
*/

export const VOLUME_KEY = "faustmodular-volume";
export const DEFAULT_VOLUME = 100;
const GLIDE = 0.02;     // s, the time constant of a change of the gain

// The gain of a volume (0..100): (v / 100)².
export function volumeGain(volume: number): number {
    const x = Math.max(0, Math.min(100, volume)) / 100;
    return x * x;
}

export function clampVolume(volume: number): number {
    return Math.max(0, Math.min(100, Math.round(volume * 10) / 10));
}

function storedVolume(): number {
    try {
        const text = localStorage.getItem(VOLUME_KEY);
        const v = Number(text);
        if (text !== null && Number.isFinite(v) && v >= 0 && v <= 100) return v;
    } catch { /* no storage */ }
    return DEFAULT_VOLUME;
}

export const LIMIT_CEILING = Math.pow(10, -1 / 20);     // −1 dBFS
const LIMIT_RELEASE = 0.1;                                  // s, the time constant of the return of the gain

// The limiter, an AudioWorkletProcessor (loaded from a Blob: no file to serve).
export const LIMITER_PROCESSOR = `
registerProcessor("faustmodular-limiter", class extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.ceiling = options.processorOptions.ceiling;
        this.release = Math.exp(-1 / (options.processorOptions.release * sampleRate));
        this.gain = 1;
        this.reduced = 0;       // samples limited since the last report
        this.count = 0;
    }
    process(inputs, outputs) {
        const input = inputs[0], output = outputs[0];
        const n = output[0] ? output[0].length : 128;
        for (let i = 0; i < n; i++) {
            let peak = 0;
            for (let c = 0; c < output.length; c++) {
                const x = input[c] ? input[c][i] : 0;
                const a = Number.isFinite(x) ? Math.abs(x) : 0;
                if (a > peak) peak = a;
            }
            // back towards 1, at once down to what the peak needs
            this.gain = 1 - (1 - this.gain) * this.release;
            if (peak * this.gain > this.ceiling) this.gain = this.ceiling / peak;
            if (this.gain < 0.999) this.reduced++;
            for (let c = 0; c < output.length; c++) {
                const x = input[c] ? input[c][i] : 0;
                output[c][i] = Number.isFinite(x) ? x * this.gain : 0;
            }
        }
        // a report about every 100 ms while it acts
        this.count += n;
        if (this.count >= sampleRate / 10) {
            if (this.reduced > 0) this.port.postMessage(this.reduced);
            this.reduced = 0;
            this.count = 0;
        }
        return true;
    }
});`;

export class MasterVolume {
    readonly node: GainNode;
    limiter: AudioWorkletNode | null = null;
    private fVolume = storedVolume();
    private fMuted = false;
    private fListeners: Array<() => void> = [];
    private fLimitListeners: Array<() => void> = [];

    // A gain of `channels` channels, discrete (no mixing), connected to the audio device through the limiter
    // (directly until the limiter is loaded).
    constructor(context: BaseAudioContext, private fChannels: number) {
        this.node = context.createGain();
        this.node.channelCount = fChannels;
        this.node.channelCountMode = "explicit";
        this.node.channelInterpretation = "discrete";
        this.node.gain.value = this.gain();
        this.node.connect(context.destination);
        this.ready = this.addLimiter(context);
    }

    // Resolved when the limiter is in place (false if it could not be loaded: the gain stays direct).
    readonly ready: Promise<boolean>;

    private async addLimiter(context: BaseAudioContext): Promise<boolean> {
        try {
            const url = URL.createObjectURL(new Blob([LIMITER_PROCESSOR], { type: "application/javascript" }));
            await context.audioWorklet.addModule(url);
            URL.revokeObjectURL(url);
            const limiter = new AudioWorkletNode(context, "faustmodular-limiter", {
                numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [this.fChannels],
                channelCount: this.fChannels, channelCountMode: "explicit", channelInterpretation: "discrete",
                processorOptions: { ceiling: LIMIT_CEILING, release: LIMIT_RELEASE },
            });
            limiter.port.onmessage = () => this.fLimitListeners.forEach((listener) => listener());
            this.node.disconnect();
            this.node.connect(limiter).connect(context.destination);
            this.limiter = limiter;
            return true;
        } catch (e) {
            console.warn("no safety limiter:", e);
            return false;
        }
    }

    // Called about every 100 ms while the limiter acts.
    onLimit(listener: () => void): void {
        this.fLimitListeners.push(listener);
    }

    get volume(): number {
        return this.fVolume;
    }

    get muted(): boolean {
        return this.fMuted;
    }

    setVolume(volume: number): void {
        const v = clampVolume(volume);
        if (v == this.fVolume) return;
        this.fVolume = v;
        try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* no storage */ }
        this.apply();
    }

    setMuted(muted: boolean): void {
        if (muted == this.fMuted) return;
        this.fMuted = muted;
        this.apply();
    }

    // Called on each change of the volume or of the mute.
    onChange(listener: () => void): void {
        this.fListeners.push(listener);
    }

    gain(): number {
        return this.fMuted ? 0 : volumeGain(this.fVolume);
    }

    private apply(): void {
        const context = this.node.context;
        this.node.gain.cancelScheduledValues(context.currentTime);
        this.node.gain.setTargetAtTime(this.gain(), context.currentTime, GLIDE);
        this.fListeners.forEach((listener) => listener());
    }
}
