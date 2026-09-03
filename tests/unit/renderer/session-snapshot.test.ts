import { describe, expect, it } from 'vitest';
import {
  fromPersistedSessionSnapshot,
  toPersistedSessionSnapshot,
} from '../../../src/renderer/documents/session-snapshot';

describe('session snapshot', () => {
  it('projects only restorable paths into settings', () => {
    expect(
      toPersistedSessionSnapshot({
        restoreWorkspace: true,
        restoreTabs: true,
        workspacePath: '/notes',
        activeFilePath: '/notes/unavailable.md',
        openFiles: ['/notes/one.md', '/notes/unavailable.md', null],
        unavailableFilePaths: new Set(['/notes/unavailable.md']),
      }),
    ).toEqual({
      schemaVersion: 1,
      workspacePath: '/notes',
      activeFilePath: null,
      openFiles: ['/notes/one.md'],
    });
  });

  it('does not persist restoration data when settings disable it', () => {
    expect(
      toPersistedSessionSnapshot({
        restoreWorkspace: false,
        restoreTabs: false,
        workspacePath: '/notes',
        activeFilePath: '/notes/one.md',
        openFiles: ['/notes/one.md'],
        unavailableFilePaths: new Set(),
      }),
    ).toEqual({ schemaVersion: 1, workspacePath: '', activeFilePath: null, openFiles: [] });
  });

  it('rejects malformed persisted settings before reopening files', () => {
    expect(fromPersistedSessionSnapshot({ workspacePath: '/notes', openFiles: [1] })).toBeNull();
    expect(
      fromPersistedSessionSnapshot({
        workspacePath: '/notes',
        activeFilePath: '/notes/one.md',
        openFiles: ['/notes/one.md'],
      }),
    ).toEqual({
      schemaVersion: 1,
      workspacePath: '/notes',
      activeFilePath: '/notes/one.md',
      openFiles: ['/notes/one.md'],
    });
  });

  it('rejects an unknown session schema before reopening files', () => {
    expect(
      fromPersistedSessionSnapshot({
        schemaVersion: 2,
        workspacePath: '/notes',
        activeFilePath: null,
        openFiles: [],
      }),
    ).toBeNull();
  });
});
