import { describe, expect, it, vi } from 'vitest';
import { ExportController } from '../../../src/renderer/export/export-controller';

describe('ExportController', () => {
  const document = { title: 'Notes.md', baseDir: '/notes' };

  it('snapshots HTML before its dialog and writes portable output after a confirmed path', async () => {
    const exportDialog = vi.fn(async () => '/output/notes.html');
    const dirname = vi.fn(async () => '/output');
    const writeFile = vi.fn(async () => undefined);
    const snapshotBody = vi.fn(() => '<img src="local-file://root/notes/image.png">');
    const controller = new ExportController({
      getActiveDocument: () => document,
      fileAPI: { exportDialog, dirname, writeFile },
      appAPI: { exportPDF: vi.fn() },
      getDefaultDirectory: () => '/notes',
      snapshotBody,
      normalizeBody: vi.fn((body) => body),
      embedImages: vi.fn(async (body) => body),
      makeHTML: vi.fn((_document, body, outputDirectory) => `${outputDirectory}:${body}`),
      defaultFileName: (_document, type) => `notes.${type}`,
      rememberConfirmedDirectory: vi.fn(async () => undefined),
      showExported: vi.fn(),
    });

    await controller.exportHTML();

    expect(snapshotBody).toHaveBeenCalledBefore(exportDialog);
    expect(writeFile).toHaveBeenCalledWith(
      '/output/notes.html',
      '/output:<img src="local-file://root/notes/image.png">',
    );
  });

  it('normalizes and embeds PDF resources before using the isolated PDF capability', async () => {
    const exportPDF = vi.fn(async () => '/output/notes.pdf');
    const normalizeBody = vi.fn((body) => body.replace('local-file:', 'relative:'));
    const embedImages = vi.fn(async (body) => body.replace('relative:', 'data:'));
    const controller = new ExportController({
      getActiveDocument: () => document,
      fileAPI: { exportDialog: vi.fn(), dirname: vi.fn(), writeFile: vi.fn() },
      appAPI: { exportPDF },
      getDefaultDirectory: () => '/notes',
      snapshotBody: () => '<img src="local-file://root/notes/image.png">',
      normalizeBody,
      embedImages,
      makeHTML: (_document, body) => `<html>${body}</html>`,
      defaultFileName: (_document, type) => `notes.${type}`,
      rememberConfirmedDirectory: vi.fn(async () => undefined),
      showExported: vi.fn(),
    });

    await controller.exportPDF();

    expect(normalizeBody).toHaveBeenCalledBefore(embedImages);
    expect(exportPDF).toHaveBeenCalledWith(
      '<html><img src="data://root/notes/image.png"></html>',
      'notes.pdf',
      '/notes',
    );
  });

  it('does not perform an export when no document is active', async () => {
    const exportDialog = vi.fn();
    const controller = new ExportController({
      getActiveDocument: () => null,
      fileAPI: { exportDialog, dirname: vi.fn(), writeFile: vi.fn() },
      appAPI: { exportPDF: vi.fn() },
      getDefaultDirectory: () => undefined,
      snapshotBody: vi.fn(),
      normalizeBody: vi.fn(),
      embedImages: vi.fn(),
      makeHTML: vi.fn(),
      defaultFileName: vi.fn(),
      rememberConfirmedDirectory: vi.fn(),
      showExported: vi.fn(),
    });

    await controller.exportHTML();
    await controller.exportPDF();
    expect(exportDialog).not.toHaveBeenCalled();
  });
});
