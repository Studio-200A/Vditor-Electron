export const SESSION_SNAPSHOT_VERSION = 1 as const;

/** Versioned, serializable session boundary shared by renderer-facing settings code. */
export interface SessionSnapshot {
  readonly schemaVersion: typeof SESSION_SNAPSHOT_VERSION;
  readonly workspacePath: string;
  readonly activeFilePath: string | null;
  readonly openFiles: string[];
}
