import { describe, expect, it, vi } from 'vitest';
import { RecoveryRestoreController } from '../../../src/renderer/editor/recovery-restore-controller';
import {
  fromRecoveryStoreSnapshot,
  type RestoredRecoveryStoreSnapshot,
} from '../../../src/renderer/documents/recovery-snapshot';

function snapshot(
  overrides: Partial<RestoredRecoveryStoreSnapshot> = {},
): RestoredRecoveryStoreSnapshot {
  return {
    schemaVersion: 2,
    id: 'recovery-1',
    filePath: '/notes/one.md',
    title: 'one.md',
    content: '# local',
    savedContent: '# disk',
    expectedSavedContent: '# disk',
    encoding: 'utf-8',
    lineEnding: 'LF',
    mode: 'wysiwyg',
    updatedAt: 1,
    diskState: 'unchanged',
    ...overrides,
  };
}

function fixture(restored: Record<string, RestoredRecoveryStoreSnapshot | null>) {
  const documents: Array<{ id: string }> = [];
  const mergeUnchanged = vi.fn();
  const applyMergedContent = vi.fn();
  const createDocument = vi.fn(() => ({ id: `tab-${documents.length + 1}` }));
  const watchDocument = vi.fn(async () => undefined);
  const syncResourceRoots = vi.fn(async () => undefined);
  const controller = new RecoveryRestoreController({
    getCandidates: vi.fn(async () => Object.keys(restored).map((id) => ({ id }))),
    restore: vi.fn(async (id) => restored[id] ?? null),
    parse: fromRecoveryStoreSnapshot,
    dirname: vi.fn(async () => '/notes'),
    fileIdentity: vi.fn(async () => 'identity:/notes/one.md'),
    syncResourceRoots,
    findDocumentByIdentity: () => documents[0] ?? null,
    mergeUnchanged,
    applyMergedContent,
    createDocument,
    watchDocument,
    conflictTitle: (title) => `Recovered ${title}`,
  });
  return {
    controller,
    documents,
    mergeUnchanged,
    applyMergedContent,
    createDocument,
    watchDocument,
    syncResourceRoots,
  };
}

describe('RecoveryRestoreController', () => {
  it('merges unchanged recovery into an already open canonical document without creating a duplicate', async () => {
    const f = fixture({ one: snapshot() });
    f.documents.push({ id: 'open' });
    await f.controller.restoreAll();
    expect(f.mergeUnchanged).toHaveBeenCalledWith(f.documents[0], snapshot());
    expect(f.applyMergedContent).toHaveBeenCalledWith(f.documents[0], '# local');
    expect(f.createDocument).not.toHaveBeenCalled();
    expect(f.syncResourceRoots).not.toHaveBeenCalled();
  });

  it('creates watched unchanged documents with their identity and resource root', async () => {
    const f = fixture({ one: snapshot() });
    await f.controller.restoreAll();
    expect(f.syncResourceRoots).toHaveBeenCalledWith(['/notes']);
    expect(f.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileIdentity: 'identity:/notes/one.md',
        recoveryState: 'unchanged',
      }),
    );
    expect(f.watchDocument).toHaveBeenCalledOnce();
  });

  it.each(['changed', 'unavailable'] as const)(
    'creates %s recovery as a watchable restricted tab',
    async (diskState) => {
      const f = fixture({ one: snapshot({ diskState }) });
      await f.controller.restoreAll();
      expect(f.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Recovered one.md',
          savedContent: '',
          recoveryState: diskState,
        }),
      );
      expect(f.watchDocument).toHaveBeenCalledOnce();
    },
  );

  it('isolates candidate restore failures and ignores malformed snapshots', async () => {
    const f = fixture({ broken: null, valid: snapshot({ id: 'valid' }) });
    await f.controller.restoreAll();
    expect(f.createDocument).toHaveBeenCalledOnce();
  });
});
