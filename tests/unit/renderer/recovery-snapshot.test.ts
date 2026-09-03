import { describe, expect, it } from 'vitest';
import {
  fromRecoveryStoreSnapshot,
  toRecoveryStoreSnapshot,
} from '../../../src/renderer/documents/recovery-snapshot';

describe('toRecoveryStoreSnapshot', () => {
  it('projects only the RecoveryStore IPC schema fields', () => {
    const snapshot = toRecoveryStoreSnapshot(
      {
        recoverySnapshotId: '12345678',
        filePath: '/notes/example.md',
        title: 'example.md',
        content: '# Current',
        savedContent: '# Saved',
        expectedSavedContent: '# Saved',
        encoding: 'utf-8',
        lineEnding: 'LF',
        mode: 'sv',
      },
      123,
    );

    expect(snapshot).toEqual({
      schemaVersion: 2,
      id: '12345678',
      filePath: '/notes/example.md',
      title: 'example.md',
      content: '# Current',
      savedContent: '# Saved',
      expectedSavedContent: '# Saved',
      encoding: 'utf-8',
      lineEnding: 'LF',
      mode: 'sv',
      updatedAt: 123,
    });
    expect(snapshot).not.toHaveProperty('runtime');
  });

  it('rejects malformed recovery IPC payloads', () => {
    expect(fromRecoveryStoreSnapshot({ schemaVersion: 2 })).toBeNull();
    expect(
      fromRecoveryStoreSnapshot({
        schemaVersion: 2,
        id: '12345678',
        filePath: null,
        title: 'Recovered',
        content: 'Current',
        savedContent: 'Saved',
        expectedSavedContent: 'Saved',
        encoding: 'utf-8',
        lineEnding: 'LF',
        mode: 'wysiwyg',
        updatedAt: 1,
        diskState: 'unchanged',
      }),
    ).toMatchObject({ id: '12345678', diskState: 'unchanged' });
  });
});
