import {
  fromPersistedSessionSnapshot,
  toPersistedSessionSnapshot,
  type PersistedSessionSnapshot,
} from '../documents/session-snapshot.js';

export interface SessionRestoreSettings {
  readonly restoreWorkspace: boolean;
  readonly restoreTabs: boolean;
  readonly session: unknown;
}

export interface SessionRestoreDocument {
  readonly filePath: string | null;
  readonly externalFileState: unknown | null;
}

export interface SessionRestoreControllerOptions {
  readonly getSettings: () => SessionRestoreSettings | null;
  readonly getWorkspacePath: () => string;
  readonly getActiveFilePath: () => string | null;
  readonly getDocuments: () => readonly SessionRestoreDocument[];
  readonly persistSnapshot: (snapshot: PersistedSessionSnapshot) => Promise<void>;
  readonly reportPersistenceFailure: (error: unknown) => void;
  readonly workspaceExists: (workspacePath: string) => Promise<boolean>;
  readonly setWorkspace: (workspacePath: string) => Promise<void>;
  readonly openPaths: (paths: string[]) => Promise<void>;
  readonly activateFile: (filePath: string) => void;
  readonly createEmptyPreview: () => void;
  readonly updateActiveUI: () => void;
  readonly syncTopControlsWidth: () => void;
}

/** Coordinates session DTO persistence and startup restoration without retaining document runtimes. */
export class SessionRestoreController {
  private sessionToRestore: PersistedSessionSnapshot | null = null;

  constructor(private readonly options: SessionRestoreControllerOptions) {}

  async persist(throwOnFailure = false): Promise<boolean> {
    const settings = this.options.getSettings();
    if (!settings) return false;
    const unavailableFilePaths = new Set(
      this.options
        .getDocuments()
        .flatMap((document) =>
          document.externalFileState && document.filePath ? [document.filePath] : [],
        ),
    );
    const snapshot = toPersistedSessionSnapshot({
      restoreWorkspace: settings.restoreWorkspace,
      restoreTabs: settings.restoreTabs,
      workspacePath: this.options.getWorkspacePath(),
      activeFilePath: this.options.getActiveFilePath(),
      openFiles: this.options.getDocuments().map((document) => document.filePath),
      unavailableFilePaths,
    });
    try {
      await this.options.persistSnapshot(snapshot);
      return true;
    } catch (error) {
      if (throwOnFailure) throw error;
      this.options.reportPersistenceFailure(error);
      return false;
    }
  }

  async restoreWorkspace(): Promise<void> {
    const settings = this.options.getSettings();
    this.sessionToRestore = settings ? fromPersistedSessionSnapshot(settings.session) : null;
    const session = this.sessionToRestore;
    if (!settings?.restoreWorkspace || !session?.workspacePath) return;
    await this.options.setWorkspace(
      (await this.options.workspaceExists(session.workspacePath)) ? session.workspacePath : '',
    );
  }

  async restoreDocuments(): Promise<void> {
    const settings = this.options.getSettings();
    const session = this.sessionToRestore;
    try {
      if (!settings?.restoreTabs || !session?.openFiles.length) return;
      await this.options.openPaths(session.openFiles);
      if (session.activeFilePath) this.options.activateFile(session.activeFilePath);
    } finally {
      // The DTO is only valid for this startup transaction and must not affect later opens.
      this.sessionToRestore = null;
    }
  }

  async finishRestoration(): Promise<void> {
    if (!this.options.getDocuments().length) {
      this.options.createEmptyPreview();
      this.options.updateActiveUI();
    }
    this.options.syncTopControlsWidth();
    await this.persist();
  }
}
