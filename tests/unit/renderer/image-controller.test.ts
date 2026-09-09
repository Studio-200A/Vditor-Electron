// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  ImageController,
  ImageRuntimeController,
  sanitizeImageFileName,
} from '../../../src/renderer/editor/image-controller.js';

describe('ImageController', () => {
  it('rejects uploads before the document has a file path', async () => {
    const onError = vi.fn();
    const controller = new ImageController({
      fileBridge: { dirname: vi.fn(), writeBinaryFile: vi.fn(), relative: vi.fn() },
      getAssetsDirectory: () => './assets',
      getMaximumWidth: () => 0,
      getQuality: () => 0.8,
      onError,
      formatError: String,
      saveFirstMessage: () => 'Save the document before inserting local images.',
      uploadFailedMessage: (error) => `Image save failed: ${error}`,
    });

    await expect(controller.upload({ filePath: null, vditor: null }, [])).resolves.toBe(
      'Document must be saved first',
    );
    expect(onError).toHaveBeenCalledWith('Save the document before inserting local images.');
  });

  it('writes sanitized image assets and inserts relative Markdown through Vditor', async () => {
    const insertMD = vi.fn();
    const writeBinaryFile = vi.fn();
    const controller = new ImageController({
      fileBridge: {
        dirname: vi.fn().mockResolvedValue('/notes'),
        writeBinaryFile,
        relative: vi.fn().mockResolvedValue('assets/photo_name_.png'),
      },
      getAssetsDirectory: () => './assets',
      getMaximumWidth: () => 0,
      getQuality: () => 0.8,
      onError: vi.fn(),
      formatError: String,
      saveFirstMessage: () => 'Save the document before inserting local images.',
      uploadFailedMessage: (error) => `Image save failed: ${error}`,
      getTimestamp: () => 42,
    });
    const file = new File(['image'], 'photo name?.png', { type: 'image/png' });

    await expect(
      controller.upload({ filePath: '/notes/note.md', vditor: { insertMD } }, [file]),
    ).resolves.toBeNull();
    expect(writeBinaryFile).toHaveBeenCalledWith(
      '/notes/assets/42-photo_name_.png',
      expect.any(Uint8Array),
    );
    expect(insertMD).toHaveBeenCalledWith('![photo name?.png](assets/photo_name_.png)');
  });

  it('reports bridge failures without inserting partial Markdown', async () => {
    const onError = vi.fn();
    const insertMD = vi.fn();
    const controller = new ImageController({
      fileBridge: {
        dirname: vi.fn().mockResolvedValue('/notes'),
        writeBinaryFile: vi.fn().mockRejectedValue(new Error('disk full')),
        relative: vi.fn(),
      },
      getAssetsDirectory: () => './assets',
      getMaximumWidth: () => 0,
      getQuality: () => 0.8,
      onError,
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
      saveFirstMessage: () => 'Save the document before inserting local images.',
      uploadFailedMessage: (error) => `Image save failed: ${error}`,
    });

    await expect(
      controller.upload({ filePath: '/notes/note.md', vditor: { insertMD } }, [
        new File(['image'], 'photo.png', { type: 'image/png' }),
      ]),
    ).resolves.toBe('disk full');
    expect(insertMD).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Image save failed: disk full');
  });

  it('does not insert into an editor replaced while upload I/O is pending', async () => {
    let releaseWrite!: () => void;
    const original = { insertMD: vi.fn() };
    const replacement = { insertMD: vi.fn() };
    const tab = { filePath: '/notes/note.md', vditor: original };
    const controller = new ImageController({
      fileBridge: {
        dirname: vi.fn().mockResolvedValue('/notes'),
        writeBinaryFile: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseWrite = resolve;
            }),
        ),
        relative: vi.fn().mockResolvedValue('assets/photo.png'),
      },
      getAssetsDirectory: () => './assets',
      getMaximumWidth: () => 0,
      getQuality: () => 0.8,
      onError: vi.fn(),
      formatError: String,
      saveFirstMessage: () => 'Save first',
      uploadFailedMessage: String,
    });

    const upload = controller.upload(tab, [
      new File(['image'], 'photo.png', { type: 'image/png' }),
    ]);
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf('function'));
    tab.vditor = replacement;
    releaseWrite();

    await expect(upload).resolves.toBeNull();
    expect(original.insertMD).not.toHaveBeenCalled();
    expect(replacement.insertMD).not.toHaveBeenCalled();
  });

  it('sanitizes only unsafe filename characters', () => {
    expect(sanitizeImageFileName('photo name?.png')).toBe('photo_name_.png');
  });

  it('owns relative-resource observer replacement, release, and SVG policy reload', () => {
    const firstObserver = { disconnect: vi.fn() };
    const secondObserver = { disconnect: vi.fn() };
    const observeRelativeImageSources = vi
      .fn()
      .mockReturnValueOnce(firstObserver)
      .mockReturnValueOnce(secondObserver);
    const reloadImageSources = vi.fn();
    const controller = new ImageRuntimeController({
      localResourceBase: (baseDir) => `local-file://root${baseDir}/`,
      adapter: { observeRelativeImageSources, reloadImageSources },
    });
    const first = {
      host: document.createElement('section'),
      baseDir: '/one',
      resourceObserver: null,
    };
    const second = {
      host: document.createElement('section'),
      baseDir: '/two',
      resourceObserver: null,
    };

    controller.attach(first);
    controller.attach(first);
    controller.attach(second);
    controller.reload([first, second]);
    controller.detach(first);

    expect(first.host.dataset.localResourceBase).toBe('local-file://root/one/');
    expect(observeRelativeImageSources).toHaveBeenCalledWith(first.host, 'local-file://root/one/');
    expect(firstObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(secondObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(first.resourceObserver).toBeNull();
    expect(reloadImageSources).toHaveBeenCalledWith(first.host);
    expect(reloadImageSources).toHaveBeenCalledWith(second.host);
  });
});
