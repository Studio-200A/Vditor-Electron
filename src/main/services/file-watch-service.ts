import * as path from 'node:path';
import * as fs from 'node:fs';
import { watch, ChokidarOptions, FSWatcher } from 'chokidar';

export type FileChangeEvent = {
  event: 'add' | 'change' | 'unlink' | 'unreadable';
  path: string;
  scope: 'workspace' | 'document';
  content?: string;
  encoding?: string;
  error?: 'permission-denied' | 'read-failed';
};

type WatcherFactory = (paths: string | string[], options: ChokidarOptions) => FSWatcher;

type DocumentReader = (filePath: string) => Promise<{ content: string; encoding: string }>;

type DocumentBinding = {
  identity: string;
  path: string;
  generation: number;
  timer: NodeJS.Timeout | null;
  watcher: FSWatcher;
  renameTimer: NodeJS.Timeout | null;
};

export const WATCHER_STABILITY_THRESHOLD = 1000;
export const WATCHER_STABILITY_POLL_INTERVAL = 150;
const LINUX_RENAME_REBIND_DELAY = 150;

export class FileWatchService {
  private workspacePath = '';
  private workspaceWatcher: FSWatcher | null = null;
  private readonly documents = new Map<string, DocumentBinding>();
  private readonly ownDocumentWrites = new Map<string, number>();

  constructor(
    private readonly readDocument: DocumentReader,
    private readonly send: (event: FileChangeEvent) => void,
    private readonly createWatcher: WatcherFactory = watch,
  ) {}

  async setWorkspace(workspacePath?: string): Promise<void> {
    const nextWorkspace = workspacePath ? this.normalizePath(workspacePath) : '';
    if (nextWorkspace === this.workspacePath) return;

    const previousWatcher = this.workspaceWatcher;
    this.workspaceWatcher = null;
    await previousWatcher?.close();
    this.workspacePath = nextWorkspace;

    if (nextWorkspace) {
      const watcher = this.createWatcher(nextWorkspace, { ignoreInitial: true, depth: 20 });
      this.workspaceWatcher = watcher;
      watcher.on('all', (eventName, changedPath) => {
        if (!this.isCurrentWorkspaceWatcher(watcher)) return;
        this.handleWorkspaceEvent(eventName, changedPath);
      });
    }
  }

