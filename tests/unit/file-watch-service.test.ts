import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChokidarOptions, FSWatcher } from 'chokidar';
import {
  FileChangeEvent,
  FileWatchService,
  normalizeWorkspaceReadDepth,
} from '../../src/main/services/file-watch-service';
import { resolveFileIdentitySync } from '../../src/main/services/file-identity';

class FakeWatcher {
  private callback: ((event: string, changedPath: string) => void) | null = null;
  private rawCallback: ((event: string, changedPath: string) => void) | null = null;
  private errorCallback: (() => void) | null = null;
  private readyCallback: (() => void) | null = null;
  closed = false;
  added: string[] = [];
  unwatched: string[] = [];

  on(event: string, callback: (eventName: string, changedPath: string) => void): this {
    if (event === 'all') this.callback = callback;
    if (event === 'raw') this.rawCallback = callback;
    if (event === 'error') this.errorCallback = () => callback('error', '');
    return this;
  }

  once(event: string, callback: () => void): this {
    if (event === 'ready') this.readyCallback = callback;
    return this;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  emit(event: string, changedPath: string): void {
    this.callback?.(event, changedPath);
  }

  emitRaw(event: string, changedPath: string): void {
    this.rawCallback?.(event, changedPath);
  }

  emitReady(): void {
    const callback = this.readyCallback;
    this.readyCallback = null;
    callback?.();
  }

  emitError(): void {
    this.errorCallback?.();
  }

  add(filePath: string): this {
    this.added.push(filePath);
    return this;
  }

  unwatch(filePath: string): this {
    this.unwatched.push(filePath);
    return this;
  }
}

describe('FileWatchService', () => {
  afterEach(() => vi.useRealTimers());

  it('normalizes workspace read depth to the supported bounds', () => {
    expect(normalizeWorkspaceReadDepth(undefined)).toBe(7);
    expect(normalizeWorkspaceReadDepth(6)).toBe(7);
    expect(normalizeWorkspaceReadDepth(7)).toBe(7);
    expect(normalizeWorkspaceReadDepth(12)).toBe(12);
    expect(normalizeWorkspaceReadDepth(13)).toBe(12);
  });

  it('recreates the workspace watcher when its read depth changes', async () => {
    const root = path.resolve('/workspace');
    const watchers: Array<{ options: ChokidarOptions; watcher: FakeWatcher }> = [];
    const service = new FileWatchService(
      async () => ({ content: '', encoding: 'utf-8' }),
      () => undefined,
      (_paths, options) => {
        const watcher = new FakeWatcher();
        watchers.push({ options, watcher });
        return watcher as unknown as FSWatcher;
      },
    );

    await service.setWorkspace(root, 7);
    await service.setWorkspace(root, 12);

    expect(watchers.map(({ options }) => options.depth)).toEqual([7, 12]);
    expect(watchers[0].watcher.closed).toBe(true);
  });

  it('reports a workspace watcher resource error only once', async () => {
    const root = path.resolve('/workspace');
    const events: FileChangeEvent[] = [];
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      async () => ({ content: '', encoding: 'utf-8' }),
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.setWorkspace(root, 7);
    watcher?.emitError();
    watcher?.emitError();

    expect(watcher?.closed).toBe(true);
    expect(events).toEqual([
      { event: 'watch-error', path: root, scope: 'workspace', error: 'resource-limit' },
    ]);
  });

  it('stops suppressing workspace events when an own rename fails', async () => {
    const root = path.resolve('/workspace');
    const oldDirectory = path.join(root, 'old');
    const newDirectory = path.join(root, 'new');
    const events: FileChangeEvent[] = [];
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      async () => ({ content: '', encoding: 'utf-8' }),
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.setWorkspace(root);
    service.markOwnWorkspaceRename(oldDirectory, newDirectory);
    watcher?.emit('addDir', newDirectory);
    expect(events).toEqual([]);

    service.clearOwnWorkspaceRename(oldDirectory, newDirectory);
    watcher?.emit('addDir', newDirectory);
    expect(events).toEqual([{ event: 'addDir', path: newDirectory, scope: 'workspace' }]);
  });

  it('reports an external directory rename for an open direct descendant', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-watch-directory-rename-'));
    const oldDirectory = path.join(root, 'old');
    const newDirectory = path.join(root, 'new');
    const oldFile = path.join(oldDirectory, 'entry.md');
    const newFile = path.join(newDirectory, 'entry.md');
    fs.mkdirSync(oldDirectory);
    fs.writeFileSync(oldFile, 'Original');
    const events: FileChangeEvent[] = [];
    const watchers: FakeWatcher[] = [];
    const service = new FileWatchService(
      async () => ({ content: '', encoding: 'utf-8' }),
      (event) => events.push(event),
      () => {
        const watcher = new FakeWatcher();
        watchers.push(watcher);
        return watcher as unknown as FSWatcher;
      },
    );

    try {
      await service.setWorkspace(root);
      await service.watchDocument(oldFile);
      fs.renameSync(oldDirectory, newDirectory);
      watchers[0].emit('addDir', newDirectory);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events).toContainEqual({
        event: 'rename',
        path: newFile,
        previousPath: oldFile,
        identity: oldFile,
        scope: 'workspace',
      });
      expect(watchers[1].closed).toBe(true);
    } finally {
      await service.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('degrades cleanly when creating a workspace watcher fails', async () => {
    const root = path.resolve('/workspace');
    const events: FileChangeEvent[] = [];
    const service = new FileWatchService(
      async () => ({ content: '', encoding: 'utf-8' }),
      (event) => events.push(event),
      () => {
        throw new Error('watcher resource limit');
      },
    );

    await expect(service.setWorkspace(root, 7)).resolves.toBeUndefined();
    expect(events).toEqual([
      { event: 'watch-error', path: root, scope: 'workspace', error: 'resource-limit' },
    ]);
  });

  it('uses the workspace watcher for workspace documents and sends stable content separately', async () => {
    vi.useFakeTimers();
    const root = path.resolve('/workspace');
    const documentPath = path.join(root, 'note.md');
    const watchers: Array<{
      paths: string | string[];
      options: ChokidarOptions;
      watcher: FakeWatcher;
    }> = [];
    const events: FileChangeEvent[] = [];
    const service = new FileWatchService(
      async () => ({ content: 'disk content', encoding: 'utf-8' }),
      (event) => events.push(event),
      (paths, options) => {
        const watcher = new FakeWatcher();
        watchers.push({ paths, options, watcher });
        return watcher as unknown as FSWatcher;
      },
    );

    await service.setWorkspace(root);
    await service.watchDocument(documentPath);
    expect(watchers).toHaveLength(2);
    expect(watchers[0]).toMatchObject({
      paths: root,
      options: { depth: 7, followSymlinks: false },
    });
    expect(watchers[1]).toMatchObject({ paths: documentPath });

    watchers[1].watcher.emitReady();
    watchers[0].watcher.emit('change', documentPath);
    watchers[1].watcher.emit('change', documentPath);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({
      event: 'change',
      path: documentPath,
      identity: documentPath,
      scope: 'document',
      content: 'disk content',
      encoding: 'utf-8',
    });
  });

  it('deduplicates external documents and requests chokidar stable-write waiting', async () => {
    const documentPath = path.resolve('/outside/note.md');
    const secondDocumentPath = path.resolve('/outside/second.md');
    const watchers: Array<{ paths: string | string[]; options: ChokidarOptions }> = [];
    const service = new FileWatchService(
      async () => ({ content: 'disk content', encoding: 'utf-8' }),
      () => undefined,
      (paths, options) => {
        watchers.push({ paths, options });
        return new FakeWatcher() as unknown as FSWatcher;
      },
    );

    await service.watchDocument(documentPath);
    await service.watchDocument(documentPath);
    await service.watchDocument(secondDocumentPath);
    expect(watchers).toHaveLength(2);
    expect(watchers[0]).toEqual({
      paths: documentPath,
      options: {
        ignoreInitial: true,
        atomic: true,
        awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 150 },
      },
    });
    expect(watchers[1].paths).toBe(secondDocumentPath);
  });

  it('waits for watcher readiness before reconciling current disk content', async () => {
    vi.useFakeTimers();
    const documentPath = path.resolve('/outside/reconcile.md');
    const events: FileChangeEvent[] = [];
    const readDocument = vi.fn(async () => ({ content: 'gap change', encoding: 'utf-8' }));
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      readDocument,
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.watchDocument(documentPath, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(readDocument).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    watcher?.emitReady();
    await vi.advanceTimersByTimeAsync(0);

    expect(readDocument).toHaveBeenCalledWith(documentPath);
    expect(events).toEqual([
      {
        event: 'change',
        path: documentPath,
        identity: documentPath,
        scope: 'document',
        content: 'gap change',
        encoding: 'utf-8',
      },
    ]);
  });

  it('drops an older document read when a newer event finishes first', async () => {
    vi.useFakeTimers();
    const documentPath = path.resolve('/outside/out-of-order.md');
    const events: FileChangeEvent[] = [];
    let resolveFirst: ((value: { content: string; encoding: string }) => void) | undefined;
    const readDocument = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ content: string; encoding: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ content: 'newer', encoding: 'utf-8' });
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      readDocument,
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.watchDocument(documentPath);
    watcher?.emitReady();
    watcher?.emit('change', documentPath);
    await vi.advanceTimersByTimeAsync(0);
    watcher?.emit('change', documentPath);
    await vi.advanceTimersByTimeAsync(0);
    resolveFirst?.({ content: 'older', encoding: 'utf-8' });
    await Promise.resolve();

    expect(events).toEqual([
      {
        event: 'change',
        path: documentPath,
        identity: documentPath,
        scope: 'document',
        content: 'newer',
        encoding: 'utf-8',
      },
    ]);
  });

  it('only refreshes the workspace tree for visible structural changes', async () => {
    const root = path.resolve('/workspace');
    const events: FileChangeEvent[] = [];
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      async () => ({ content: '', encoding: 'utf-8' }),
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.setWorkspace(root);
    watcher?.emit('change', path.join(root, 'existing.md'));
    watcher?.emit('add', path.join(root, '.temporary.md'));
    watcher?.emit('add', path.join(root, 'new.md'));

    expect(events).toEqual([{ event: 'add', path: path.join(root, 'new.md'), scope: 'workspace' }]);
  });

  it('reports a reappeared open workspace document to both document and tree consumers', async () => {
    vi.useFakeTimers();
    const root = path.resolve('/workspace');
    const documentPath = path.join(root, 'reappeared.md');
    const events: FileChangeEvent[] = [];
    let documentWatcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      async () => ({ content: 'reappeared content', encoding: 'utf-8' }),
      (event) => events.push(event),
      (paths) => {
        const watcher = new FakeWatcher();
        if (paths === documentPath) documentWatcher = watcher;
        return watcher as unknown as FSWatcher;
      },
    );

    await service.setWorkspace(root);
    await service.watchDocument(documentPath);
    documentWatcher?.emitReady();
    documentWatcher?.emit('add', documentPath);
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual([
      {
        event: 'add',
        path: documentPath,
        identity: documentPath,
        scope: 'document',
        content: 'reappeared content',
        encoding: 'utf-8',
      },
      { event: 'add', path: documentPath, scope: 'workspace' },
    ]);
  });

