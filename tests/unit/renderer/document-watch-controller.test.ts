import { describe, expect, it, vi } from 'vitest';
import { DocumentWatchController } from '../../../src/renderer/documents/document-watch-controller';

interface TestDocument {
  filePath: string | null;
  fileIdentity: string | null;
}

describe('DocumentWatchController', () => {
  it('releases a watcher when its document closes while watcher readiness is pending', async () => {
    const document: TestDocument = { filePath: '/notes/one.md', fileIdentity: null };
    const documents = [document];
    let releaseWatch: (() => void) | undefined;
    const unwatch = vi.fn(async () => undefined);
    const controller = new DocumentWatchController({
      getDocuments: () => documents,
      fileIdentity: async () => 'identity:one',
      watch: () => new Promise<void>((resolve) => (releaseWatch = resolve)),
      unwatch,
      updateIdentity: (item, identity) => {
        item.fileIdentity = identity;
      },
      identityOf: (item) => item.fileIdentity || item.filePath,
    });

    const watching = controller.watchDocument(document);
    await vi.waitFor(() => expect(releaseWatch).toBeDefined());
    documents.splice(0, 1);
    releaseWatch?.();
    await watching;

    expect(unwatch).toHaveBeenCalledWith('/notes/one.md', 'identity:one');
  });

  it('does not unwatch an identity still held by a document outside a suspended transition', async () => {
    const first: TestDocument = { filePath: '/notes/one.md', fileIdentity: 'identity:one' };
    const second: TestDocument = { filePath: '/notes/alias.md', fileIdentity: 'identity:one' };
    const unwatch = vi.fn(async () => undefined);
    const controller = new DocumentWatchController({
      getDocuments: () => [first, second],
      fileIdentity: async () => 'identity:one',
      watch: async () => undefined,
      unwatch,
      updateIdentity: () => undefined,
      identityOf: (item) => item.fileIdentity,
    });

    await controller.suspend([first]);
    expect(unwatch).not.toHaveBeenCalled();
  });
});