  async watchDocument(filePath: string): Promise<void> {
    const identity = this.normalizePath(filePath);
    if (this.documents.has(identity)) return;
    const watcher = this.createWatcher(identity, {
      ignoreInitial: true,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: WATCHER_STABILITY_THRESHOLD,
        pollInterval: WATCHER_STABILITY_POLL_INTERVAL,
      },
    });
    const binding: DocumentBinding = {
      identity,
      path: path.resolve(filePath),
      generation: 0,
      timer: null,
      watcher,
      renameTimer: null,
    };
    this.documents.set(identity, binding);
    watcher.on('all', (eventName, changedPath) => {
      if (!this.isCurrentBinding(binding, binding.generation)) return;
      const event = this.toChangeEvent(eventName);
      if (!event || this.normalizePath(changedPath) !== binding.identity) return;
      this.scheduleDocumentRead(
        binding,
        event === 'unlink' ? WATCHER_STABILITY_THRESHOLD : 0,
        event,
      );
    });
    watcher.on('raw', (eventName) => {
      if (process.platform !== 'linux' || eventName !== 'rename') return;
      this.scheduleLinuxRenameRebind(binding);
    });
  }

  markOwnDocumentWrite(filePath: string): void {
    this.ownDocumentWrites.set(this.normalizePath(filePath), Date.now() + 1500);
  }

  async unwatchDocument(filePath: string): Promise<void> {
    const binding = this.documents.get(this.normalizePath(filePath));
    if (!binding) return;
    this.documents.delete(binding.identity);
    binding.generation++;
    if (binding.timer) clearTimeout(binding.timer);
    binding.timer = null;
    if (binding.renameTimer) clearTimeout(binding.renameTimer);
    binding.renameTimer = null;
    await binding.watcher.close();
  }

  async dispose(): Promise<void> {
    const workspaceWatcher = this.workspaceWatcher;
    this.workspaceWatcher = null;
    this.workspacePath = '';
    await workspaceWatcher?.close();
    for (const binding of this.documents.values()) {
      binding.generation++;
      if (binding.timer) clearTimeout(binding.timer);
      if (binding.renameTimer) clearTimeout(binding.renameTimer);
    }
    const documentWatchers = [...this.documents.values()].map(({ watcher }) => watcher.close());
    this.documents.clear();
    await Promise.all(documentWatchers);
  }

  private scheduleLinuxRenameRebind(binding: DocumentBinding): void {
    if (!this.isCurrentBinding(binding, binding.generation)) return;
    if (binding.renameTimer) clearTimeout(binding.renameTimer);
    const generation = binding.generation;
    binding.renameTimer = setTimeout(() => {
      binding.renameTimer = null;
      if (!this.isCurrentBinding(binding, generation)) return;
      binding.watcher.unwatch(binding.identity);
      binding.watcher.add(binding.identity);
      this.scheduleDocumentRead(binding, WATCHER_STABILITY_THRESHOLD, 'change');
    }, LINUX_RENAME_REBIND_DELAY);
  }

  private handleWorkspaceEvent(eventName: string, changedPath: string): void {
    const event = this.toChangeEvent(eventName);
    if (!event) return;
    const identity = this.normalizePath(changedPath);
    const binding = this.documents.get(identity);
    if (binding) return;
    if (event === 'change' || path.basename(changedPath).startsWith('.')) return;
    if (!this.isOwnDocumentWriteEvent(identity))
      this.send({ event, path: path.resolve(changedPath), scope: 'workspace' });
  }

  private scheduleDocumentRead(
    binding: DocumentBinding,
    delay: number,
    event: FileChangeEvent['event'] = 'change',
  ): void {
    const generation = binding.generation;
    if (binding.timer) clearTimeout(binding.timer);
    binding.timer = setTimeout(() => {
      binding.timer = null;
      void this.readStableDocument(binding, generation, 0, event);
    }, delay);
  }

  private async readStableDocument(
    binding: DocumentBinding,
    generation: number,
    attempt: number,
    event: FileChangeEvent['event'],
  ): Promise<void> {
    if (!this.isCurrentBinding(binding, generation)) return;
    try {
      const result = await this.readDocument(binding.identity);
      if (!this.isCurrentBinding(binding, generation)) return;
      this.send({
        event: event === 'add' ? 'add' : 'change',
        path: binding.path,
        scope: 'document',
        ...result,
      });
      if (event === 'add' && this.isInWorkspace(binding.identity))
        this.send({ event: 'add', path: binding.path, scope: 'workspace' });
    } catch (error) {
      if (!this.isCurrentBinding(binding, generation)) return;
      if (!this.isMissingFileError(error)) {
        this.send({
          event: 'unreadable',
          path: binding.path,
          scope: 'document',
          error: this.isPermissionError(error) ? 'permission-denied' : 'read-failed',
        });
        return;
      }
      if (attempt < 2) {
        binding.timer = setTimeout(() => {
          binding.timer = null;
          void this.readStableDocument(binding, generation, attempt + 1, event);
        }, WATCHER_STABILITY_POLL_INTERVAL);
        return;
      }
      this.send({ event: 'unlink', path: binding.path, scope: 'document' });
      if (this.isInWorkspace(binding.identity))
        this.send({ event: 'unlink', path: binding.path, scope: 'workspace' });
    }
  }

  private isMissingFileError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    );
  }

  private isPermissionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'EACCES' || error.code === 'EPERM')
    );
  }

  private isCurrentWorkspaceWatcher(watcher: FSWatcher): boolean {
    return this.workspaceWatcher === watcher;
  }

  private isCurrentBinding(binding: DocumentBinding, generation: number): boolean {
    return this.documents.get(binding.identity) === binding && binding.generation === generation;
  }

  private isInWorkspace(filePath: string): boolean {
    if (!this.workspacePath) return false;
    const relative = path.relative(this.workspacePath, filePath);
    return (
      relative !== '' &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative)
    );
  }

  private normalizePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    try {
      const canonical = fs.realpathSync.native(resolved);
      return process.platform === 'win32' ? canonical.toLocaleLowerCase() : canonical;
    } catch {
      return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
    }
  }

  private isOwnDocumentWriteEvent(changedPath: string): boolean {
    const now = Date.now();
    for (const [destination, expiresAt] of this.ownDocumentWrites) {
      if (expiresAt <= now) {
        this.ownDocumentWrites.delete(destination);
        continue;
      }
      if (changedPath === destination) return true;
      const temporaryPrefix = `.${path.basename(destination)}.`;
      if (
        path.dirname(changedPath) === path.dirname(destination) &&
        path.basename(changedPath).startsWith(temporaryPrefix) &&
        path.extname(changedPath) === '.tmp'
      )
        return true;
    }
    return false;
  }

  private toChangeEvent(eventName: string): FileChangeEvent['event'] | null {
    return eventName === 'add' || eventName === 'change' || eventName === 'unlink'
      ? eventName
      : null;
  }
}
