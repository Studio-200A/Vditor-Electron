import type { DocumentState, RecoveryState } from './types.js';

export const SESSION_SNAPSHOT_VERSION = 1;
export const RECOVERY_SNAPSHOT_VERSION = 1;

export interface SessionDocumentSnapshot {
  readonly version: number;
  readonly id: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'CRLF' | 'LF';
  readonly baseDir: string;
  readonly modified: boolean;
  readonly expectedSavedContent: string;
  readonly mode: string;
  readonly recoverySnapshotId: string | null;
}

export interface RecoveryDocumentSnapshot {
  readonly version: number;
  readonly id: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly title: string;
  readonly content: string;
  readonly savedContent: string;
  readonly encoding: string;
  readonly lineEnding: 'CRLF' | 'LF';
  readonly baseDir: string;
  readonly mode: string;
  readonly recoverySnapshotId: string;
  readonly recoveryState: {
    readonly snapshotId: string;
    readonly content: string;
    readonly mode: string;
  } | null;
}

export function toSessionSnapshot(document: DocumentState): SessionDocumentSnapshot {
  return {
    version: SESSION_SNAPSHOT_VERSION,
    id: document.id,
    filePath: document.filePath,
    fileIdentity: document.fileIdentity,
    title: document.title,
    content: document.content,
    savedContent: document.savedContent,
    encoding: document.encoding,
    lineEnding: document.lineEnding,
    baseDir: document.baseDir,
    modified: document.modified,
    expectedSavedContent: document.expectedSavedContent,
    mode: document.mode,
    recoverySnapshotId: document.recoverySnapshotId,
  };
}

export function toRecoverySnapshot(document: DocumentState): RecoveryDocumentSnapshot | null {
  if (!document.recoveryState) return null;

  return {
    version: RECOVERY_SNAPSHOT_VERSION,
    id: document.id,
    filePath: document.filePath,
    fileIdentity: document.fileIdentity,
    title: document.title,
    content: document.content,
    savedContent: document.savedContent,
    encoding: document.encoding,
    lineEnding: document.lineEnding,
    baseDir: document.baseDir,
    mode: document.mode,
    recoverySnapshotId: document.recoverySnapshotId!,
    recoveryState: document.recoveryState,
  };
}

export function restoreDocumentState(snapshot: unknown): Omit<DocumentState, 'runtime'> | null {
  if (!isSessionDocumentSnapshot(snapshot)) return null;

  return {
    id: snapshot.id,
    filePath: snapshot.filePath,
    fileIdentity: snapshot.fileIdentity,
    title: snapshot.title,
    content: snapshot.content,
    savedContent: snapshot.savedContent,
    encoding: snapshot.encoding,
    lineEnding: snapshot.lineEnding,
    baseDir: snapshot.baseDir,
    modified: snapshot.modified,
    expectedSavedContent: snapshot.expectedSavedContent,
    contentRevision: 0,
    mode: snapshot.mode as DocumentState['mode'],
    externalConflict: null,
    externalChangeIgnored: false,
    externalFileState: null,
    recoverySnapshotId: snapshot.recoverySnapshotId,
    recoveryState: null,
    recoveryRevision: 0,
  };
}

export function restoreRecoveryState(snapshot: unknown): RecoveryState | null {
  if (!isRecoveryDocumentSnapshot(snapshot) || !snapshot.recoveryState) return null;
  return {
    snapshotId: snapshot.recoveryState.snapshotId,
    content: snapshot.recoveryState.content,
    mode: snapshot.recoveryState.mode as DocumentState['mode'],
  };
}

function isSessionDocumentSnapshot(value: unknown): value is SessionDocumentSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.version === SESSION_SNAPSHOT_VERSION &&
    typeof snapshot.id === 'string' &&
    (snapshot.filePath === null || typeof snapshot.filePath === 'string') &&
    (snapshot.fileIdentity === null || typeof snapshot.fileIdentity === 'string') &&
    typeof snapshot.title === 'string' &&
    typeof snapshot.content === 'string' &&
    typeof snapshot.savedContent === 'string' &&
    typeof snapshot.encoding === 'string' &&
    (snapshot.lineEnding === 'CRLF' || snapshot.lineEnding === 'LF') &&
    typeof snapshot.baseDir === 'string' &&
    typeof snapshot.modified === 'boolean' &&
    typeof snapshot.expectedSavedContent === 'string' &&
    typeof snapshot.mode === 'string' &&
    (snapshot.recoverySnapshotId === null || typeof snapshot.recoverySnapshotId === 'string')
  );
}

function isRecoveryDocumentSnapshot(value: unknown): value is RecoveryDocumentSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.version === RECOVERY_SNAPSHOT_VERSION &&
    typeof snapshot.id === 'string' &&
    (snapshot.filePath === null || typeof snapshot.filePath === 'string') &&
    (snapshot.fileIdentity === null || typeof snapshot.fileIdentity === 'string') &&
    typeof snapshot.title === 'string' &&
    typeof snapshot.content === 'string' &&
    typeof snapshot.savedContent === 'string' &&
    typeof snapshot.encoding === 'string' &&
    (snapshot.lineEnding === 'CRLF' || snapshot.lineEnding === 'LF') &&
    typeof snapshot.baseDir === 'string' &&
    typeof snapshot.mode === 'string' &&
    typeof snapshot.recoverySnapshotId === 'string' &&
    (snapshot.recoveryState === null ||
      (typeof snapshot.recoveryState === 'object' &&
        snapshot.recoveryState !== null &&
        typeof (snapshot.recoveryState as Record<string, unknown>).snapshotId === 'string' &&
        typeof (snapshot.recoveryState as Record<string, unknown>).content === 'string' &&
        typeof (snapshot.recoveryState as Record<string, unknown>).mode === 'string'))
  );
}
