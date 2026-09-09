import { describe, expect, it, vi } from 'vitest';
import { DocumentTabWorkflowController } from '../../../src/renderer/documents/document-tab-workflow-controller';
import { DocumentController } from '../../../src/renderer/documents/document-controller';

interface TestDocument {
  readonly id: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
}

function documentController(documents: TestDocument[]) {
  return new DocumentController<TestDocument>({
    fileBridge: {
      fileIdentity: async (filePath) => `identity:${filePath}`,
      readFile: async () => ({ content: '', encoding: 'utf-8' }),
      dirname: async () => '/notes',
    },
    findDocumentByIdentity: (identity) =>
      documents.find((document) => document.fileIdentity === identity) ?? null,
    createDocument: (input) => {
      const document = {
        id: `tab-${documents.length + 1}`,
        filePath: input.filePath,
        fileIdentity: input.fileIdentity,
      };
      documents.push(document);
      return document;
    },
    prepareDocumentResources: async () => undefined,
    onExistingDocument: () => undefined,
    onDocumentOpened: async () => undefined,
    onDocumentNotCreated: async () => undefined,
    readDocumentContent: () => '',
  });
}

describe('DocumentTabWorkflowController', () => {
  it('opens paths in order and activates only the final opened document', async () => {
    const documents: TestDocument[] = [];
    const activate = vi.fn();
    const workflow = new DocumentTabWorkflowController({
      documentController: documentController(documents),
      getDocuments: () => documents,
      getDocument: (id) => documents.find((document) => document.id === id) ?? null,
      getActiveDocumentId: () => null,
      createUntitledTitle: async () => 'Untitled 1',
      activate,
      reportOpenFailure: vi.fn(),
      confirmClose: async () => true,
      disposeRuntime: async () => undefined,
      removeDocument: () => undefined,
      finishClose: async () => undefined,
    });

    await workflow.openPaths(['/notes/one.md', '/notes/two.md']);

    expect(documents).toHaveLength(2);
    expect(activate).toHaveBeenCalledWith('tab-2');
  });

  it('releases runtime before removing the document and finishing close', async () => {
    const document: TestDocument = { id: 'tab-1', filePath: '/notes/one.md', fileIdentity: 'one' };
    const documents = [document];
    const order: string[] = [];
    const workflow = new DocumentTabWorkflowController({
      documentController: documentController(documents),
      getDocuments: () => documents,
      getDocument: (id) => documents.find((item) => item.id === id) ?? null,
      getActiveDocumentId: () => 'tab-1',
      createUntitledTitle: async () => 'Untitled 1',
      activate: () => undefined,
      reportOpenFailure: vi.fn(),
      confirmClose: async () => {
        order.push('confirm');
        return true;
      },
      disposeRuntime: async () => order.push('runtime'),
      removeDocument: () => {
        order.push('remove');
        documents.splice(0, 1);
      },
      finishClose: async () => order.push('finish'),
    });

    await expect(workflow.close('tab-1')).resolves.toBe(true);
    expect(order).toEqual(['confirm', 'runtime', 'remove', 'finish']);
  });
});
