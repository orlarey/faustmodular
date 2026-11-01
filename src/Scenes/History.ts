/*				HISTORY.TS
    Undo and redo of every change of the scene: modules added, removed, moved or recompiled,
    connections, modulations, parameter values (modulation depths included).

    The history is a list of states of the scene (SceneSnapshot, compared as JSON strings). A state is
    recorded once the scene has been quiet for DELAY ms after a change (touch): a slider dragged or a
    group of modules moved makes a single step. Undo and redo bring the scene to the previous or next
    state; the host computes what differs and applies only that (Scene.restoreSnapshot), so a change
    of one parameter does not recompile anything.

    Changes made while a state is being restored are not recorded. After a restore, the recorded state
    is replaced by the state the scene actually reached (a code that no longer compiles, for instance),
    so that a late event does not record a spurious step and clear the redo list.
*/

export interface HistoryHost {
    capture(): Promise<string>;                 // the scene as it stands, once pending work is done
    restore(state: string): Promise<void>;      // brings the scene to this state
    changed?(): void;                           // undo/redo availability changed
}

export class History {
    static DELAY = 400;
    static LIMIT = 200;

    private fStates: string[] = [];
    private fIndex = -1;
    private fTimer: ReturnType<typeof setTimeout> | null = null;
    private fQueue: Promise<void> = Promise.resolve();
    private fRestoring = false;

    constructor(private fHost: HistoryHost) { }

    get restoring(): boolean {
        return this.fRestoring;
    }

    canUndo(): boolean {
        return this.fIndex > 0 || (this.fTimer != null && this.fIndex >= 0);
    }

    canRedo(): boolean {
        return this.fTimer == null && this.fIndex < this.fStates.length - 1;
    }

    // A new document (scene opened, application started): the current state is the only one.
    reset(): Promise<void> {
        this.cancelTimer();
        return this.enqueue(async () => {
            this.fStates = [await this.fHost.capture()];
            this.fIndex = 0;
        });
    }

    // Something changed: recorded once the scene is quiet.
    touch(): void {
        if (this.fRestoring || this.fIndex < 0) return;
        this.cancelTimer();
        this.fTimer = setTimeout(() => {
            this.fTimer = null;
            this.enqueue(() => this.record());
        }, History.DELAY);
        this.fHost.changed?.();
    }

    // Records the pending change now (before an undo, a test...).
    flush(): Promise<void> {
        if (this.fTimer != null) {
            this.cancelTimer();
            return this.enqueue(() => this.record());
        }
        return this.fQueue;
    }

    async undo(): Promise<void> {
        await this.flush();
        await this.enqueue(async () => {
            if (this.fIndex <= 0) return;
            this.fIndex--;
            await this.restore();
        });
    }

    async redo(): Promise<void> {
        await this.flush();
        await this.enqueue(async () => {
            if (this.fIndex >= this.fStates.length - 1) return;
            this.fIndex++;
            await this.restore();
        });
    }

    private async record(): Promise<void> {
        if (this.fIndex < 0) return;
        const state = await this.fHost.capture();
        if (state == this.fStates[this.fIndex]) return;
        this.fStates.splice(this.fIndex + 1);           // a new change clears the redo list
        this.fStates.push(state);
        if (this.fStates.length > History.LIMIT) this.fStates.shift();
        this.fIndex = this.fStates.length - 1;
    }

    private async restore(): Promise<void> {
        this.fRestoring = true;
        try {
            await this.fHost.restore(this.fStates[this.fIndex]);
            this.fStates[this.fIndex] = await this.fHost.capture();
        } finally {
            this.fRestoring = false;
        }
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.fQueue.then(task, task);
        this.fQueue = run.catch((e) => console.error("history:", e)).then(() => this.fHost.changed?.());
        return this.fQueue;
    }

    private cancelTimer(): void {
        if (this.fTimer != null) clearTimeout(this.fTimer);
        this.fTimer = null;
    }
}
