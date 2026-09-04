/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { DocumentController } from '../../../src/renderer/documents/document-controller';
import { AppStore } from '../../../src/renderer/state/store';
import type { DocumentTab, EditorRuntime, Vditor } from '../../../src/renderer/state/types';

function createRuntime(): EditorRuntime {
  const vditor: Vditor = {
    destroy: () => undefined,
    disabled: () => undefined,
    getCurrentMode: () => 'wysiwyg',
    setTheme: () => undefined,
    setPreviewMode: () => undefined,
    getValue: () => '# Current',
    setValue: () => undefined,
    focus: () => undefined,
    blur: () => undefined,
  };
  return {
    vditor,
    ready: true,
    host: document.createElement('section'),
    toolbar: null,
    lineObserver: null,
    lineResizeObserver: null,
    lineNumberFrame: null,
    whitespaceFrame: null,
    bottomSpacerObserver: null,
    outlineCollapsed: new Set(),
    resourceObserver: null,
    splitResizer: null,
    pendingAnchor: '',
    pendingEditorContent: false,
  };
}

function createDocument(input: {
  readonly id: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly title?: string;
  readonly content: string;
  readonly encoding: string;
  readonly baseDir: string;
}): DocumentTab {
  return {
    id: input.id,
    filePath: input.filePath,
    fileIdentity: input.fileIdentity,
    title: input.title || 'note.md',
    content: input.content,
    savedContent: input.content,
    encoding: input.encoding,
    lineEnding: 'LF',
    baseDir: input.baseDir,
    modified: false,
    expectedSavedContent: input.content,
    contentRevision: 0,
    mode: 'wysiwyg',
    externalConflict: null,
    externalChangeIgnored: false,
    externalFileState: null,
    recoverySnapshotId: null,
    recoveryState: null,
    recoveryRevision: 0,
    runtime: createRuntime(),
  };
}

describe('DocumentController integration', () => {
  it('coordinates store, bridge, save, external-change, and close boundaries', async () => {
    const store = new AppStore();
    const lifecycle: string[] = [];
    let nextId = 1;
    const controller = new DocumentController<DocumentTab>({
      fileBridge: {
        fileIdentity: async (filePath) => `identity:${filePath}`,
        readFile: async () => ({ content: '# Disk', encoding: 'utf-8' }),
        dirname: async () => '/notes',
      },
      findDocumentByIdentity: (identity) =>
        store.getState().documents.find((document) => document.fileIdentity === identity) || null,
      createDocument: (input) => {
        const document = createDocument({ id: `document-${nextId++}`, ...input });
        store.addDocument(document);
        if (input.activate) store.activateDocument(document.id);
        lifecycle.push('created');
        return document;
      },
      prepareDocumentResources: async () => lifecycle.push('resources-ready'),
      onExistingDocument: () => lifecycle.push('existing'),
      onDocumentOpened: async () => lifecycle.push('opened'),
      onDocumentNotCreated: async () => lifecycle.push('creation-rejected'),
      readDocumentContent: (document) => document.runtime.vditor?.getValue() || document.content,
    });

    const document = await controller.openPath('/notes/note.md');
    expect(document).not.toBeNull();
    expect(store.getActiveDocument()).toBe(document);
    expect(controller.currentContent(document)).toBe('# Current');
    expect(lifecycle).toEqual(['resources-ready', 'created', 'opened']);

    const saveOrder: string[] = [];
    await Promise.all([
      controller.save(document!, async () => saveOrder.push('document')),
      controller.saveForIdentity(document!.fileIdentity!, async () => saveOrder.push('identity')),
    ]);
    expect(saveOrder).toEqual(['document', 'identity']);
    expect(
      controller.classifyExternalChange({
        hasUnavailableState: false,
        expectedSavedContent: '# Disk',
        modified: false,
        externalChangeIgnored: false,
        hasFilePath: true,
        content: '# Changed',
      }),
    ).toBe('reload-clean-document');

    const closeResult = await controller.close(document!, {
      confirmClose: async () => {
        lifecycle.push('confirmed');
        return true;
      },
      disposeRuntime: async () => lifecycle.push('runtime-disposed'),
      removeDocument: (closed) => {
        lifecycle.push('removed');
        store.removeDocument(closed.id);
      },
      afterClose: async () => lifecycle.push('closed'),
    });
    expect(closeResult).toBe(true);
    expect(store.getDocument(document!.id)).toBeUndefined();
    expect(lifecycle.slice(-4)).toEqual(['confirmed', 'runtime-disposed', 'removed', 'closed']);
  });
});
