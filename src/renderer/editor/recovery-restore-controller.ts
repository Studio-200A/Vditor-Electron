import type { RestoredRecoveryStoreSnapshot } from '../documents/recovery-snapshot.js';

export interface RecoveryRestoreDocumentInput {
  readonly filePath?: string | null;
  readonly fileIdentity?: string | null;
  readonly title?: string;
  readonly content: string;
  readonly savedContent: string;
  readonly expectedSavedContent?: string;
  readonly encoding: string;
  readonly baseDir: string;
  readonly mode: RestoredRecoveryStoreSnapshot['mode'];
  readonly recoverySnapshotId: string;
  readonly recoveryState: RestoredRecoveryStoreSnapshot['diskState'];
}

export interface RecoveryRestoreControllerOptions<TTab> {
  readonly getCandidates: () => Promise<ReadonlyArray<{ readonly id: string }>>;
  readonly restore: (id: string) => Promise<unknown>;
  readonly parse: (value: unknown) => RestoredRecoveryStoreSnapshot | null;
  readonly dirname: (filePath: string) => Promise<string>;
  readonly fileIdentity: (filePath: string) => Promise<string | null>;
  readonly syncResourceRoots: (roots: readonly string[]) => Promise<void>;
  readonly findDocumentByIdentity: (identity: string) => TTab | null;
  readonly mergeUnchanged: (document: TTab, snapshot: RestoredRecoveryStoreSnapshot) => void;
  readonly applyMergedContent: (document: TTab, content: string) => void;
  readonly createDocument: (input: RecoveryRestoreDocumentInput) => TTab | null;
  readonly watchDocument: (document: TTab) => Promise<void>;
  readonly conflictTitle: (title: string) => string;
}

/** Restores versioned recovery data without exposing recovery payloads to application composition. */
export class RecoveryRestoreController<TTab> {
  constructor(private readonly options: RecoveryRestoreControllerOptions<TTab>) {}

  async restoreAll(): Promise<void> {
    let candidates: ReadonlyArray<{ readonly id: string }>;
    try {
      candidates = await this.options.getCandidates();
    } catch {
      return;
    }
    for (const candidate of candidates) {
      await this.restoreCandidate(candidate.id);
    }
  }

  private async restoreCandidate(id: string): Promise<void> {
    let snapshot: RestoredRecoveryStoreSnapshot | null;
    try {
      snapshot = this.options.parse(await this.options.restore(id));
    } catch {
      return;
    }
    if (!snapshot) return;
    const baseDir = snapshot.filePath ? await this.options.dirname(snapshot.filePath) : '';
    if (snapshot.diskState !== 'unchanged') {
      await this.options.syncResourceRoots(baseDir ? [baseDir] : []);
      const document = this.options.createDocument({
        title: this.options.conflictTitle(snapshot.title),
        content: snapshot.content,
        savedContent: '',
        encoding: snapshot.encoding,
        baseDir,
        mode: snapshot.mode,
        recoverySnapshotId: snapshot.id,
        recoveryState: snapshot.diskState,
      });
      if (document) await this.options.watchDocument(document);
      return;
    }

    const identity = snapshot.filePath ? await this.options.fileIdentity(snapshot.filePath) : null;
    const existing = identity ? this.options.findDocumentByIdentity(identity) : null;
    if (existing) {
      this.options.mergeUnchanged(existing, snapshot);
      this.options.applyMergedContent(existing, snapshot.content);
      return;
    }
    await this.options.syncResourceRoots(baseDir ? [baseDir] : []);
    const document = this.options.createDocument({
      filePath: snapshot.filePath,
      fileIdentity: identity,
      content: snapshot.content,
      savedContent: snapshot.savedContent,
      expectedSavedContent: snapshot.expectedSavedContent,
      encoding: snapshot.encoding,
      baseDir,
      mode: snapshot.mode,
      recoverySnapshotId: snapshot.id,
      recoveryState: 'unchanged',
    });
    if (document) await this.options.watchDocument(document);
  }
}
