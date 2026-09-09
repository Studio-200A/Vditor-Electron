// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ExportHtmlBuilder } from '../../../src/renderer/export/export-html';

function createBuilder(fetchImpl: typeof fetch = vi.fn()) {
  return new ExportHtmlBuilder({
    adapter: {
      withOriginalImageSources: (_host, callback) => callback(),
      relativeSourceFromLocalUrl: (source, target) => `relative:${source}:${target}`,
    },
    createLocalResourceBase: (baseDir) =>
      baseDir ? `local-file://root/${baseDir.replace(/^\//, '')}/` : '',
    escapeHTML: (value) => value.replace(/</g, '&lt;'),
    stripExtension: (value) => value.replace(/\.md$/, ''),
    fetch: fetchImpl,
  });
}

const document = {
  title: 'Notes.md',
  baseDir: '/notes',
  content: '<source>',
  host: globalThis.document.body,
  vditor: null,
};

describe('ExportHtmlBuilder', () => {
  it('uses Vditor HTML with original image sources or safely falls back to text content', () => {
    const builder = createBuilder();
    expect(builder.snapshotBody(document)).toBe('<pre>&lt;source></pre>');
    const getHTML = vi.fn(() => '<img src="relative.png">');
    expect(builder.snapshotBody({ ...document, vditor: { getHTML } })).toBe(
      '<img src="relative.png">',
    );
    expect(getHTML).toHaveBeenCalledOnce();
  });

  it('removes application URLs and makes local source attributes portable', () => {
    const builder = createBuilder();
    const output = builder.normalizeBody(
      '<img src="local-file://root/notes/a.png" srcset="local-file://root/notes/a.png 1x, app://app/blocked.png 2x"><a href="app://app/index.html">blocked</a><video poster="#fragment"></video>',
      document,
      '/output',
    );
    expect(output).toContain(
      'src="relative:local-file://root/notes/a.png:local-file://root/output/"',
    );
    expect(output).toContain(
      'srcset="relative:local-file://root/notes/a.png:local-file://root/output/ 1x"',
    );
    expect(output).not.toContain('app://');
    expect(output).toContain('poster="#fragment"');
  });

  it('keeps non-local resources and removes local references when an output root is unavailable', () => {
    const builder = createBuilder();
    expect(
      builder.normalizeBody(
        '<img src="https://example.test/a.png"><img src="local-file://root/a.png">',
        document,
        '',
      ),
    ).toBe('<img src="https://example.test/a.png"><img>');
  });

  it('embeds readable local PDF images and leaves failed resources relative', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const builder = createBuilder(fetch);
    await expect(
      builder.embedImages('<img src="photo.png"><img src="https://example.test/x.png">', document),
    ).resolves.toBe('<img src="data:image/png;base64,AQID"><img src="https://example.test/x.png">');
    expect(fetch).toHaveBeenCalledWith('local-file://root/notes/photo.png');
    const failing = createBuilder(
      vi.fn(async () => {
        throw new Error('unreadable');
      }),
    );
    await expect(failing.embedImages('<img src="photo.svg">', document)).resolves.toBe(
      '<img src="photo.svg">',
    );
  });

  it('normalizes again when producing a standalone HTML document', () => {
    const builder = createBuilder();
    expect(
      builder.makeHTML(document, '<img src="local-file://root/notes/a.png">', '/output'),
    ).toContain('<title>Notes</title>');
    expect(
      builder.makeHTML(document, '<img src="local-file://root/notes/a.png">', '/output'),
    ).toContain('relative:local-file://root/notes/a.png:local-file://root/output/');
  });
});
