import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileManagerService } from '../../src/main/services/file-manager';

describe('FileManagerService', () => {
  let root: string;
  let service: FileManagerService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-file-manager-'));
    service = new FileManagerService();
  });

  afterEach(() => {
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

  it('renames and moves items', async () => {
    const original = path.join(root, 'old.md');
    const destinationDir = path.join(root, 'archive');
    fs.writeFileSync(original, 'content');
    fs.mkdirSync(destinationDir);

    const renamed = await service.renameItem(original, 'new.md');
    await expect(service.moveItem(renamed, destinationDir)).resolves.toBe(
      path.join(destinationDir, 'new.md'),
    );
  });

  it('writes image bytes without text conversion', async () => {
    const filePath = path.join(root, 'assets', 'pixel.png');
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await service.writeBinaryFile(filePath, bytes);

    expect(fs.readFileSync(filePath)).toEqual(Buffer.from(bytes));
  });
});