  it('reconciles a transient unlink as changed content after atomic replacement', async () => {
    vi.useFakeTimers();
    const documentPath = path.resolve('/outside/note.md');
    const missing = Object.assign(new Error('missing during replacement'), { code: 'ENOENT' });
    const readDocument = vi
      .fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValue({ content: 'replacement', encoding: 'utf-8' });
    const events: FileChangeEvent[] = [];
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      readDocument,
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.watchDocument(documentPath);
    watcher?.emitReady();
    watcher?.emit('unlink', documentPath);
    await vi.advanceTimersByTimeAsync(1150);

    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      {
        event: 'change',
        path: documentPath,
        identity: documentPath,
        scope: 'document',
        content: 'replacement',
        encoding: 'utf-8',
      },
    ]);
  });

  it('reports unreadable documents without misclassifying them as deleted', async () => {
    vi.useFakeTimers();
    const documentPath = path.resolve('/outside/locked.md');
    const unreadable = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const events: FileChangeEvent[] = [];
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      async () => Promise.reject(unreadable),
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.watchDocument(documentPath);
    watcher?.emitReady();
    watcher?.emit('change', documentPath);
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual([
      {
        event: 'unreadable',
        path: documentPath,
        identity: documentPath,
        scope: 'document',
        error: 'permission-denied',
      },
    ]);
  });

  it('treats a symlinked workspace document as workspace-owned', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-watch-service-'));
    const workspace = path.join(root, 'workspace');
    const workspaceAlias = path.join(root, 'workspace-alias');
    const documentPath = path.join(workspace, 'note.md');
    fs.mkdirSync(workspace);
    fs.writeFileSync(documentPath, 'content');
    fs.symlinkSync(workspace, workspaceAlias);
    const watchers: string[] = [];
    const service = new FileWatchService(
      async () => ({ content: 'content', encoding: 'utf-8' }),
      () => undefined,
      (paths) => {
        watchers.push(String(paths));
        return new FakeWatcher() as unknown as FSWatcher;
      },
    );

    try {
      await service.setWorkspace(workspaceAlias);
      await service.watchDocument(documentPath);
      expect(watchers).toEqual([workspace, documentPath]);
    } finally {
      await service.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')(
    'releases a symlink binding by its saved identity after the symlink disappears',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-watch-service-'));
      const target = path.join(root, 'target.md');
      const alias = path.join(root, 'alias.md');
      fs.writeFileSync(target, 'content');
      fs.symlinkSync(target, alias);
      const identity = resolveFileIdentitySync(alias);
      let watcher: FakeWatcher | undefined;
      const service = new FileWatchService(
        async () => ({ content: 'content', encoding: 'utf-8' }),
        () => undefined,
        () => {
          watcher = new FakeWatcher();
          return watcher as unknown as FSWatcher;
        },
      );

      try {
        await service.watchDocument(alias);
        fs.unlinkSync(alias);
        await service.unwatchDocument(alias, identity);
        expect(watcher?.closed).toBe(true);
      } finally {
        await service.dispose();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('drops a delayed read after the document binding is released', async () => {
    vi.useFakeTimers();
    const documentPath = path.resolve('/outside/note.md');
    let resolveRead: ((value: { content: string; encoding: string }) => void) | undefined;
    const readDocument = vi.fn(
      () =>
        new Promise<{ content: string; encoding: string }>((resolve) => (resolveRead = resolve)),
    );
    const events: FileChangeEvent[] = [];
    let watcher: FakeWatcher | undefined;
    const service = new FileWatchService(
      readDocument,
      (event) => events.push(event),
      () => {
        watcher = new FakeWatcher();
        return watcher as unknown as FSWatcher;
      },
    );

    await service.watchDocument(documentPath);
    watcher?.emitReady();
    watcher?.emit('change', documentPath);
    await vi.advanceTimersByTimeAsync(0);
    await service.unwatchDocument(documentPath);
    resolveRead?.({ content: 'late content', encoding: 'utf-8' });
    await Promise.resolve();

    expect(readDocument).toHaveBeenCalledWith(documentPath);
    expect(events).toEqual([]);
  });

  it.runIf(process.platform === 'linux')(
    'rebinds a document watcher after a raw rename',
    async () => {
      vi.useFakeTimers();
      const documentPath = path.resolve('/outside/note.md');
      let watcher: FakeWatcher | undefined;
      const service = new FileWatchService(
        async () => ({ content: 'replacement', encoding: 'utf-8' }),
        () => undefined,
        () => {
          watcher = new FakeWatcher();
          return watcher as unknown as FSWatcher;
        },
      );

      await service.watchDocument(documentPath);
      watcher?.emitReady();
      watcher?.emitRaw('rename', path.basename(documentPath));
      await vi.advanceTimersByTimeAsync(150);

      expect(watcher?.unwatched).toEqual([documentPath]);
      expect(watcher?.added).toEqual([documentPath]);
    },
  );
});
