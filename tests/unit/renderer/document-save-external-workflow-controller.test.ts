import { describe, expect, it, vi } from 'vitest';
import {
  DocumentSaveExternalWorkflowController,
  type DocumentSaveExternalWorkflowControllerOptions,
  type SaveWorkflowDocument,
} from '../../../src/renderer/documents/document-save-external-workflow-controller';

interface TestDocument extends SaveWorkflowDocument {
  content: string;
  savedContent: string;
  modified: boolean;
}

function createDocument(): TestDocument {
  return {
    id: 'tab-1',
    title: 'one.md',
    filePath: '/notes/one.md',
    fileIdentity: 'identity:one',
    baseDir: '/notes',
    encoding: 'utf-8',
    lineEnding: 'LF',
    expectedSavedContent: 'before',
    contentRevision: 1,
    externalChangeIgnored: false,
    externalConflict: null,
    externalFileState: null,
    content: 'after',
    savedContent: 'before',
    modified: true,
  };
}

function fixture(
  writeDocument = vi.fn(async () => ({ expectedContent: 'after' })),
  preserveUnavailable = async () => undefined,
) {
  const document = createDocument();
  const documents: TestDocument[] = [document];
  const updateDocument = vi.fn((item: TestDocument, updates: Record<string, unknown>) =>
    Object.assign(item, updates),
  );
  const writeClipboard = vi.fn(async () => undefined);
  const showMessage = vi.fn();
  const options: DocumentSaveExternalWorkflowControllerOptions<TestDocument> = {
    getDocuments: () => documents,
    getActiveDocumentId: () => document.id,
    fileIdentityOf: (item) => item.fileIdentity,
    saveDocument: async (_document, operation) => operation(),
    saveForIdentity: async (_identity, operation) => operation(),
    fileName: (filePath) => filePath.split('/').at(-1) || '',
    saveFileDialog: async () => null,
    fileIdentity: async () => document.fileIdentity,
    exists: async () => true,
    readFile: async () => ({ content: 'before', encoding: 'utf-8' }),
    writeDocument,
    dirname: async () => '/notes',
    resolveRenamedDocument: async () => null,
    reconcileRenamedDocument: async () => false,
    suspendWatches: async () => undefined,
    rebindWatches: async () => undefined,
    releaseWatch: async () => undefined,
    watchDocument: async () => undefined,
    contentForPersistence: (item) => item.content,
    currentContent: (item) => item.content,
    beginExternalChange: vi.fn(),
    cancelAutoSave: vi.fn(),
    applyExternalContent: vi.fn(),
    updateDocument,
    createConflict: vi.fn(),
    preserveUnavailable,
    discardRecovery: async () => undefined,
    clearRecoveryState: vi.fn(),
    scheduleRecovery: vi.fn(),
    syncResources: async () => undefined,
    rebuildEditor: vi.fn(),
    rememberRecent: vi.fn(),
    refreshTree: async () => undefined,
    hasWorkspace: () => false,
    nextUntitledTitle: () => 'Untitled 1',
    recreateClipboardSnapshot: (item) => item.content,
    writeClipboard,
    detectLineEnding: () => 'LF',
    confirm: async () => true,
    showMessage,
    showRecreateNotice: vi.fn(),
    finish: vi.fn(),
  };
  return {
    controller: new DocumentSaveExternalWorkflowController(options),
    document,
    documents,
    updateDocument,
    writeDocument,
    writeClipboard,
    showMessage,
  };
}

describe('DocumentSaveExternalWorkflowController', () => {
  it('writes the captured content against the saved baseline and commits the document binding', async () => {
    const f = fixture();

    await expect(f.controller.save(f.document)).resolves.toBe(true);

    expect(f.writeDocument).toHaveBeenCalledWith('/notes/one.md', 'after', 'before', false);
    expect(f.document.savedContent).toBe('after');
    expect(f.document.expectedSavedContent).toBe('after');
    expect(f.document.modified).toBe(false);
  });

  it('does not commit a safe-writer result after the document closes during I/O', async () => {
    const f = fixture();
    f.writeDocument.mockImplementation(async () => {
      f.documents.splice(0, 1);
      return { expectedContent: 'after' };
    });

    await expect(f.controller.save(f.document)).resolves.toBe(false);

    expect(f.document.savedContent).toBe('before');
    expect(f.updateDocument).not.toHaveBeenCalled();
  });

  it('copies the pre-deletion snapshot after recreating a deleted document', async () => {
    let target!: TestDocument;
    const f = fixture(undefined, async () => {
      target.externalFileState = {
        kind: 'deleted',
        path: '/notes/one.md',
        identity: target.fileIdentity,
        version: 1,
      };
    });
    target = f.document;
    f.document.content = 'Content before deletion';

    await f.controller.preserveUnavailable(f.document, 'deleted', '/notes/one.md');
    await expect(f.controller.recreateFile(f.document)).resolves.toBe(true);

    expect(f.writeClipboard).toHaveBeenCalledWith('Content before deletion');
    expect(f.showMessage).toHaveBeenCalledWith('recreated-copied', f.document);
  });
});
