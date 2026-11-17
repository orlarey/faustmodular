/*				PORTMETERS.TS
    The ports lit by their signal, discreetly: an output port glows with the level of its output, an input port
    (audio or modulation) with the strongest of the outputs connected to it. A glow inside the port (css/Theme.css,
    .port::after, its opacity following --level): nothing else moves.

    Light by design:
    - the outputs are metered by an AnalyserNode each (AudioGraph.setMetered), only for the modules already computed:
      those that lead to the speakers or to a display (computedModules). An analyser makes Web Audio compute what
      feeds it: metering the others would compute modules nobody hears;
    - the inputs are not metered: their level is that of their sources;
    - read 20 times a second (READ_INTERVAL), the peak of the last 43 ms; a level in dB from −48 to 0 (levelOf),
      rising at once and falling in about 150 ms (decay), as a VU meter;
    - written only when it changed by more than STEP, for the modules in the window, while the tab is shown and the
      audio runs; nothing at all when the animation is off (the menu of the stage).
*/

export const READ_INTERVAL = 50;        // ms between two reads
export const RELEASE = 0.15;            // s: the time constant of the fall of a level
export const FLOOR_DB = -48;            // dB: the level of a port off
export const STEP = 0.04;               // a change of the level smaller than this is not written

// The level shown for a peak: 0 at FLOOR_DB and below, 1 at 0 dB and above, linear in dB in between.
export function levelOf(peak: number): number {
    if (!(peak > 0)) return 0;
    const db = 20 * Math.log10(peak);
    return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

// A level rises at once and falls exponentially (time constant `release`), over dt seconds.
export function decay(previous: number, target: number, dt: number, release = RELEASE): number {
    if (target >= previous) return target;
    return Math.max(target, previous * Math.exp(-dt / release));
}

export interface Link {
    from: { module: string; port: number };
    to: { module: string; port: number };
}

// The modules Web Audio computes: those from which a chain of connections leads to one of the roots (the speakers,
// the modules with a display), and the roots.
export function computedModules(connections: Link[], roots: string[]): Set<string> {
    const computed = new Set(roots);
    const queue = [...roots];
    while (queue.length > 0) {
        const id = queue.pop()!;
        for (const c of connections) {
            if (c.to.module == id && !computed.has(c.from.module)) {
                computed.add(c.from.module);
                queue.push(c.from.module);
            }
        }
    }
    return computed;
}

export interface PortMetersHost {
    meter: { setMetered(ids: Set<string>): void; meterPeaks(): Map<string, number[]> };
    connections(): Link[];
    modules(): string[];                                    // the modules shown (their ports)
    roots(): string[];                                      // the speakers, the modules with a display
    container(id: string): HTMLElement | undefined;
    running(): boolean;                                     // the audio runs
}

const PREFERENCE = "faustmodular:animate-ports";

export class PortMeters {
    private fLevels = new Map<string, number>();            // "module:output" -> level
    private fShown = new WeakMap<HTMLElement, number>();     // the level written on a port
    private fPorts = new Map<string, HTMLElement[]>();       // the ports of a module, until the patch changes
    private fDirty = true;
    private fLast = 0;
    private fFrame = 0;
    private fEnabled: boolean;

    constructor(private fHost: PortMetersHost) {
        let stored: string | null = null;
        try { stored = localStorage.getItem(PREFERENCE); } catch { /* none */ }
        this.fEnabled = stored != "0";
        if (typeof document != "undefined") document.addEventListener("visibilitychange", () => this.schedule());
        this.schedule();
    }

    get enabled(): boolean {
        return this.fEnabled;
    }

    setEnabled(enabled: boolean): void {
        this.fEnabled = enabled;
        try { localStorage.setItem(PREFERENCE, enabled ? "1" : "0"); } catch { /* not kept */ }
        if (!enabled) this.clear();
        this.fDirty = true;
        this.schedule();
    }

    // The patch changed (connections, modules, ports): the modules metered and the ports are found again.
    changed(): void {
        this.fDirty = true;
        this.fPorts.clear();
        this.schedule();
    }

    private schedule(): void {
        if (this.fFrame || typeof requestAnimationFrame == "undefined") return;
        this.fFrame = requestAnimationFrame((now) => this.tick(now));
    }

    private tick(now: number): void {
        this.fFrame = 0;
        if (!this.fEnabled || document.hidden) {
            this.fHost.meter.setMetered(new Set());
            return;             // started again by setEnabled or visibilitychange
        }
        this.schedule();
        if (now - this.fLast < READ_INTERVAL) return;
        const dt = this.fLast ? Math.min(0.5, (now - this.fLast) / 1000) : READ_INTERVAL / 1000;
        this.fLast = now;
        if (this.fDirty) {
            this.fHost.meter.setMetered(computedModules(this.fHost.connections(), this.fHost.roots()));
            this.fDirty = false;
        }
        const peaks = this.fHost.running() ? this.fHost.meter.meterPeaks() : new Map<string, number[]>();
        const seen = new Set<string>();
        for (const [id, outputs] of peaks) {
            outputs.forEach((peak, i) => {
                const key = `${id}:${i}`;
                seen.add(key);
                this.fLevels.set(key, decay(this.fLevels.get(key) ?? 0, levelOf(peak), dt));
            });
        }
        for (const [key, level] of this.fLevels) {
            if (seen.has(key)) continue;
            const next = decay(level, 0, dt);
            if (next < 0.01) this.fLevels.delete(key); else this.fLevels.set(key, next);
        }
        this.render();
    }

    private render(): void {
        const connections = this.fHost.connections();
        const inputs = new Map<string, number>();          // "module:input" -> the strongest source
        for (const c of connections) {
            const level = this.fLevels.get(`${c.from.module}:${c.from.port}`) ?? 0;
            const key = `${c.to.module}:${c.to.port}`;
            if (level > (inputs.get(key) ?? 0)) inputs.set(key, level);
        }
        const width = window.innerWidth, height = window.innerHeight;
        const writes: Array<[HTMLElement, number]> = [];
        for (const id of this.fHost.modules()) {
            const container = this.fHost.container(id);
            if (!container) continue;
            const box = container.getBoundingClientRect();
            if (box.right < 0 || box.bottom < 0 || box.left > width || box.top > height) continue;
            let ports = this.fPorts.get(id);
            if (!ports) {
                ports = Array.from(container.querySelectorAll<HTMLElement>(".port"));
                this.fPorts.set(id, ports);
            }
            for (const port of ports) {
                const key = `${id}:${port.dataset.port}`;
                const level = port.dataset.dir == "out" ? this.fLevels.get(key) ?? 0 : inputs.get(key) ?? 0;
                const shown = this.fShown.get(port) ?? 0;
                if (Math.abs(level - shown) > STEP || (level == 0 && shown != 0)) writes.push([port, level]);
            }
        }
        // the reads first, then the writes: no layout in between
        for (const [port, level] of writes) {
            this.fShown.set(port, level);
            if (level == 0) port.style.removeProperty("--level"); else port.style.setProperty("--level", level.toFixed(2));
        }
    }

    private clear(): void {
        this.fLevels.clear();
        for (const ports of this.fPorts.values()) {
            for (const port of ports) {
                port.style.removeProperty("--level");
                this.fShown.delete(port);
            }
        }
    }
}
