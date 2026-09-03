export interface RecoverySnapshotSource {
  readonly recoverySnapshotId: string;
  readonly filePath: string | null;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly expectedSavedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'LF' | 'CRLF';
  readonly mode: 'wysiwyg' | 'ir' | 'sv';
}

export interface RecoveryStoreSnapshot {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly filePath: string | null;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly expectedSavedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'LF' | 'CRLF';
  readonly mode: 'wysiwyg' | 'ir' | 'sv';
  readonly updatedAt: number;
}

export interface RestoredRecoveryStoreSnapshot extends RecoveryStoreSnapshot {
  readonly diskState: 'unchanged' | 'changed' | 'unavailable';
}

/** Explicit recovery IPC projection; runtime handles never cross this boundary. */
export function toRecoveryStoreSnapshot(
  source: RecoverySnapshotSource,
  updatedAt = Date.now(),
): RecoveryStoreSnapshot {
  return {
    schemaVersion: 2,
    id: source.recoverySnapshotId,
    filePath: source.filePath,
    title: source.title,
    content: source.content,
    savedContent: source.savedContent,
    expectedSavedContent: source.expectedSavedContent,
    encoding: source.encoding,
    lineEnding: source.lineEnding,
    mode: source.mode,
    updatedAt,
  };
}

/** Narrows the recovery IPC payload before it becomes renderer document state. */
export function fromRecoveryStoreSnapshot(value: unknown): RestoredRecoveryStoreSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.schemaVersion !== 2 ||
    typeof snapshot.id !== 'string' ||
    (snapshot.filePath !== null && typeof snapshot.filePath !== 'string') ||
    typeof snapshot.title !== 'string' ||
    typeof snapshot.content !== 'string' ||
    typeof snapshot.savedContent !== 'string' ||
    typeof snapshot.expectedSavedContent !== 'string' ||
    typeof snapshot.encoding !== 'string' ||
    (snapshot.lineEnding !== 'LF' && snapshot.lineEnding !== 'CRLF') ||
    (snapshot.mode !== 'wysiwyg' && snapshot.mode !== 'ir' && snapshot.mode !== 'sv') ||
    typeof snapshot.updatedAt !== 'number' ||
    !Number.isFinite(snapshot.updatedAt) ||
    (snapshot.diskState !== 'unchanged' &&
      snapshot.diskState !== 'changed' &&
      snapshot.diskState !== 'unavailable')
  )
    return null;

  return {
    schemaVersion: 2,
    id: snapshot.id,
    filePath: snapshot.filePath,
    title: snapshot.title,
    content: snapshot.content,
    savedContent: snapshot.savedContent,
    expectedSavedContent: snapshot.expectedSavedContent,
    encoding: snapshot.encoding,
    lineEnding: snapshot.lineEnding,
    mode: snapshot.mode,
    updatedAt: snapshot.updatedAt,
    diskState: snapshot.diskState,
  } as RestoredRecoveryStoreSnapshot;
}
