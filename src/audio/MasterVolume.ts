/*				MASTERVOLUME.TS
    The volume of the whole scene: a gain between the physical output module and the audio device, as the
    volume of faustcode. The modules, their analyzers included, are before it.

    - The volume goes from 0 to 100 (%); the gain is (v / 100)², about −12 dB at 50 % (a perceptual curve),
      1 at 100 % (no boost). Its changes glide over 20 ms, without clicks.
    - Muted, the gain is 0 and the volume is kept: unmuted, it comes back. The audio keeps running (the
      analyzers, the modulations), unlike a suspended audio context.
    - The volume is remembered by the browser (localStorage), not by the scene: it is a setting of the
      listening, not of the patch (no history, no document).
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

export class MasterVolume {
    readonly node: GainNode;
    private fVolume = storedVolume();
    private fMuted = false;
    private fListeners: Array<() => void> = [];

    // A gain of `channels` channels, discrete (no mixing), connected to the audio device.
    constructor(context: BaseAudioContext, channels: number) {
        this.node = context.createGain();
        this.node.channelCount = channels;
        this.node.channelCountMode = "explicit";
        this.node.channelInterpretation = "discrete";
        this.node.gain.value = this.gain();
        this.node.connect(context.destination);
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
