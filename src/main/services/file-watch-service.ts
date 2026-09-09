import * as fs from 'node:fs';
import * as path from 'node:path';
import { watch, ChokidarOptions, FSWatcher } from 'chokidar';
import { normalizeFileIdentityPath, resolveFileIdentitySync } from './file-identity';
import {
  normalizeWorkspaceReadDepth,
  WORKSPACE_READ_DEPTH_MAX,
  WORKSPACE_READ_DEPTH_MIN,
} from './app-state';

export { normalizeWorkspaceReadDepth, WORKSPACE_READ_DEPTH_MAX, WORKSPACE_READ_DEPTH_MIN };

export type FileChangeEvent = {
  event:
    'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'rename' | 'unreadable' | 'watch-error';
  path: string;
  previousPath?: string;
  identity?: string;
  scope: 'workspace' | 'document';
  content?: string;
  encoding?: string;
  error?: 'permission-denied' | 'read-failed' | 'resource-limit';
};

type WatcherFactory = (paths: string | string[], options: ChokidarOptions) => FSWatcher;

type DocumentReader = (filePath: string) => Promise<{ content: string; encoding: string }>;

type DocumentBinding = {
  identity: string;
  path: string;
  generation: number;
  readRevision: number;
  ready: boolean;
  reconcileRequested: boolean;
  timer: NodeJS.Timeout | null;
  watcher: FSWatcher;
  renameTimer: NodeJS.Timeout | null;
  parentDirectoryFingerprint: string | null;
  fileFingerprint: string | null;
};

type WorkspaceMutation = {
  oldPath: string;
  newPath: string;
  expiresAt: number;
};

export const WATCHER_STABILITY_THRESHOLD = 1000;
export const WATCHER_STABILITY_POLL_INTERVAL = 150;
const LINUX_RENAME_REBIND_DELAY = 150;
const TEST_DOCUMENT_WATCH_FAILURES = 'VDITOR_DESKTOP_TEST_FAIL_DOCUMENT_WATCHES';

function defaultWatcher(paths: string | string[], options: ChokidarOptions): FSWatcher {
  // This opt-in seam is used only by Electron regression tests. It is read per call so a
  // running test can arm failures after the initial document bindings are established.
  if (options.atomic === true) {
    const remaining = Number.parseInt(process.env[TEST_DOCUMENT_WATCH_FAILURES] || '0', 10);
    if (remaining > 0) {
      process.env[TEST_DOCUMENT_WATCH_FAILURES] = String(remaining - 1);
      throw Object.assign(new Error('Injected document watcher failure.'), { code: 'EIO' });
    }
  }
  return watch(paths, options);
}

export class FileWatchService {
  private workspacePath = '';
  private workspaceDepth = WORKSPACE_READ_DEPTH_MIN;
  private workspaceWatcher: FSWatcher | null = null;
  private workspaceRevision = 0;
  private workspaceWatchErrorReported = false;
  private readonly documents = new Map<string, DocumentBinding>();
  private readonly documentFingerprints = new Map<string, string>();
  private readonly ownDocumentWrites = new Map<string, number>();
  private readonly ownWorkspaceMutations = new Map<string, WorkspaceMutation>();

  constructor(
    private readonly readDocument: DocumentReader,
    private readonly send: (event: FileChangeEvent) => void,
    private readonly createWatcher: WatcherFactory = defaultWatcher,
  ) {}

  async setWorkspace(workspacePath?: string, requestedDepth?: number): Promise<void> {
    const revision = ++this.workspaceRevision;
    const nextWorkspace = workspacePath ? this.normalizePath(workspacePath) : '';
    const nextDepth = normalizeWorkspaceReadDepth(requestedDepth);
    if (
      nextWorkspace === this.workspacePath &&
      nextDepth === this.workspaceDepth &&
      this.workspaceWatcher
    )
      return;

    const previousWatcher = this.workspaceWatcher;
    this.workspaceWatcher = null;
    await previousWatcher?.close();
    if (revision !== this.workspaceRevision) return;
    this.workspacePath = nextWorkspace;
    this.workspaceDepth = nextDepth;
    this.workspaceWatchErrorReported = false;

    if (nextWorkspace) {
      let watcher: FSWatcher;
      try {
        watcher = this.createWatcher(nextWorkspace, {
          ignoreInitial: true,
          depth: nextDepth,
          followSymlinks: false,
        });
      } catch {
        this.reportWorkspaceWatchError(nextWorkspace);
        return;
      }
      if (revision !== this.workspaceRevision) {
        await watcher.close();
        return;
      }
      this.workspaceWatcher = watcher;
      watcher.on('all', (eventName, changedPath) => {
        if (!this.isCurrentWorkspaceWatcher(watcher)) return;
        this.handleWorkspaceEvent(eventName, changedPath);
      });
      watcher.on('error', () => this.reportWorkspaceWatchError(nextWorkspace, watcher));
    }
  }

