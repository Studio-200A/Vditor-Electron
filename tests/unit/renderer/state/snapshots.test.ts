import { describe, it, expect } from 'vitest';
import {
  toSessionSnapshot,
  toRecoverySnapshot,
  restoreDocumentState,
  restoreRecoveryState,
  SESSION_SNAPSHOT_VERSION,
  RECOVERY_SNAPSHOT_VERSION,
} from '../../../../src/renderer/state/snapshots';
import type { DocumentState } from '../../../../src/renderer/state/types';

function createMockDocumentState(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: 'test-doc-1',
    filePath: '/test/file.md',
    fileIdentity: 'file:///test/file.md',
    title: 'Test Document',
    content: '# Test',
    savedContent: '# Test',
    encoding: 'utf-8',
    lineEnding: 'LF',
    baseDir: '/test',
    modified: false,
    expectedSavedContent: '# Test',
    contentRevision: 0,
    mode: 'wysiwyg',
    externalConflict: null,
    externalChangeIgnored: false,
    externalFileState: null,
    recoverySnapshotId: null,
    recoveryState: null,
    recoveryRevision: 0,
    ...overrides,
  };
}

describe('snapshots', () => {
  describe('toSessionSnapshot', () => {
    it('should create a session snapshot from document state', () => {
      const doc = createMockDocumentState();
      const snapshot = toSessionSnapshot(doc);

      expect(snapshot.version).toBe(SESSION_SNAPSHOT_VERSION);
      expect(snapshot.id).toBe(doc.id);
      expect(snapshot.filePath).toBe(doc.filePath);
      expect(snapshot.fileIdentity).toBe(doc.fileIdentity);
      expect(snapshot.title).toBe(doc.title);
      expect(snapshot.content).toBe(doc.content);
      expect(snapshot.savedContent).toBe(doc.savedContent);
      expect(snapshot.encoding).toBe(doc.encoding);
      expect(snapshot.lineEnding).toBe(doc.lineEnding);
      expect(snapshot.baseDir).toBe(doc.baseDir);
      expect(snapshot.modified).toBe(doc.modified);
      expect(snapshot.expectedSavedContent).toBe(doc.expectedSavedContent);
      expect(snapshot.mode).toBe(doc.mode);
      expect(snapshot.recoverySnapshotId).toBe(doc.recoverySnapshotId);
    });

    it('should not include runtime properties', () => {
      const doc = createMockDocumentState();
      const snapshot = toSessionSnapshot(doc);

      expect((snapshot as Record<string, unknown>).runtime).toBeUndefined();
      expect((snapshot as Record<string, unknown>).vditor).toBeUndefined();
      expect((snapshot as Record<string, unknown>).host).toBeUndefined();
    });

    it('should handle null filePath and fileIdentity', () => {
      const doc = createMockDocumentState({
        filePath: null,
        fileIdentity: null,
      });
      const snapshot = toSessionSnapshot(doc);

      expect(snapshot.filePath).toBeNull();
      expect(snapshot.fileIdentity).toBeNull();
    });
  });

  describe('toRecoverySnapshot', () => {
    it('should create a recovery snapshot when recovery state exists', () => {
      const doc = createMockDocumentState({
        recoverySnapshotId: 'snapshot-1',
        recoveryState: 'unchanged',
      });
      const snapshot = toRecoverySnapshot(doc);

      expect(snapshot).not.toBeNull();
      expect(snapshot?.version).toBe(RECOVERY_SNAPSHOT_VERSION);
      expect(snapshot?.id).toBe(doc.id);
      expect(snapshot?.recoverySnapshotId).toBe('snapshot-1');
      expect(snapshot?.recoveryState).toEqual(doc.recoveryState);
    });

    it('should return null when no recovery state', () => {
      const doc = createMockDocumentState();
      const snapshot = toRecoverySnapshot(doc);

      expect(snapshot).toBeNull();
    });

    it('should reject a recovery state without a snapshot identity', () => {
      const doc = createMockDocumentState({ recoveryState: 'changed' });

      expect(toRecoverySnapshot(doc)).toBeNull();
    });
  });

  describe('restoreDocumentState', () => {
    it('should restore document state from valid session snapshot', () => {
      const doc = createMockDocumentState();
      const snapshot = toSessionSnapshot(doc);
      const restored = restoreDocumentState(snapshot);

      expect(restored).not.toBeNull();
      expect(restored?.id).toBe(doc.id);
      expect(restored?.filePath).toBe(doc.filePath);
      expect(restored?.fileIdentity).toBe(doc.fileIdentity);
      expect(restored?.title).toBe(doc.title);
      expect(restored?.content).toBe(doc.content);
      expect(restored?.savedContent).toBe(doc.savedContent);
      expect(restored?.encoding).toBe(doc.encoding);
      expect(restored?.lineEnding).toBe(doc.lineEnding);
      expect(restored?.baseDir).toBe(doc.baseDir);
      expect(restored?.modified).toBe(doc.modified);
      expect(restored?.expectedSavedContent).toBe(doc.expectedSavedContent);
      expect(restored?.mode).toBe(doc.mode);
      expect(restored?.recoverySnapshotId).toBe(doc.recoverySnapshotId);
      expect(restored?.contentRevision).toBe(0);
      expect(restored?.externalConflict).toBeNull();
      expect(restored?.externalChangeIgnored).toBe(false);
      expect(restored?.externalFileState).toBeNull();
      expect(restored?.recoveryState).toBeNull();
      expect(restored?.recoveryRevision).toBe(0);
    });

    it('should return null for invalid snapshot', () => {
      expect(restoreDocumentState(null)).toBeNull();
      expect(restoreDocumentState(undefined)).toBeNull();
      expect(restoreDocumentState({})).toBeNull();
      expect(restoreDocumentState({ version: 999 })).toBeNull();
    });

    it('should return null for snapshot with wrong version', () => {
      const doc = createMockDocumentState();
      const snapshot = toSessionSnapshot(doc);
      const invalidSnapshot = { ...snapshot, version: 999 };

      expect(restoreDocumentState(invalidSnapshot)).toBeNull();
    });

    it('should return null for snapshot with missing required fields', () => {
      const doc = createMockDocumentState();
      const snapshot = toSessionSnapshot(doc);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, ...incomplete } = snapshot;

      expect(restoreDocumentState(incomplete)).toBeNull();
    });

    it('should return null for snapshot with invalid field types', () => {
      const doc = createMockDocumentState();
      const snapshot = toSessionSnapshot(doc);
      const invalidSnapshot = { ...snapshot, id: 123 };

      expect(restoreDocumentState(invalidSnapshot)).toBeNull();
    });

    it('should restore document with null filePath', () => {
      const doc = createMockDocumentState({ filePath: null, fileIdentity: null });
      const snapshot = toSessionSnapshot(doc);
      const restored = restoreDocumentState(snapshot);

      expect(restored?.filePath).toBeNull();
      expect(restored?.fileIdentity).toBeNull();
    });
  });

  describe('restoreRecoveryState', () => {
    it('should restore recovery state from valid recovery snapshot', () => {
      const doc = createMockDocumentState({
        recoverySnapshotId: 'snapshot-1',
        recoveryState: 'changed',
      });
      const snapshot = toRecoverySnapshot(doc);
      const restored = restoreRecoveryState(snapshot);

      expect(restored).toBe('changed');
    });

    it('should return null for invalid snapshot', () => {
      expect(restoreRecoveryState(null)).toBeNull();
      expect(restoreRecoveryState(undefined)).toBeNull();
      expect(restoreRecoveryState({})).toBeNull();
    });

    it('should return null for snapshot with wrong version', () => {
      const doc = createMockDocumentState({
        recoverySnapshotId: 'snapshot-1',
        recoveryState: 'unchanged',
      });
      const snapshot = toRecoverySnapshot(doc);
      const invalidSnapshot = { ...snapshot, version: 999 };

      expect(restoreRecoveryState(invalidSnapshot)).toBeNull();
    });

    it('should return null for snapshot with invalid recovery state', () => {
      const doc = createMockDocumentState({
        recoverySnapshotId: 'snapshot-1',
        recoveryState: 'unchanged',
      });
      const snapshot = toRecoverySnapshot(doc);
      const invalidSnapshot = { ...snapshot, recoveryState: 'invalid' };

      expect(restoreRecoveryState(invalidSnapshot)).toBeNull();
    });
  });

  describe('round-trip serialization', () => {
    it('should preserve document state through session snapshot round-trip', () => {
      const original = createMockDocumentState({
        content: 'modified content',
        savedContent: 'original content',
        modified: true,
        contentRevision: 5,
      });
      const snapshot = toSessionSnapshot(original);
      const restored = restoreDocumentState(snapshot);

      expect(restored?.id).toBe(original.id);
      expect(restored?.content).toBe(original.content);
      expect(restored?.savedContent).toBe(original.savedContent);
      expect(restored?.modified).toBe(original.modified);
      // contentRevision is reset to 0 on restore
      expect(restored?.contentRevision).toBe(0);
    });

    it('should preserve recovery state through recovery snapshot round-trip', () => {
      const original = createMockDocumentState({
        recoverySnapshotId: 'snapshot-1',
        recoveryState: 'unavailable',
      });
      const snapshot = toRecoverySnapshot(original);
      const restored = restoreRecoveryState(snapshot);

      expect(restored).toBe(original.recoveryState);
    });
  });
});
