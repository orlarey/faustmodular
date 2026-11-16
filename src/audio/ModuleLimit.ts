/*				MODULELIMIT.TS
    How many Faust modules a tab can run, and what is said when the audio of a module could not start.

    Each module runs its Faust code in an AudioWorklet processor of its own (faustwasm), with a WebAssembly
    memory of its own. Chrome reserves about 8 GB of address space for each memory (guard regions: a few kB
    are used) and at most about 1 TB for a tab: about 125 memories, measured on Linux and macOS (Chrome 153;
    `new WebAssembly.Memory({ initial: 1 })` in a loop fails the 126th time: "could not allocate memory").
    The limit is the same in the page and in the AudioWorklet, which share it; it does not depend on the power
    of the machine. Past it, the processor of a new module fails (processorerror) and the module is silent.
    The budget is given back when modules are removed (their memories are collected).

    So: the modules whose audio fails are shown (ModuleClass.audioFailed) and reported in one message
    (FailureBatch); near the limit, a warning (crossesWarning); a module removed lets a silent one start again
    (Scene.retryFailed).
*/

export const MODULE_LIMIT = 120;    // Faust modules a tab can run, about (a few memories are used elsewhere)
export const WARN_FROM = 110;       // the warning, from this number of modules
export const LIMIT_LIKELY = 100;    // from this number, a failure is most likely the limit

// True when the number of modules enters the warning band (from under WARN_FROM to WARN_FROM or more).
export function crossesWarning(before: number, after: number): boolean {
    return before < WARN_FROM && after >= WARN_FROM;
}

// The modules whose audio failed within a moment, reported once (a scene of 140 modules: 20 failures together).
export class FailureBatch {
    private fNames: string[] = [];
    private fTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private fReport: (names: string[]) => void, private fDelay = 300) {}

    add(name: string): void {
        this.fNames.push(name);
        if (this.fTimer === null) this.fTimer = setTimeout(() => this.flush(), this.fDelay);
    }

    flush(): void {
        if (this.fTimer !== null) clearTimeout(this.fTimer);
        this.fTimer = null;
        const names = this.fNames;
        this.fNames = [];
        if (names.length > 0) this.fReport(names);
    }
}

// The names of a report, each once with its number ("Osc ×7"): the first ones, then how many others
// ("VCO, VCF ×2, ADSR, LFO and 12 others").
export function listNames(names: string[], others: (count: number) => string, max = 4): string {
    const counts = new Map<string, number>();
    names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
    const items = Array.from(counts, ([name, n]) => (n > 1 ? `${name} ×${n}` : name));
    if (items.length <= max) return items.join(", ");
    return items.slice(0, max).join(", ") + others(items.length - max);
}
