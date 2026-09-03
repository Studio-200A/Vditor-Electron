/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AppStore } from '../../../../src/renderer/state/store';
import type {
  DocumentTab,
  DocumentState,
  EditorRuntime,
} from '../../../../src/renderer/state/types';
import type { AppSettings } from '../../../../src/renderer/state/types';

function createMockRuntime(overrides: Partial<EditorRuntime> = {}): EditorRuntime {
  return {
    vditor: null,
    ready: false,
    host: document.createElement('section'),
    toolbar: null,
    saveTimer: null,
    lineObserver: null,
    lineResizeObserver: null,
    lineNumberFrame: null,
    whitespaceFrame: null,
    bottomSpacerObserver: null,
    outlineCollapsed: new Set(),
    outlineObserver: null,
    resourceObserver: null,
    modeShortcutCleanup: null,
    splitResizer: null,
    recoveryTimer: null,
    recoveryOperation: Promise.resolve(),
    pendingAnchor: '',
    pendingEditorContent: false,
    tableCompositionScrollCleanup: null,
    ...overrides,
  };
}

function createMockDocument(overrides: Partial<DocumentState> = {}): DocumentState {
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

function createMockDocumentTab(overrides: Partial<DocumentTab> = {}): DocumentTab {
  const state = createMockDocument(overrides);
  return {
    ...state,
    runtime: createMockRuntime(),
  };
}

describe('AppStore', () => {
  let store: AppStore;

  beforeEach(() => {
    store = new AppStore();
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const state = store.getState();
      expect(state.documents).toEqual([]);
      expect(state.activeDocumentId).toBeNull();
      expect(state.workspacePath).toBe('');
      expect(state.locale).toBe('en_US');
    });

    it('should accept initial state overrides', () => {
      const customStore = new AppStore({
        workspacePath: '/custom/path',
        locale: 'zh_Hans',
      });
      const state = customStore.getState();
      expect(state.workspacePath).toBe('/custom/path');
      expect(state.locale).toBe('zh_Hans');
    });
  });

  describe('document operations', () => {
    it('should add a document', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);

      const state = store.getState();
      expect(state.documents).toHaveLength(1);
      expect(state.documents[0].id).toBe(doc.id);
    });

    it('should remove a document', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.removeDocument(doc.id);

      const state = store.getState();
      expect(state.documents).toHaveLength(0);
    });

    it('should clear activeDocumentId when removing active document', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.activateDocument(doc.id);
      store.removeDocument(doc.id);

      const state = store.getState();
      expect(state.activeDocumentId).toBeNull();
    });

    it('should activate a document', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.activateDocument(doc.id);

      const state = store.getState();
      expect(state.activeDocumentId).toBe(doc.id);
    });

    it('should not activate non-existent document', () => {
      store.activateDocument('non-existent');

      const state = store.getState();
      expect(state.activeDocumentId).toBeNull();
    });

    it('sets and clears the active document through a controlled command', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.setActiveDocument(doc.id);
      expect(store.getState().activeDocumentId).toBe(doc.id);

      store.setActiveDocument(null);
      expect(store.getState().activeDocumentId).toBeNull();
    });

    it('moves a document without changing active ownership', () => {
      const first = createMockDocumentTab({ id: 'first' });
      const second = createMockDocumentTab({ id: 'second' });
      const third = createMockDocumentTab({ id: 'third' });
      store.addDocument(first);
      store.addDocument(second);
      store.addDocument(third);
      store.activateDocument(second.id);

      store.moveDocument(third.id, first.id, false);
      expect(store.getState().documents.map((document) => document.id)).toEqual([
        'third',
        'first',
        'second',
      ]);
      expect(store.getState().activeDocumentId).toBe(second.id);
    });

    it('should update document state', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.updateDocument(doc.id, { title: 'Updated Title' });

      const updated = store.getDocument(doc.id);
      expect(updated?.title).toBe('Updated Title');
    });

    it('should update document runtime', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.updateDocumentRuntime(doc.id, { ready: true });

      const updated = store.getDocument(doc.id);
      expect(updated?.runtime.ready).toBe(true);
    });

    it('should get active document', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.activateDocument(doc.id);

      const active = store.getActiveDocument();
      expect(active?.id).toBe(doc.id);
    });

    it('should return null when no active document', () => {
      const active = store.getActiveDocument();
      expect(active).toBeNull();
    });
  });

  describe('settings operations', () => {
    it('should update settings', () => {
      const settings = { editMode: 'ir' } as AppSettings;
      store.updateSettings(settings);

      const state = store.getState();
      expect(state.settings).toBe(settings);
    });

    it('should update default settings', () => {
      const settings = { editMode: 'sv' } as AppSettings;
      store.updateDefaultSettings(settings);

      const state = store.getState();
      expect(state.defaultSettings).toBe(settings);
    });
  });

  describe('locale operations', () => {
    it('should update locale', () => {
      store.updateLocale('zh_Hant');

      const state = store.getState();
      expect(state.locale).toBe('zh_Hant');
    });
  });

  describe('workspace operations', () => {
    it('should update workspace path and increment revision', () => {
      store.updateWorkspacePath('/new/workspace');

      const state = store.getState();
      expect(state.workspacePath).toBe('/new/workspace');
      expect(state.workspaceRevision).toBe(1);
    });

    it('should increment workspace revision', () => {
      store.incrementWorkspaceRevision();
      store.incrementWorkspaceRevision();

      const state = store.getState();
      expect(state.workspaceRevision).toBe(2);
    });
  });

  describe('toolbar preview operations', () => {
    it('should set toolbar preview', () => {
      const preview = createMockDocumentTab({ id: 'preview' });
      store.setToolbarPreview(preview);

      const state = store.getState();
      expect(state.toolbarPreview?.id).toBe('preview');
    });

    it('should clear toolbar preview', () => {
      const preview = createMockDocumentTab({ id: 'preview' });
      store.setToolbarPreview(preview);
      store.setToolbarPreview(null);

      const state = store.getState();
      expect(state.toolbarPreview).toBeNull();
    });
  });

  describe('untitled counter operations', () => {
    it('should increment untitled file counter', () => {
      const count = store.incrementUntitledCounter('file');
      expect(count).toBe(1);

      const count2 = store.incrementUntitledCounter('file');
      expect(count2).toBe(2);
    });

    it('should increment untitled directory counter separately', () => {
      store.incrementUntitledCounter('file');
      const dirCount = store.incrementUntitledCounter('directory');
      expect(dirCount).toBe(1);
    });

    it('should get untitled counter value', () => {
      store.incrementUntitledCounter('file');
      store.incrementUntitledCounter('file');

      const count = store.getUntitledCounter('file');
      expect(count).toBe(2);
    });
  });

  describe('content operations', () => {
    it('should update content and mark as modified', () => {
      const doc = createMockDocumentTab({ content: 'original', savedContent: 'original' });
      store.addDocument(doc);
      store.updateContent(doc.id, 'modified');

      const updated = store.getDocument(doc.id);
      expect(updated?.content).toBe('modified');
      expect(updated?.modified).toBe(true);
      expect(updated?.contentRevision).toBe(1);
    });

    it('should not mark as modified when content equals savedContent', () => {
      const doc = createMockDocumentTab({ content: 'original', savedContent: 'original' });
      store.addDocument(doc);
      store.updateContent(doc.id, 'original');

      const updated = store.getDocument(doc.id);
      expect(updated?.modified).toBe(false);
    });

    it('should mark content as saved', () => {
      const doc = createMockDocumentTab({ content: 'modified', savedContent: 'original' });
      store.addDocument(doc);
      store.updateContent(doc.id, 'modified');
      store.markContentSaved(doc.id, 'modified');

      const updated = store.getDocument(doc.id);
      expect(updated?.savedContent).toBe('modified');
      expect(updated?.modified).toBe(false);
    });
  });

  describe('external conflict operations', () => {
    it('should set external conflict', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      const conflict = { diskContent: 'disk content', detectedAt: Date.now() };
      store.setExternalConflict(doc.id, conflict);

      const updated = store.getDocument(doc.id);
      expect(updated?.externalConflict).toEqual(conflict);
    });

    it('should clear external conflict', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      const conflict = { diskContent: 'disk content', detectedAt: Date.now() };
      store.setExternalConflict(doc.id, conflict);
      store.setExternalConflict(doc.id, null);

      const updated = store.getDocument(doc.id);
      expect(updated?.externalConflict).toBeNull();
    });

    it('should set external file state', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      const fileState = { exists: true, readable: true, content: 'content' };
      store.setExternalFileState(doc.id, fileState);

      const updated = store.getDocument(doc.id);
      expect(updated?.externalFileState).toEqual(fileState);
    });

    it('should set external change ignored', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.setExternalChangeIgnored(doc.id, true);

      const updated = store.getDocument(doc.id);
      expect(updated?.externalChangeIgnored).toBe(true);
    });
  });

  describe('recovery operations', () => {
    it('should set recovery state', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      const recoveryState = {
        snapshotId: 'snapshot-1',
        content: 'recovery content',
        mode: 'wysiwyg' as const,
      };
      store.setRecoveryState(doc.id, recoveryState);

      const updated = store.getDocument(doc.id);
      expect(updated?.recoveryState).toEqual(recoveryState);
      expect(updated?.recoverySnapshotId).toBe('snapshot-1');
    });

    it('should clear recovery state', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      const recoveryState = {
        snapshotId: 'snapshot-1',
        content: 'recovery content',
        mode: 'wysiwyg' as const,
      };
      store.setRecoveryState(doc.id, recoveryState);
      store.setRecoveryState(doc.id, null);

      const updated = store.getDocument(doc.id);
      expect(updated?.recoveryState).toBeNull();
      expect(updated?.recoverySnapshotId).toBeNull();
    });

    it('should increment recovery revision', () => {
      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.incrementRecoveryRevision(doc.id);
      store.incrementRecoveryRevision(doc.id);

      const updated = store.getDocument(doc.id);
      expect(updated?.recoveryRevision).toBe(2);
    });
  });

  describe('subscriptions', () => {
    it('should notify subscribers on state change', () => {
      let notified = false;
      store.subscribe(() => {
        notified = true;
      });

      store.updateLocale('zh_Hans');
      expect(notified).toBe(true);
    });

    it('should unsubscribe correctly', () => {
      let callCount = 0;
      const unsubscribe = store.subscribe(() => {
        callCount++;
      });

      store.updateLocale('zh_Hans');
      expect(callCount).toBe(1);

      unsubscribe();
      store.updateLocale('en_US');
      expect(callCount).toBe(1);
    });

    it('should notify with selector when value changes', () => {
      let activeId: string | null = null;
      store.subscribeWithSelector(
        (state) => state.activeDocumentId,
        (value) => {
          activeId = value;
        },
      );

      const doc = createMockDocumentTab();
      store.addDocument(doc);
      store.activateDocument(doc.id);

      expect(activeId).toBe(doc.id);
    });

    it('should not notify with selector when value does not change', () => {
      let callCount = 0;
      store.subscribeWithSelector(
        (state) => state.activeDocumentId,
        () => {
          callCount++;
        },
      );

      store.updateLocale('zh_Hans');
      expect(callCount).toBe(0);
    });
  });
});
