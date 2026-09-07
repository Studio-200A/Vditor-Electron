import { describe, expect, it, vi } from 'vitest';
import { ExplorerFileTransactionController } from '../../../src/renderer/workspace/explorer-file-transaction-controller';

interface Document {
  filePath: string | null;
  fileIdentity: string | null;
  baseDir: string;
}

function fixture(options: { readonly persistFails?: boolean } = {}) {
  const document: Document = {
    filePath: '/workspace/notes/note.md',
    fileIdentity: 'old-identity',
    baseDir: '/workspace/notes',
  };
  const calls: string[] = [];
  const deleteItem = vi.fn().mockResolvedValue(undefined);
  const confirmDelete = vi.fn().mockResolvedValue(true);
  const preserveDeletedDocument = vi.fn().mockResolvedValue(undefined);
  const controller = new ExplorerFileTransactionController<Document>({
    fileAPI: {
      createItem: vi.fn(),
      prepareRename: vi.fn().mockResolvedValue('/workspace/renamed'),
      renameItem: vi.fn().mockResolvedValue('/workspace/renamed'),
      deleteItem,
      rebasePath: vi
        .fn()
        .mockImplementation(async (oldRoot, newRoot, candidate) =>
          candidate.startsWith(oldRoot) ? `${newRoot}${candidate.slice(oldRoot.length)}` : '',
        ),
      fileIdentity: vi.fn().mockResolvedValue('new-identity'),
      dirname: vi.fn().mockResolvedValue('/workspace/renamed'),
    },
    getDocuments: () => [document],
    nextUntitledName: vi.fn(),
    fileName: (path) => path.split('/').pop() || path,
    openPath: vi.fn(),
    confirmDelete,
    getPathState: () => ({
      recentFiles: [{ path: '/workspace/notes/note.md', title: 'note.md' }],
      workspaceTreeStates: [{ workspacePath: '/workspace', expandedPaths: ['/workspace/notes'] }],
    }),
    applyPathState: vi.fn(),
    persistPathState: options.persistFails
      ? vi.fn().mockRejectedValue(new Error('settings unavailable'))
      : vi.fn().mockResolvedValue(undefined),
    suspendWatches: vi.fn().mockImplementation(async () => calls.push('suspend')),
    rebindWatches: vi.fn().mockImplementation(async () => calls.push('rebind')),
    transitionBindings: vi.fn().mockImplementation(async ({ prepare, commit }) => {
      const prepared = await prepare();
      await commit(prepared);
      calls.push('transition');
      return prepared;
    }),
    updateDocumentBinding: vi.fn().mockImplementation((item, binding) => {
      Object.assign(item, {
        filePath: binding.nextPath,
        fileIdentity: binding.fileIdentity,
        baseDir: binding.baseDir,
      });
    }),
    preserveDeletedDocument,
    syncLocalResourceRoots: vi.fn().mockImplementation(async () => calls.push('resources')),
    rebuildEditors: vi.fn().mockImplementation(() => {
      calls.push('rebuild');
      return [];
    }),
    renderDocuments: vi.fn().mockImplementation(() => calls.push('render')),
    updateActiveDocumentUI: vi.fn(),
    refreshTree: vi.fn().mockImplementation(async () => calls.push('refresh')),
    persistSession: vi.fn().mockImplementation(async () => calls.push('session')),
    showError: vi.fn(),
  });
  return { controller, document, calls, deleteItem, preserveDeletedDocument };
}

describe('ExplorerFileTransactionController', () => {
  it('renames affected documents through canonical bindings and restores their watchers', async () => {
    const f = fixture();

    await f.controller.rename(
      { name: 'notes', path: '/workspace/notes', type: 'directory' },
      'renamed',
    );

    expect(f.document).toMatchObject({
      filePath: '/workspace/renamed/note.md',
      fileIdentity: 'new-identity',
      baseDir: '/workspace/renamed',
    });
    expect(f.calls).toEqual([
      'suspend',
      'transition',
      'resources',
      'rebind',
      'rebuild',
      'render',
      'refresh',
      'session',
    ]);
  });

  it('restores watchers and performs committed-rename cleanup when settings persistence fails', async () => {
    const f = fixture({ persistFails: true });

    await f.controller.rename(
      { name: 'notes', path: '/workspace/notes', type: 'directory' },
      'renamed',
    );

    expect(f.calls).toContain('rebind');
    expect(f.calls.filter((call) => call === 'resources')).toHaveLength(2);
    expect(f.calls.filter((call) => call === 'refresh')).toHaveLength(1);
  });

  it('marks affected documents unavailable after deleting an Explorer entry', async () => {
    const f = fixture();

    await f.controller.delete({ name: 'notes', path: '/workspace/notes', type: 'directory' });

    expect(f.deleteItem).toHaveBeenCalledWith('/workspace/notes');
    expect(f.preserveDeletedDocument).toHaveBeenCalledWith(f.document);
    expect(f.calls).toEqual(['suspend', 'transition', 'rebind', 'render', 'session', 'refresh']);
  });
});
