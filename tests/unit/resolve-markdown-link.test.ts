import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRelativeMarkdownLink } from '../../src/main/resolve-markdown-link';

describe('relative Markdown link resolution', () => {
  let root: string;
  let sourceFile: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-markdown-link-'));
    const notes = path.join(root, 'notes');
    fs.mkdirSync(notes);
    sourceFile = path.join(notes, 'current.md');
    fs.writeFileSync(sourceFile, '# Current');
    fs.writeFileSync(path.join(root, 'target.md'), '# Target');
    fs.writeFileSync(path.join(notes, 'second note.markdown'), '# Second');
    fs.writeFileSync(path.join(notes, 'unsupported.txt'), 'text');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('resolves parent paths, percent encoding, and fragments to canonical Markdown files', () => {
    expect(resolveRelativeMarkdownLink(sourceFile, '../target.md#target')).toEqual({
      kind: 'resolved',
      filePath: fs.realpathSync(path.join(root, 'target.md')),
      fragment: 'target',
    });
    expect(
      resolveRelativeMarkdownLink(sourceFile, 'second%20note.markdown#next%20section'),
    ).toEqual({
      kind: 'resolved',
      filePath: fs.realpathSync(path.join(root, 'notes', 'second note.markdown')),
      fragment: 'next%20section',
    });
  });

  it('rejects missing, non-Markdown, absolute, protocol, and malformed targets', () => {
    expect(resolveRelativeMarkdownLink(sourceFile, 'missing.md')).toEqual({
      kind: 'error',
      code: 'not-found',
    });
    expect(resolveRelativeMarkdownLink(sourceFile, 'unsupported.txt')).toEqual({
      kind: 'error',
      code: 'unsupported-target',
    });
    expect(resolveRelativeMarkdownLink(sourceFile, '/tmp/target.md')).toEqual({
      kind: 'error',
      code: 'invalid-link',
    });
    expect(resolveRelativeMarkdownLink(sourceFile, 'file:///tmp/target.md')).toEqual({
      kind: 'error',
      code: 'invalid-link',
    });
    expect(resolveRelativeMarkdownLink(sourceFile, 'second%ZZ.md')).toEqual({
      kind: 'error',
      code: 'invalid-link',
    });
  });

  it('uses the platform path implementation for Windows relative paths', () => {
    const files = new Set(['C:\\notes\\current.md', 'C:\\target.mkd']);
    const fsApi = {
      realpathSync: (filePath: string) => filePath,
      statSync: (filePath: string) => ({ isFile: () => files.has(filePath) }),
    };
    expect(
      resolveRelativeMarkdownLink('C:\\notes\\current.md', '..\\target.mkd#target', {
        fsApi,
        pathApi: path.win32,
      }),
    ).toEqual({ kind: 'resolved', filePath: 'C:\\target.mkd', fragment: 'target' });
  });
});
