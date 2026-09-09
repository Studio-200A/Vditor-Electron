import { describe, expect, it, vi } from 'vitest';
import { ExternalFileChangeController } from '../../../src/renderer/documents/external-file-change-controller';

const tab = {
  id: 'tab-1',
  title: 'one.md',
  filePath: '/notes/one.md',
  fileIdentity: 'identity:/notes/one.md',
  expectedSavedContent: '# disk',
  modified: false,
  externalChangeIgnored: false,
  externalConflict: null,
  externalFileState: null,
  encoding: 'utf-8',
};

function fixture() {
  const calls = {
    preserve: vi.fn(async () => undefined),
    begin: vi.fn(),
    clear: vi.fn(),
    ignored: vi.fn(),
    reappeared: vi.fn(),
    reload: vi.fn(),
    conflict: vi.fn(),
    reloaded: vi.fn(),
    finish: vi.fn(),
    workspace: vi.fn(async () => undefined),
  };
  const controller = new ExternalFileChangeController({
    fileIdentity: vi.fn(async () => tab.fileIdentity),
    findTabsByIdentity: () => [tab],
    classify: ({ content }) =>
      content === '# disk'
        ? 'matches-baseline'
        : content === '# clean'
          ? 'reload-clean-document'
          : content === '# reappeared'
            ? 'reappeared'
            : 'create-conflict',
    handleWorkspaceChange: calls.workspace,
    preserveUnavailable: calls.preserve,
    beginExternalChange: calls.begin,
    clearExternalConflict: calls.clear,
    setExternalChangeIgnored: calls.ignored,
    setReappeared: calls.reappeared,
    reloadCleanDocument: calls.reload,
    createConflict: calls.conflict,
    isActive: () => true,
    onReloaded: calls.reloaded,
    finish: calls.finish,
  });
  return { controller, calls };
}

describe('ExternalFileChangeController', () => {
  it('preserves unavailable documents and completes the shared UI transaction', async () => {
    const f = fixture();
    await f.controller.handle({ event: 'unlink', path: '/notes/one.md', scope: 'document' });
    expect(f.calls.preserve).toHaveBeenCalledWith(tab, 'deleted', '/notes/one.md');
    expect(f.calls.finish).toHaveBeenCalledOnce();
  });

  it('routes stable content to baseline clear, clean reload, reappearance, or explicit conflict', async () => {
    const f = fixture();
    await f.controller.handle({
      event: 'change',
      path: '/notes/one.md',
      scope: 'document',
      content: '# disk',
    });
    await f.controller.handle({
      event: 'change',
      path: '/notes/one.md',
      scope: 'document',
      content: '# clean',
    });
    await f.controller.handle({
      event: 'change',
      path: '/notes/one.md',
      scope: 'document',
      content: '# reappeared',
    });
    await f.controller.handle({
      event: 'change',
      path: '/notes/one.md',
      scope: 'document',
      content: '# conflict',
    });
    expect(f.calls.clear).toHaveBeenCalled();
    expect(f.calls.reload).toHaveBeenCalledWith(tab, '# clean', 'utf-8');
    expect(f.calls.reloaded).toHaveBeenCalledWith(tab);
    expect(f.calls.reappeared).toHaveBeenCalledWith(
      tab,
      expect.objectContaining({ content: '# reappeared' }),
    );
    expect(f.calls.begin).toHaveBeenCalledTimes(2);
    expect(f.calls.conflict).toHaveBeenCalledWith(
      tab,
      expect.objectContaining({ content: '# conflict' }),
    );
  });

  it('delegates workspace changes and ignores unsupported watcher events', async () => {
    const f = fixture();
    await f.controller.handle({ event: 'change', path: '/notes', scope: 'workspace' });
    await f.controller.handle({ event: 'rename', path: '/notes', scope: 'workspace' });
    expect(f.calls.workspace).toHaveBeenCalledTimes(1);
    expect(f.calls.finish).not.toHaveBeenCalled();
  });
});