  async watchDocument(filePath: string, reconcile = false): Promise<void> {
    const identity = this.normalizePath(filePath);
    const existing = this.documents.get(identity);
    if (existing) {
      if (reconcile) this.requestDocumentReconciliation(existing);
      return;
    }
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
      readRevision: 0,
      ready: false,
      reconcileRequested: reconcile,
      timer: null,
      watcher,
      renameTimer: null,
      parentDirectoryFingerprint: this.directoryFingerprint(path.dirname(identity)),
      fileFingerprint: this.pathFingerprint(identity),
    };
    if (binding.fileFingerprint) this.documentFingerprints.set(identity, binding.fileFingerprint);
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
    watcher.once('ready', () => {
      if (!this.isCurrentBinding(binding, binding.generation)) return;
      binding.ready = true;
      if (binding.reconcileRequested) {
        binding.reconcileRequested = false;
        this.scheduleDocumentRead(binding, 0, 'change');
      }
    });
    watcher.on('raw', (eventName) => {
      if (process.platform !== 'linux' || eventName !== 'rename') return;
      this.scheduleLinuxRenameRebind(binding);
    });
  }

  markOwnDocumentWrite(filePath: string): void {
    this.ownDocumentWrites.set(this.normalizePath(filePath), Date.now() + 1500);
  }

  markOwnWorkspaceRename(oldPath: string, newPath: string): void {
    const source = path.resolve(oldPath);
    const destination = path.resolve(newPath);
    this.ownWorkspaceMutations.set(this.workspaceMutationKey(source, destination), {
      oldPath: source,
      newPath: destination,
      expiresAt: Date.now() + 1500,
    });
  }

  clearOwnWorkspaceRename(oldPath: string, newPath: string): void {
    this.ownWorkspaceMutations.delete(
      this.workspaceMutationKey(path.resolve(oldPath), path.resolve(newPath)),
    );
  }

  async unwatchDocument(filePath: string, identity?: string): Promise<void> {
    const bindingIdentity = identity
      ? normalizeFileIdentityPath(path.resolve(identity))
      : this.normalizePath(filePath);
    const binding = this.documents.get(bindingIdentity);
    this.documentFingerprints.delete(bindingIdentity);
    if (!binding) return;
    this.documents.delete(binding.identity);
    binding.generation++;
    if (binding.timer) clearTimeout(binding.timer);
    binding.timer = null;
    if (binding.renameTimer) clearTimeout(binding.renameTimer);
    binding.renameTimer = null;
    await binding.watcher.close();
  }

  async resolveRenamedDocument(filePath: string): Promise<string | null> {
    const identity = this.normalizePath(filePath);
    const fingerprint =
      this.documents.get(identity)?.fileFingerprint ?? this.documentFingerprints.get(identity);
    return fingerprint ? this.findWorkspacePathByFingerprint(fingerprint) : null;
  }

  async dispose(): Promise<void> {
    const workspaceWatcher = this.workspaceWatcher;
    this.workspaceWatcher = null;
    this.workspacePath = '';
    this.workspaceWatchErrorReported = false;
    await workspaceWatcher?.close();
    for (const binding of this.documents.values()) {
      binding.generation++;
      if (binding.timer) clearTimeout(binding.timer);
      if (binding.renameTimer) clearTimeout(binding.renameTimer);
    }
    const documentWatchers = [...this.documents.values()].map(({ watcher }) => watcher.close());
    this.documents.clear();
    this.documentFingerprints.clear();
    this.ownWorkspaceMutations.clear();
    await Promise.all(documentWatchers);
  }

  private scheduleLinuxRenameRebind(binding: DocumentBinding): void {
    if (!this.isCurrentBinding(binding, binding.generation)) return;
    if (binding.renameTimer) clearTimeout(binding.renameTimer);
    const generation = binding.generation;
    binding.renameTimer = setTimeout(() => {
      binding.renameTimer = null;
      if (!this.isCurrentBinding(binding, generation)) return;
      void this.reconcileLinuxRenamedDocument(binding, generation);
    }, LINUX_RENAME_REBIND_DELAY);
  }

  private async reconcileLinuxRenamedDocument(
    binding: DocumentBinding,
    generation: number,
  ): Promise<void> {
    const renamedPath = binding.fileFingerprint
      ? await this.findWorkspacePathByFingerprint(binding.fileFingerprint)
      : null;
    if (!this.isCurrentBinding(binding, generation)) return;
    if (renamedPath && path.resolve(renamedPath) !== path.resolve(binding.path)) {
      await this.retireRenamedBinding(binding, renamedPath);
      return;
    }
    binding.watcher.unwatch(binding.identity);
    binding.watcher.add(binding.identity);
    this.scheduleDocumentRead(binding, WATCHER_STABILITY_THRESHOLD, 'change');
  }

  private handleWorkspaceEvent(eventName: string, changedPath: string): void {
    const event = this.toChangeEvent(eventName);
    if (!event) return;
    if (this.isOwnWorkspaceMutation(changedPath)) return;
    const identity = this.normalizePath(changedPath);
    const binding = this.documents.get(identity);
    if (binding) return;
    if (event === 'change' || path.basename(changedPath).startsWith('.')) return;
    if (event === 'unlinkDir') void this.reconcileRenamedDocumentsUnder(changedPath);
    if (event === 'addDir') void this.reconcileRenamedDirectory(changedPath);
    if (event === 'add') void this.reconcileRenamedDirectory(path.dirname(changedPath));
    if (!this.isOwnDocumentWriteEvent(identity))
      this.send({ event, path: path.resolve(changedPath), scope: 'workspace' });
  }

  private async reconcileRenamedDirectory(directoryPath: string): Promise<void> {
    const fingerprint = this.directoryFingerprint(directoryPath);
    if (!fingerprint) return;
    const destinationDirectory = path.resolve(directoryPath);
    const renamedBindings = [...this.documents.values()].filter(
      (binding) => binding.parentDirectoryFingerprint === fingerprint,
    );
    for (const binding of renamedBindings) {
      if (!this.isCurrentBinding(binding, binding.generation)) continue;
      const previousPath = binding.path;
      const nextPath = path.join(destinationDirectory, path.basename(previousPath));
      if (path.resolve(previousPath) === nextPath) continue;
      await this.retireRenamedBinding(binding, nextPath);
    }
  }

  private async reconcileRenamedDocumentsUnder(previousDirectory: string): Promise<void> {
    const candidates = [...this.documents.values()].filter((binding) =>
      this.isWithinPath(path.resolve(previousDirectory), binding.path),
    );
    for (const binding of candidates) {
      if (!binding.fileFingerprint || !this.isCurrentBinding(binding, binding.generation)) continue;
      const renamedPath = await this.findWorkspacePathByFingerprint(binding.fileFingerprint);
      if (
        renamedPath &&
        path.resolve(renamedPath) !== path.resolve(binding.path) &&
        this.isCurrentBinding(binding, binding.generation)
      )
        await this.retireRenamedBinding(binding, renamedPath);
    }
  }

  private async retireRenamedBinding(binding: DocumentBinding, nextPath: string): Promise<void> {
    const previousPath = binding.path;
    this.documents.delete(binding.identity);
    binding.generation++;
    if (binding.timer) clearTimeout(binding.timer);
    if (binding.renameTimer) clearTimeout(binding.renameTimer);
    binding.timer = null;
    binding.renameTimer = null;
    await binding.watcher.close();
    this.send({
      event: 'rename',
      path: nextPath,
      previousPath,
      identity: binding.identity,
      scope: 'workspace',
    });
  }

  private reportWorkspaceWatchError(workspacePath: string, watcher?: FSWatcher): void {
    if (watcher && !this.isCurrentWorkspaceWatcher(watcher)) return;
    if (workspacePath !== this.workspacePath || this.workspaceWatchErrorReported) return;
    this.workspaceWatchErrorReported = true;
    if (watcher) {
      this.workspaceWatcher = null;
      void watcher.close().catch(() => undefined);
    }
    this.send({
      event: 'watch-error',
      path: workspacePath,
      scope: 'workspace',
      error: 'resource-limit',
    });
  }

  private scheduleDocumentRead(
    binding: DocumentBinding,
    delay: number,
    event: FileChangeEvent['event'] = 'change',
  ): void {
    if (!binding.ready) {
      binding.reconcileRequested = true;
      return;
    }
    const generation = binding.generation;
    const readRevision = ++binding.readRevision;
    if (binding.timer) clearTimeout(binding.timer);
    binding.timer = setTimeout(() => {
      binding.timer = null;
      void this.readStableDocument(binding, generation, readRevision, 0, event);
    }, delay);
  }

  private requestDocumentReconciliation(binding: DocumentBinding): void {
    binding.reconcileRequested = true;
    if (!binding.ready) return;
    binding.reconcileRequested = false;
    this.scheduleDocumentRead(binding, 0, 'change');
  }

  private async readStableDocument(
    binding: DocumentBinding,
    generation: number,
    readRevision: number,
    attempt: number,
    event: FileChangeEvent['event'],
  ): Promise<void> {
    if (!this.isCurrentBinding(binding, generation, readRevision)) return;
    try {
      const result = await this.readDocument(binding.identity);
      if (!this.isCurrentBinding(binding, generation, readRevision)) return;
      this.send({
        event: event === 'add' ? 'add' : 'change',
        path: binding.path,
        identity: binding.identity,
        scope: 'document',
        ...result,
      });
      if (event === 'add' && this.isInWorkspace(binding.identity))
        this.send({ event: 'add', path: binding.path, scope: 'workspace' });
    } catch (error) {
      if (!this.isCurrentBinding(binding, generation, readRevision)) return;
      if (!this.isMissingFileError(error)) {
        this.send({
          event: 'unreadable',
          path: binding.path,
          identity: binding.identity,
          scope: 'document',
          error: this.isPermissionError(error) ? 'permission-denied' : 'read-failed',
        });
        return;
      }
      if (attempt < 2) {
        binding.timer = setTimeout(() => {
          binding.timer = null;
          void this.readStableDocument(binding, generation, readRevision, attempt + 1, event);
        }, WATCHER_STABILITY_POLL_INTERVAL);
        return;
      }
      this.send({
        event: 'unlink',
        path: binding.path,
        identity: binding.identity,
        scope: 'document',
      });
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

  private isCurrentBinding(
    binding: DocumentBinding,
    generation: number,
    readRevision?: number,
  ): boolean {
    return (
      this.documents.get(binding.identity) === binding &&
      binding.generation === generation &&
      (readRevision === undefined || binding.readRevision === readRevision)
    );
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
    return resolveFileIdentitySync(filePath);
  }

  private directoryFingerprint(directoryPath: string): string | null {
    return this.pathFingerprint(directoryPath);
  }

  private pathFingerprint(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      return `${stat.dev}:${stat.ino}`;
    } catch {
      return null;
    }
  }

  private async findWorkspacePathByFingerprint(fingerprint: string): Promise<string | null> {
    if (!this.workspacePath) return null;
    const search = async (directory: string, depth: number): Promise<string | null> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const entry of entries) {
        const candidate = path.join(directory, entry.name);
        if (entry.isFile() && this.pathFingerprint(candidate) === fingerprint) return candidate;
        if (entry.isDirectory() && depth < this.workspaceDepth) {
          const found = await search(candidate, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };
    return search(this.workspacePath, 0);
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

  private isOwnWorkspaceMutation(changedPath: string): boolean {
    const resolvedPath = path.resolve(changedPath);
    const now = Date.now();
    for (const [key, mutation] of this.ownWorkspaceMutations) {
      if (mutation.expiresAt <= now) {
        this.ownWorkspaceMutations.delete(key);
        continue;
      }
      if (
        this.isWithinPath(mutation.oldPath, resolvedPath) ||
        this.isWithinPath(mutation.newPath, resolvedPath)
      )
        return true;
    }
    return false;
  }

  private isWithinPath(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(rootPath, targetPath);
    return (
      relative === '' ||
      (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== '..')
    );
  }

  private workspaceMutationKey(source: string, destination: string): string {
    return `${source}\n${destination}`;
  }

  private toChangeEvent(eventName: string): FileChangeEvent['event'] | null {
    return eventName === 'add' ||
      eventName === 'change' ||
      eventName === 'unlink' ||
      eventName === 'addDir' ||
      eventName === 'unlinkDir'
      ? eventName
      : null;
  }
}
