import { describe, expect, it, vi } from 'vitest';
import {
  DocumentController,
  type OpenedDocument,
} from '../../../src/renderer/documents/document-controller';

interface TestDocument extends OpenedDocument {
  readonly content: string;
}

function createController(
  overrides: {
    readonly documents?: TestDocument[];
    readonly findDocumentByPath?: (filePath: string) => TestDocument | null;
    readonly readFile?: (filePath: string) => Promise<{ content: string; encoding: string }>;
  } = {},
) {
  const documents = overrides.documents ?? [];
  const createDocument = vi.fn((input) => {
    const document: TestDocument = {
      id: `document-${documents.length + 1}`,
      filePath: input.filePath,
      fileIdentity: input.fileIdentity,
      content: input.content,
    };
    documents.push(document);
    return document;
  });
  const onExistingDocument = vi.fn();
  const onDocumentOpened = vi.fn(async () => {});
  const onDocumentNotCreated = vi.fn(async () => {});
  const readFile = vi.fn(
    overrides.readFile ?? (async () => ({ content: '# Note', encoding: 'utf-8' })),
  );
  const controller = new DocumentController<TestDocument>({
    fileBridge: {
      fileIdentity: async (filePath) => `identity:${filePath}`,
      readFile,
      dirname: async () => '/notes',
    },
    findDocumentByIdentity: (identity) =>
      documents.find((document) => document.fileIdentity === identity) ?? null,
    findDocumentByPath: overrides.findDocumentByPath,
    prepareDocumentResources: vi.fn(async () => {}),
    createDocument,
    onExistingDocument,
    onDocumentOpened,
    onDocumentNotCreated,
    readDocumentContent: (document) => document.content,
  });
  return {
    controller,
    createDocument,
    documents,
    onDocumentNotCreated,
    onDocumentOpened,
    onExistingDocument,
    readFile,
  };
}

describe('DocumentController', () => {
  it('opens a new canonical document only after its content and resource base are available', async () => {
    const { controller, createDocument, onDocumentOpened } = createController();

    const document = await controller.openPath('/notes/one.md', false, 'heading');

    expect(document).toMatchObject({ filePath: '/notes/one.md', content: '# Note' });
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileIdentity: 'identity:/notes/one.md',
        baseDir: '/notes',
        activate: false,
        pendingAnchor: 'heading',
      }),
    );
    expect(onDocumentOpened).toHaveBeenCalledWith(document);
  });

  it('returns the existing canonical document without another disk read', async () => {
    const existing: TestDocument = {
      id: 'existing',
      filePath: '/notes/one.md',
      fileIdentity: 'identity:/notes/one.md',
      content: '# Existing',
    };
    const { controller, onExistingDocument, readFile } = createController({
      documents: [existing],
    });

    await expect(controller.openPath('/notes/one.md', true, 'section')).resolves.toBe(existing);
    expect(readFile).not.toHaveBeenCalled();
    expect(onExistingDocument).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ activate: true, pendingAnchor: 'section' }),
    );
  });

  it('creates an untitled document without consulting the file bridge', () => {
    const { controller, createDocument, readFile } = createController();

    const document = controller.createUntitled('Untitled 1');

    expect(document).toMatchObject({ filePath: null, fileIdentity: null });
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Untitled 1', content: '', activate: true }),
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reuses a path-collision document when canonical identity lookup misses', async () => {
    const existing: TestDocument = {
      id: 'untitled',
      filePath: null,
      fileIdentity: null,
      content: '# Draft',
    };
    const findDocumentByPath = vi.fn(() => existing);
    const { controller, onExistingDocument, readFile } = createController({
      documents: [existing],
      findDocumentByPath,
    });

    await expect(controller.openPath('/notes/Untitled 1.md')).resolves.toBe(existing);
    expect(findDocumentByPath).toHaveBeenCalledWith('/notes/Untitled 1.md');
    expect(readFile).not.toHaveBeenCalled();
    expect(onExistingDocument).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ filePath: '/notes/Untitled 1.md' }),
    );
  });

  it('reads content through the injected editor boundary', () => {
    const { controller, documents } = createController();
    const document = documents[0] ?? {
      id: 'one',
      filePath: null,
      fileIdentity: null,
      content: '# Current',
    };

    expect(controller.currentContent(document)).toBe('# Current');
    expect(controller.currentContent(null)).toBe('');
  });

  it('coalesces concurrent opens for the same canonical identity', async () => {
    let releaseRead: ((value: { content: string; encoding: string }) => void) | undefined;
    const readFile = () =>
      new Promise<{ content: string; encoding: string }>((resolve) => {
        releaseRead = resolve;
      });
    const { controller, createDocument } = createController({ readFile });

    const first = controller.openPath('/notes/one.md');
    const second = controller.openPath('/notes/one.md');
    await vi.waitFor(() => expect(releaseRead).toBeDefined());
    releaseRead?.({ content: '# Shared', encoding: 'utf-8' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ content: '# Shared' }),
      expect.objectContaining({ content: '# Shared' }),
    ]);
    expect(createDocument).toHaveBeenCalledTimes(1);
  });

  it('restores the resource authorization set when document creation is rejected', async () => {
    const { controller, createDocument, onDocumentNotCreated } = createController();
    createDocument.mockReturnValueOnce(null);

    await expect(controller.openPath('/notes/one.md')).resolves.toBeNull();
    expect(onDocumentNotCreated).toHaveBeenCalledOnce();
  });
});
