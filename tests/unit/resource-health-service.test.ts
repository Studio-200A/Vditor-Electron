import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractLocalReferences,
  RESOURCE_HEALTH_LIMITS,
  ResourceHealthService,
} from '../../src/main/services/resource-health-service';

const temporaryRoots: string[] = [];
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-resource-health-'));
  temporaryRoots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string | Buffer = ''): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('resource health service', () => {
  it('extracts local Markdown and HTML references without reading code', () => {
    const references = extractLocalReferences(
      [
        '![one](assets/one.png)',
        '[two]: <assets/two.webp>',
        '<img src="assets/three.jpg">',
        '`![not](assets/code.png)`',
        '``![also-not](assets/double-code.png)``',
        '```![still-not](assets/triple-code.png)```',
        '```md',
        '![not](assets/fenced.png)',
        '```',
      ].join('\n'),
    );

    expect(references.map((reference) => reference.source)).toEqual([
      'assets/one.png',
      'assets/two.webp',
      'assets/three.jpg',
    ]);
  });

  it('extracts every supported HTML image reference without splitting direct URLs', () => {
    const references = extractLocalReferences(
      '<img src="assets/with,comma.png" srcset="assets/one.png 1x, assets/two.png 2x"><video poster="assets/poster.png"><svg><image href="assets/vector.png"></image></svg>',
    );

    expect(references.map((reference) => reference.source)).toEqual([
      'assets/with,comma.png',
      'assets/one.png',
      'assets/two.png',
      'assets/poster.png',
      'assets/vector.png',
    ]);
  });

  it('decodes HTML character references before resolving local resources', () => {
    expect(extractLocalReferences('<img src="assets/used&#46;png">')).toEqual([
      expect.objectContaining({ source: 'assets/used.png', raw: 'assets/used&#46;png' }),
    ]);
  });

  it('treats unsupported HTML entities as an incomplete scan instead of risking cleanup', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '<img src="assets&sol;used.png">');
    write(root, 'notes/assets/used.png', PNG_HEADER);
    write(root, 'notes/assets/orphan.png', PNG_HEADER);

    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(false);
    expect(result.limitations.skipped.unparseable).toBe(1);
    expect(result.candidates).toEqual([]);
  });

  it('parses a quoted HTML resource attribute containing a greater-than character', () => {
    expect(extractLocalReferences('<img src="assets/used.png?value=>">')).toEqual([
      expect.objectContaining({ source: 'assets/used.png' }),
    ]);
  });

  it('keeps locations aligned with the original source after fenced code', () => {
    const references = extractLocalReferences(
      ['```md', '![ignored](assets/ignored.png)', '```', '', '![used](assets/used.png)'].join('\n'),
    );

    expect(references).toEqual([
      expect.objectContaining({ source: 'assets/used.png', line: 5, column: 9 }),
    ]);
  });

  it('ignores escaped Markdown links', () => {
    expect(extractLocalReferences('\\![literal](assets/not-a-reference.png)')).toEqual([]);
  });

  it('normalizes encoded Markdown destinations and reference definitions with query fragments', () => {
    const references = extractLocalReferences(
      [
        '![encoded](assets/space%20image.png?cache=1#preview)',
        '![reference][shared]',
        '[shared]: <assets/shared.webp?version=2#image>',
      ].join('\n'),
    );

    expect(references.map((reference) => reference.source)).toEqual([
      'assets/space image.png',
      'assets/shared.webp',
    ]);
  });

  it('keeps workspace-referenced images out of candidates and reports missing current-document images', async () => {
    const root = workspace();
    const documentPath = write(
      root,
      'notes/current.md',
      '![used](assets/shared.png)\n![missing](assets/missing.png)',
    );
    write(root, 'notes/other.md', '![also used](assets/shared.png)');
    write(root, 'notes/assets/shared.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write(root, 'notes/assets/orphan.webp', Buffer.from('RIFF\0\0\0\0WEBP'));
    const service = new ResourceHealthService();

    const result = await service.scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(true);
    expect(result.workspaceName).toBe(path.basename(root));
    expect(result.imageDirectoryRelativePath).toBe('notes/assets');
    expect(result.candidates.map((candidate) => candidate.relativePath)).toEqual([
      'notes/assets/orphan.webp',
    ]);
    expect(result.missingReferences).toEqual([
      expect.objectContaining({
        targetPath: 'notes/assets/missing.png',
        source: 'assets/missing.png',
        locations: [expect.objectContaining({ raw: '![missing](assets/missing.png)' })],
      }),
    ]);
  });

  it('keeps images referenced by hidden workspace documents out of candidates', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, '.notes/reference.md', '![used](../notes/assets/used.png)');
    write(root, 'notes/assets/used.png', PNG_HEADER);

    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.candidates).toEqual([]);
  });

  it('skips VCS metadata while still scanning hidden workspace documents', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, '.notes/reference.md', '![used](../notes/assets/used.png)');
    write(root, '.git/large.md', Buffer.alloc(RESOURCE_HEALTH_LIMITS.maximumSourceFileBytes + 1));
    write(root, 'notes/assets/used.png', PNG_HEADER);

    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it('does not report remote, data, or workspace-external current-document references as missing', async () => {
    const root = workspace();
    const documentPath = write(
      root,
      'notes/current.md',
      [
        '![missing](assets/missing.png)',
        '![remote](https://example.test/missing.png)',
        '![data](data:image/png;base64,AAAA)',
        '![outside](../../outside.png)',
      ].join('\n'),
    );

    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.missingReferences).toEqual([
      expect.objectContaining({ targetPath: 'notes/assets/missing.png' }),
    ]);
  });

  it('treats unsupported SVG as neither a missing image nor a cleanup candidate', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '![vector](assets/vector.svg)');
    write(root, 'notes/assets/vector.svg', '<svg/>');
    const service = new ResourceHealthService();

    const result = await service.scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.candidates).toEqual([]);
    expect(result.missingReferences).toEqual([]);
  });

  it('uses the configured image directory and includes SVG only when enabled', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, 'notes/media/orphan.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    write(root, 'notes/assets/ignored.png', PNG_HEADER);

    const disabled = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './media',
      allowSvgImages: false,
    });
    const enabled = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './media',
      allowSvgImages: true,
    });

    expect(disabled.candidates).toEqual([]);
    expect(enabled.imageDirectoryRelativePath).toBe('notes/media');
    expect(enabled.candidates.map((candidate) => candidate.relativePath)).toEqual([
      'notes/media/orphan.svg',
    ]);
  });

  it('does not offer a renamed non-image file as a cleanup candidate', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, 'notes/assets/not-an-image.png', 'plain text');
    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.candidates).toEqual([]);
  });

  it('returns a read-only incomplete result when a workspace source file exceeds its limit', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, 'large.md', Buffer.alloc(RESOURCE_HEALTH_LIMITS.maximumSourceFileBytes + 1));

    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(false);
    expect(result.limitations.skipped['source-file-too-large']).toBe(1);
  });

  it('keeps an oversized image candidate but marks its preview unavailable', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    const imagePath = write(root, 'notes/assets/large.png', PNG_HEADER);
    fs.truncateSync(imagePath, RESOURCE_HEALTH_LIMITS.previewMaximumBytes + 1);

    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ relativePath: 'notes/assets/large.png', previewAvailable: false }),
    ]);
  });

  it('limits cleanup candidates to direct image-directory files', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, 'notes/assets/direct.png', PNG_HEADER);
    write(root, 'notes/assets/nested/deep.png', PNG_HEADER);

    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(true);
    expect(result.candidates.map((candidate) => candidate.relativePath)).toEqual([
      'notes/assets/direct.png',
    ]);
  });

  it('blocks trash when a newly added reference protects a former candidate', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, 'notes/assets/orphan.png', PNG_HEADER);
    const service = new ResourceHealthService();
    const result = await service.scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });
    const candidate = result.candidates[0];
    write(root, 'notes/other.md', '![now used](assets/orphan.png)');
    const trash = async (filePath: string): Promise<void> => fs.promises.rm(filePath);

    await expect(service.trashCandidates(result.revision, [candidate.id], trash)).resolves.toEqual([
      { id: candidate.id, code: 'revalidated-as-referenced' },
    ]);
    expect(fs.existsSync(path.join(root, 'notes/assets/orphan.png'))).toBe(true);
  });

  it('trashes only the explicitly selected current candidate', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    const selectedPath = write(root, 'notes/assets/selected.png', PNG_HEADER);
    const untouchedPath = write(root, 'notes/assets/untouched.png', PNG_HEADER);
    const service = new ResourceHealthService();
    const result = await service.scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });
    const selected = result.candidates.find((candidate) => candidate.name === 'selected.png');
    if (!selected) throw new Error('Selected fixture image was not scanned.');
    const trashedPaths: string[] = [];

    await expect(
      service.trashCandidates(result.revision, [selected.id], async (filePath) => {
        trashedPaths.push(filePath);
        await fs.promises.rm(filePath);
      }),
    ).resolves.toEqual([{ id: selected.id, code: 'trashed' }]);

    expect(trashedPaths).toEqual([selectedPath]);
    expect(fs.existsSync(selectedPath)).toBe(false);
    expect(fs.existsSync(untouchedPath)).toBe(true);
  });

  it('expires a prior revision when a newer scan completes', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '# Current');
    write(root, 'notes/assets/orphan.png', PNG_HEADER);
    const service = new ResourceHealthService();
    const first = await service.scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });
    const second = await service.scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(service.resolveCandidate(first.revision, first.candidates[0].id)).toBeNull();
    expect(service.resolveCandidate(second.revision, second.candidates[0].id)).not.toBeNull();
  });

  it('blocks trash when a document contains an ambiguous Markdown destination', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '![ambiguous](assets/(name).png)');
    write(root, 'notes/assets/orphan.png', PNG_HEADER);
    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(false);
    expect(result.limitations.skipped.unparseable).toBe(1);
  });

  it('blocks trash when a srcset value cannot be safely parsed', async () => {
    const root = workspace();
    const documentPath = write(
      root,
      'notes/current.md',
      '<source srcset="assets/(ambiguous).png 1x, assets/other.png 2x">',
    );
    write(root, 'notes/assets/orphan.png', PNG_HEADER);
    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(false);
    expect(result.limitations.skipped.unparseable).toBe(1);
  });

  it('blocks trash for unquoted ambiguous srcset values and nested Markdown labels', async () => {
    const root = workspace();
    const documentPath = write(
      root,
      'notes/current.md',
      '<img srcset=assets/(ambiguous).png>\n![alt [nested]](assets/used.png)',
    );
    write(root, 'notes/assets/orphan.png', PNG_HEADER);
    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(false);
    expect(result.limitations.skipped.unparseable).toBe(1);
  });

  it('blocks trash when a local reference cannot be URL-decoded', async () => {
    const root = workspace();
    const documentPath = write(root, 'notes/current.md', '![broken](assets/%E0%A4.png)');
    write(root, 'notes/assets/orphan.png', PNG_HEADER);
    const result = await new ResourceHealthService().scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });

    expect(result.limitations.complete).toBe(false);
    expect(result.limitations.skipped.unparseable).toBe(1);
    expect(result.candidates).toEqual([]);
  });

  it('requires a canonical regular document inside its workspace and keeps absolute paths private', async () => {
    const root = workspace();
    const outsideRoot = workspace();
    const documentPath = write(root, 'note.md', '# Note');
    const service = new ResourceHealthService();

    await expect(
      service.scan({
        documentPath,
        workspacePath: outsideRoot,
        pasteImagesDir: './assets',
        allowSvgImages: false,
      }),
    ).rejects.toThrow('Document must belong to workspace');

    const result = await service.scan({
      documentPath,
      workspacePath: root,
      pasteImagesDir: './assets',
      allowSvgImages: false,
    });
    expect(result).not.toHaveProperty('documentPath');
    expect(result).not.toHaveProperty('workspacePath');
  });

  it('reports eligibility only for an existing regular document in its workspace', async () => {
    const root = workspace();
    const outsideRoot = workspace();
    const documentPath = write(root, 'note.md', '# Note');
    const service = new ResourceHealthService();

    await expect(service.isEligible({ documentPath, workspacePath: root })).resolves.toBe(true);
    await expect(service.isEligible({ documentPath, workspacePath: outsideRoot })).resolves.toBe(
      false,
    );
    await expect(
      service.isEligible({ documentPath: path.join(root, 'missing.md'), workspacePath: root }),
    ).resolves.toBe(false);
    await expect(service.isEligible({ documentPath, workspacePath: documentPath })).resolves.toBe(
      false,
    );
  });

  it.runIf(process.platform !== 'win32')(
    'keeps the menu eligible but does not scan through a symbolic-link workspace root',
    async () => {
      const root = workspace();
      write(root, 'notes/current.md', '# Current');
      const linkedWorkspace = `${root}-link`;
      fs.symlinkSync(root, linkedWorkspace, 'dir');
      temporaryRoots.push(linkedWorkspace);
      const service = new ResourceHealthService();

      await expect(
        service.isEligible({
          documentPath: path.join(linkedWorkspace, 'notes/current.md'),
          workspacePath: linkedWorkspace,
        }),
      ).resolves.toBe(true);
      await expect(
        service.scan({
          documentPath: path.join(linkedWorkspace, 'notes/current.md'),
          workspacePath: linkedWorkspace,
          pasteImagesDir: './assets',
          allowSvgImages: false,
        }),
      ).resolves.toEqual({ unavailableReason: 'workspace-symbolic-link' });
    },
  );

  it.runIf(process.platform !== 'win32')(
    'rejects an image directory that traverses a symbolic link',
    async () => {
      const root = workspace();
      const outsideRoot = workspace();
      const documentPath = write(root, 'notes/current.md', '# Current');
      const outsideAssets = path.join(outsideRoot, 'assets');
      fs.mkdirSync(outsideAssets);
      write(outsideRoot, 'assets/orphan.png', PNG_HEADER);
      fs.symlinkSync(outsideAssets, path.join(root, 'notes/assets'), 'dir');

      await expect(
        new ResourceHealthService().scan({
          documentPath,
          workspacePath: root,
          pasteImagesDir: './assets',
          allowSvgImages: false,
        }),
      ).rejects.toThrow('Image directory must not include symbolic links');
      await expect(
        new ResourceHealthService().isEligible({ documentPath, workspacePath: root }),
      ).resolves.toBe(true);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'marks the scan incomplete and excludes direct symbolic links from candidates',
    async () => {
      const root = workspace();
      const outsideRoot = workspace();
      const documentPath = write(root, 'notes/current.md', '# Current');
      const originalPath = write(outsideRoot, 'original.png', PNG_HEADER);
      write(root, 'notes/assets/direct.png', PNG_HEADER);
      fs.symlinkSync(originalPath, path.join(root, 'notes/assets/linked.png'), 'file');

      const result = await new ResourceHealthService().scan({
        documentPath,
        workspacePath: root,
        pasteImagesDir: './assets',
        allowSvgImages: false,
      });

      expect(result.limitations.complete).toBe(false);
      expect(result.limitations.skipped['symbolic-link']).toBe(1);
      expect(result.candidates.map((candidate) => candidate.name)).not.toContain('linked.png');
    },
  );
});
