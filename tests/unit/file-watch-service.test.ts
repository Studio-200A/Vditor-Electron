import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChokidarOptions, FSWatcher } from 'chokidar';
import { FileChangeEvent, FileWatchService } from '../../src/main/services/file-watch-service';

class FakeWatcher {
  private callback: ((event: string, changedPath: string) => void) | null = null;
  private rawCallback: ((event: string, changedPath: string) => void) | null = null;
  closed = false;
  added: string[] = [];
  unwatched: string[] = [];

  on(event: string, callback: (eventName: string, changedPath: string) => void): this {
    if (event === 'all') this.callback = callback;
    if (event === 'raw') this.rawCallback = callback;
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
    expect(watchers[0]).toMatchObject({ paths: root, options: { depth: 20 } });
    expect(watchers[1]).toMatchObject({ paths: documentPath });

    watchers[0].watcher.emit('change', documentPath);
    watchers[1].watcher.emit('change', documentPath);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({
      event: 'change',
      path: documentPath,
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
    watcher?.emit('unlink', documentPath);
    await vi.advanceTimersByTimeAsync(1150);

    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      {
        event: 'change',
        path: documentPath,
        scope: 'document',
        content: 'replacement',
        encoding: 'utf-8',
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
      watcher?.emitRaw('rename', path.basename(documentPath));
      await vi.advanceTimersByTimeAsync(150);

      expect(watcher?.unwatched).toEqual([documentPath]);
      expect(watcher?.added).toEqual([documentPath]);
    },
  );
});
