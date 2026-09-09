import type { FileChangedEvent, FileAPI } from '../types/bridges.js';
import type { AppStore } from '../state/store.js';

export interface WorkspaceSettings {
  readonly workspaceReadDepth: number;
  readonly recentPaths?: readonly string[];
  readonly defaultOpenPath?: string;
}

export interface WorkspaceControllerOptions {
  readonly store: AppStore;
  readonly fileAPI: Pick<FileAPI, 'setWorkspaceWatch'>;
  readonly getSettings: () => WorkspaceSettings;
  readonly saveSettings: (updates: Record<string, unknown>) => Promise<void>;
  readonly renderWorkspace: (workspacePath: string) => void;
  readonly syncLocalResourceRoots: () => Promise<void>;
  readonly requestTreeRefresh: (revision: number) => Promise<void>;
  readonly persistSession: () => void;
  readonly onWorkspacePathUnavailable: (event: FileChangedEvent) => Promise<void>;
  readonly isWorkspaceAvailable: (workspacePath: string) => Promise<boolean>;
  readonly onWorkspaceWatchError: () => void;
}

/** Owns workspace-root state, workspace watcher events, and tree refresh requests. */
export class WorkspaceController {
  private readonly store: AppStore;
  private readonly fileAPI: WorkspaceControllerOptions['fileAPI'];
  private readonly getSettings: WorkspaceControllerOptions['getSettings'];
  private readonly saveSettings: WorkspaceControllerOptions['saveSettings'];
  private readonly renderWorkspace: WorkspaceControllerOptions['renderWorkspace'];
  private readonly syncLocalResourceRoots: WorkspaceControllerOptions['syncLocalResourceRoots'];
  private readonly requestTreeRefresh: WorkspaceControllerOptions['requestTreeRefresh'];
  private readonly persistSession: WorkspaceControllerOptions['persistSession'];
  private readonly onWorkspacePathUnavailable: WorkspaceControllerOptions['onWorkspacePathUnavailable'];
  private readonly isWorkspaceAvailable: WorkspaceControllerOptions['isWorkspaceAvailable'];
  private readonly onWorkspaceWatchError: WorkspaceControllerOptions['onWorkspaceWatchError'];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WorkspaceControllerOptions) {
    this.store = options.store;
    this.fileAPI = options.fileAPI;
    this.getSettings = options.getSettings;
    this.saveSettings = options.saveSettings;
    this.renderWorkspace = options.renderWorkspace;
    this.syncLocalResourceRoots = options.syncLocalResourceRoots;
    this.requestTreeRefresh = options.requestTreeRefresh;
    this.persistSession = options.persistSession;
    this.onWorkspacePathUnavailable = options.onWorkspacePathUnavailable;
    this.isWorkspaceAvailable = options.isWorkspaceAvailable;
    this.onWorkspaceWatchError = options.onWorkspaceWatchError;
  }

  async setWorkspace(workspacePath: string | null): Promise<void> {
    const path = workspacePath ?? '';
    this.store.updateWorkspacePath(path);
    const revision = this.store.getState().workspaceRevision;
    this.renderWorkspace(path);
    await this.syncLocalResourceRoots();
    await this.fileAPI.setWorkspaceWatch(path || undefined, this.getSettings().workspaceReadDepth);
    if (!this.isCurrent(path, revision)) return;
    await this.requestTreeRefresh(revision);
    if (!this.isCurrent(path, revision)) return;

    const settings = this.getSettings();
    if (path) {
      const recentPaths = [
        path,
        ...(settings.recentPaths ?? []).filter((item) => item !== path),
      ].slice(0, 10);
      await this.saveSettings({ recentPaths, defaultOpenPath: path });
    } else {
      await this.saveSettings({ defaultOpenPath: '' });
    }
    this.persistSession();
  }

  async refreshTree(): Promise<void> {
    await this.requestTreeRefresh(this.store.getState().workspaceRevision);
  }

  async handleWatcherEvent(event: FileChangedEvent): Promise<boolean> {
    if (event.scope !== 'workspace') return false;
    if (event.event === 'watch-error') {
      this.onWorkspaceWatchError();
      return true;
    }
    const workspacePath = this.store.getState().workspacePath;
    if (
      (event.event === 'unlink' || event.event === 'unlinkDir') &&
      workspacePath &&
      event.path === workspacePath
    ) {
      await this.onWorkspacePathUnavailable(event);
      if (event.path === workspacePath && !(await this.isWorkspaceAvailable(workspacePath))) {
        await this.setWorkspace('');
        return true;
      }
    }
    this.scheduleRefresh();
    return true;
  }

  dispose(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private isCurrent(path: string, revision: number): boolean {
    const state = this.store.getState();
    return state.workspacePath === path && state.workspaceRevision === revision;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshTree();
    }, 300);
  }
}
