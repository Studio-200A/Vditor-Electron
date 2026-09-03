import { SESSION_SNAPSHOT_VERSION, type SessionSnapshot } from '../../shared/contracts/session.js';

export interface PersistedSessionSource {
  readonly restoreWorkspace: boolean;
  readonly restoreTabs: boolean;
  readonly workspacePath: string;
  readonly activeFilePath: string | null;
  readonly openFiles: readonly (string | null)[];
  readonly unavailableFilePaths: ReadonlySet<string>;
}

export type PersistedSessionSnapshot = SessionSnapshot;

/** Projects renderer state onto the deliberately small settings-session contract. */
export function toPersistedSessionSnapshot(
  source: PersistedSessionSource,
): PersistedSessionSnapshot {
  const openFiles = source.restoreTabs
    ? source.openFiles.filter(
        (filePath): filePath is string =>
          typeof filePath === 'string' && !source.unavailableFilePaths.has(filePath),
      )
    : [];
  const activeFilePath =
    source.restoreTabs &&
    source.activeFilePath &&
    !source.unavailableFilePaths.has(source.activeFilePath)
      ? source.activeFilePath
      : null;
  return {
    schemaVersion: SESSION_SNAPSHOT_VERSION,
    workspacePath: source.restoreWorkspace ? source.workspacePath : '',
    activeFilePath,
    openFiles,
  };
}

/** Narrows persisted settings before using them to reopen local files. */
export function fromPersistedSessionSnapshot(value: unknown): PersistedSessionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const session = value as Record<string, unknown>;
  if (
    (session.schemaVersion !== undefined && session.schemaVersion !== SESSION_SNAPSHOT_VERSION) ||
    typeof session.workspacePath !== 'string' ||
    (session.activeFilePath !== null && typeof session.activeFilePath !== 'string') ||
    !Array.isArray(session.openFiles) ||
    !session.openFiles.every((filePath) => typeof filePath === 'string')
  )
    return null;
  return {
    schemaVersion: SESSION_SNAPSHOT_VERSION,
    workspacePath: session.workspacePath,
    activeFilePath: session.activeFilePath,
    openFiles: [...session.openFiles],
  };
}

export { SESSION_SNAPSHOT_VERSION as PERSISTED_SESSION_SNAPSHOT_VERSION };
