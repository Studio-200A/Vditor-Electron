export interface RecoveryRuntimeTab {
  recoverySnapshotId: string | null;
  recoveryRevision: number;
  modified: boolean;
  externalFileState: unknown | null;
}

export interface RecoveryRuntimeControllerOptions<TTab extends RecoveryRuntimeTab> {
  readonly createSnapshotId: () => string;
  readonly saveSnapshot: (tab: TTab) => Promise<void>;
  readonly discardSnapshot: (id: string) => Promise<void>;
  readonly onFailure: (operation: 'save' | 'discard') => void;
  readonly delay?: number;
}

/** Owns tab-scoped recovery timers and serializes their recovery-store operations. */
export class RecoveryRuntimeController<TTab extends RecoveryRuntimeTab> {
  private readonly createSnapshotId: () => string;
  private readonly saveSnapshot: (tab: TTab) => Promise<void>;
  private readonly discardSnapshot: (id: string) => Promise<void>;
  private readonly onFailure: (operation: 'save' | 'discard') => void;
  private readonly delay: number;
  private readonly timers = new Map<TTab, number>();
  private readonly operations = new Map<TTab, Promise<void>>();

  constructor(options: RecoveryRuntimeControllerOptions<TTab>) {
    this.createSnapshotId = options.createSnapshotId;
    this.saveSnapshot = options.saveSnapshot;
    this.discardSnapshot = options.discardSnapshot;
    this.onFailure = options.onFailure;
    this.delay = options.delay ?? 500;
  }

  schedule(tab: TTab): void {
    this.cancelTimer(tab);
    if (!tab.modified && !tab.externalFileState) {
      void this.discard(tab);
      return;
    }
    if (!tab.modified) return;

    const id = this.ensureSnapshotId(tab);
    const revision = ++tab.recoveryRevision;
    const timer = window.setTimeout(() => {
      if (this.timers.get(tab) !== timer) return;
      this.timers.delete(tab);
      void this.queue(tab, 'save', async () => {
        if (tab.recoverySnapshotId !== id || tab.recoveryRevision !== revision || !tab.modified)
          return;
        await this.saveSnapshot(tab);
      });
    }, this.delay);
    this.timers.set(tab, timer);
  }

  async discard(tab: TTab): Promise<void> {
    this.cancelTimer(tab);
    const id = tab.recoverySnapshotId;
    tab.recoverySnapshotId = null;
    tab.recoveryRevision++;
    if (!id) return;
    await this.queue(tab, 'discard', () => this.discardSnapshot(id));
  }

  async preserveUnavailable(tab: TTab): Promise<void> {
    this.cancelTimer(tab);
    const id = this.ensureSnapshotId(tab);
    const revision = ++tab.recoveryRevision;
    await this.queue(tab, 'save', async () => {
      if (tab.recoverySnapshotId !== id || tab.recoveryRevision !== revision) return;
      await this.saveSnapshot(tab);
    });
  }

  private ensureSnapshotId(tab: TTab): string {
    const id = tab.recoverySnapshotId || this.createSnapshotId();
    tab.recoverySnapshotId = id;
    return id;
  }

  private cancelTimer(tab: TTab): void {
    const timer = this.timers.get(tab);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.timers.delete(tab);
  }

  private queue(
    tab: TTab,
    operation: 'save' | 'discard',
    task: () => Promise<void>,
  ): Promise<void> {
    const previous = this.operations.get(tab) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(task);
    const settled = queued.catch(() => this.onFailure(operation));
    this.operations.set(tab, settled);
    void settled.finally(() => {
      if (this.operations.get(tab) === settled) this.operations.delete(tab);
    });
    return settled;
  }
}
