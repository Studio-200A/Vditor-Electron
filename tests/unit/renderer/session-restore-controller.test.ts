import { describe, expect, it, vi } from 'vitest';
import { SessionRestoreController } from '../../../src/renderer/app/session-restore-controller';

function fixture() {
  const settings: {
    restoreWorkspace: boolean;
    restoreTabs: boolean;
    session: unknown;
  } = {
    restoreWorkspace: true,
    restoreTabs: true,
    session: {
      workspacePath: '/notes',
      activeFilePath: '/notes/two.md',
      openFiles: ['/notes/one.md', '/notes/two.md'],
    },
  };
  const documents: Array<{ filePath: string | null; externalFileState: unknown | null }> = [];
  const persistSnapshot = vi.fn(async () => undefined);
  const reportPersistenceFailure = vi.fn();
  const activateFile = vi.fn();
  const openPaths = vi.fn(async (paths: string[]) => {
    documents.push(...paths.map((filePath) => ({ filePath, externalFileState: null })));
  });
  const controller = new SessionRestoreController({
    getSettings: () => settings,
    getWorkspacePath: () => '/current',
    getActiveFilePath: () => '/notes/two.md',
    getDocuments: () => documents,
    persistSnapshot,
    reportPersistenceFailure,
    workspaceExists: vi.fn(async () => true),
    setWorkspace: vi.fn(async () => undefined),
    openPaths,
    activateFile,
    createEmptyPreview: vi.fn(),
    updateActiveUI: vi.fn(),
    syncTopControlsWidth: vi.fn(),
  });
  return {
    controller,
    documents,
    persistSnapshot,
    reportPersistenceFailure,
    activateFile,
    openPaths,
    settings,
  };
}

describe('SessionRestoreController', () => {
  it('captures the startup DTO before workspace changes, restores documents, and activates the saved file', async () => {
    const f = fixture();
    await f.controller.restoreWorkspace();
    f.settings.session = { workspacePath: '', activeFilePath: null, openFiles: [] };
    await f.controller.restoreDocuments();
    expect(f.openPaths).toHaveBeenCalledWith(['/notes/one.md', '/notes/two.md']);
    expect(f.activateFile).toHaveBeenCalledWith('/notes/two.md');
  });

  it('projects unavailable files out of persistence and preserves non-throwing failure behavior', async () => {
    const f = fixture();
    f.documents.push(
      { filePath: '/notes/one.md', externalFileState: null },
      { filePath: '/notes/unavailable.md', externalFileState: { kind: 'deleted' } },
    );
    f.persistSnapshot.mockRejectedValueOnce(new Error('write failed'));
    expect(await f.controller.persist()).toBe(false);
    expect(f.reportPersistenceFailure).toHaveBeenCalledOnce();
    f.persistSnapshot.mockRejectedValueOnce(new Error('write failed again'));
    await expect(f.controller.persist(true)).rejects.toThrow('write failed again');
    await expect(f.controller.persist()).resolves.toBe(true);
    expect(f.persistSnapshot).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      workspacePath: '/current',
      activeFilePath: '/notes/two.md',
      openFiles: ['/notes/one.md'],
    });
  });
});
