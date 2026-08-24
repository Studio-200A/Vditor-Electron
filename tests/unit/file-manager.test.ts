import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileManagerService } from '../../src/main/services/file-manager';

describe('FileManagerService', () => {
  let root: string;
  let service: FileManagerService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-file-manager-'));
    service = new FileManagerService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads UTF-8 text', async () => {
    const filePath = path.join(root, 'utf8.md');
    fs.writeFileSync(filePath, '# 你好', 'utf8');

    await expect(service.readFile(filePath)).resolves.toEqual({
      content: '# 你好',
      encoding: 'utf-8',
    });
  });

  it('detects and removes an UTF-8 BOM', async () => {
    const filePath = path.join(root, 'bom.md');
    fs.writeFileSync(
      filePath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('text')]),
    );

    await expect(service.readFile(filePath)).resolves.toEqual({
      content: 'text',
      encoding: 'utf-8-bom',
    });
  });

  it('falls back to GB18030 for non-UTF-8 input', async () => {
    const filePath = path.join(root, 'gb.md');
    fs.writeFileSync(filePath, Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));

    await expect(service.readFile(filePath)).resolves.toEqual({
      content: '中文',
      encoding: 'gb18030',
    });
  });

  it('creates missing parent folders when writing', async () => {
    const filePath = path.join(root, 'notes', 'nested.md');
    await service.writeFile(filePath, 'nested');

    expect(fs.readFileSync(filePath, 'utf8')).toBe('nested');
  });

  it('replaces documents through a synced sibling temporary file and preserves mode', async () => {
    const filePath = path.join(root, 'document.md');
    fs.writeFileSync(filePath, 'before', 'utf8');
    fs.chmodSync(filePath, 0o640);

    await expect(service.writeFile(filePath, 'after')).resolves.toEqual({
      expectedContent: 'after',
      wrote: true,
    });

    expect(fs.readFileSync(filePath, 'utf8')).toBe('after');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('does not replace an unchanged document', async () => {
    const filePath = path.join(root, 'unchanged.md');
    fs.writeFileSync(filePath, 'same', 'utf8');
    const before = fs.statSync(filePath).mtimeMs;

    await expect(service.writeFile(filePath, 'same')).resolves.toEqual({
      expectedContent: 'same',
      wrote: false,
    });

    expect(fs.statSync(filePath).mtimeMs).toBe(before);
  });

  it('keeps the original document when temporary creation fails', async () => {
    const filePath = path.join(root, 'write-failure.md');
    fs.writeFileSync(filePath, 'original', 'utf8');
    vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(new Error('temporary write failed'));

    await expect(service.writeFile(filePath, 'replacement')).rejects.toThrow(
      'temporary write failed',
    );

    expect(fs.readFileSync(filePath, 'utf8')).toBe('original');
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the original document and removes the temporary file when replacement fails', async () => {
    const filePath = path.join(root, 'replace-failure.md');
    fs.writeFileSync(filePath, 'original', 'utf8');
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('replacement failed'));

    await expect(service.writeFile(filePath, 'replacement')).rejects.toThrow('replacement failed');

    expect(fs.readFileSync(filePath, 'utf8')).toBe('original');
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('returns a safe user-facing result for permission failures', async () => {
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    service = new FileManagerService({
      write: async () => Promise.reject(permissionError),
    });

    await expect(
      service.writeDocument(path.join(root, 'locked.md'), 'replacement'),
    ).resolves.toEqual({
      error: 'permission-denied',
    });
  });

  it('creates files and directories inside the selected parent', async () => {
    await expect(service.createItem(root, 'note.md', 'file')).resolves.toBe(
      path.join(root, 'note.md'),
    );
    await expect(service.createItem(root, 'assets', 'directory')).resolves.toBe(
      path.join(root, 'assets'),
    );
    expect(fs.statSync(path.join(root, 'assets')).isDirectory()).toBe(true);
  });

  it('rejects names that escape the selected parent', async () => {
    await expect(service.createItem(root, '../outside.md', 'file')).rejects.toThrow(
      'must not contain a path',
    );
  });

  it('sorts directories first and names naturally', async () => {
    fs.mkdirSync(path.join(root, 'folder'));
    fs.writeFileSync(path.join(root, 'note10.md'), '');
    fs.writeFileSync(path.join(root, 'note2.md'), '');

    const entries = await service.listDir(root);
    expect(entries.map((entry) => entry.name)).toEqual(['folder', 'note2.md', 'note10.md']);
  });

  it('renames items', async () => {
    const original = path.join(root, 'old.md');
    fs.writeFileSync(original, 'content');

    await expect(service.renameItem(original, 'new.md')).resolves.toBe(path.join(root, 'new.md'));
  });

  it('writes image bytes without text conversion', async () => {
    const filePath = path.join(root, 'assets', 'pixel.png');
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await service.writeBinaryFile(filePath, bytes);

    expect(fs.readFileSync(filePath)).toEqual(Buffer.from(bytes));
  });
});
