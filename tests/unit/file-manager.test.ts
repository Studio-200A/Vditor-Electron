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

  it('rejects a document write when its expected disk version is stale', async () => {
    const filePath = path.join(root, 'stale.md');
    fs.writeFileSync(filePath, 'external version');

    await expect(
      service.writeDocument(filePath, 'local version', 'saved version'),
    ).resolves.toEqual({
      error: 'external-change',
      content: 'external version',
      encoding: 'utf-8',
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('external version');
  });

  it('does not launder a disk change between content decoding and safe replacement', async () => {
    const filePath = path.join(root, 'baseline-race.md');
    fs.writeFileSync(filePath, 'saved version');
    const originalReadFile = fs.promises.readFile.bind(fs.promises);
    let targetReads = 0;
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (requestedPath) => {
      const bytes = await originalReadFile(requestedPath);
      if (path.resolve(String(requestedPath)) === filePath && targetReads++ === 0)
        fs.writeFileSync(filePath, 'external version');
      return bytes;
    });

    await expect(
      service.writeDocument(filePath, 'local version', 'saved version'),
    ).resolves.toEqual({
      error: 'external-change',
      content: 'external version',
      encoding: 'utf-8',
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('external version');
  });

  it('rejects a document write when a path expected to be absent already exists', async () => {
    const filePath = path.join(root, 'claimed.md');
    fs.writeFileSync(filePath, 'external version');

    await expect(
      service.writeDocument(filePath, 'local version', undefined, true),
    ).resolves.toEqual({
      error: 'external-change',
      content: 'external version',
      encoding: 'utf-8',
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('external version');
  });

  it('creates an expected-absent document without replacing an existing file', async () => {
    const filePath = path.join(root, 'new.md');

    await expect(
      service.writeDocument(filePath, 'local version', undefined, true),
    ).resolves.toEqual({
      expectedContent: 'local version',
      wrote: true,
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('local version');
  });

  it('never overwrites an existing rename destination', async () => {
    const source = path.join(root, 'source.md');
    const destination = path.join(root, 'destination.md');
    fs.writeFileSync(source, 'source');
    fs.writeFileSync(destination, 'destination');

    await expect(service.renameItem(source, 'destination.md')).rejects.toThrow(
      'An item with that name already exists.',
    );
    expect(fs.readFileSync(source, 'utf8')).toBe('source');
    expect(fs.readFileSync(destination, 'utf8')).toBe('destination');
  });

  it('keeps a file rename source when the destination appears after preflight', async () => {
    const source = path.join(root, 'source.md');
    const destination = path.join(root, 'destination.md');
    fs.writeFileSync(source, 'source');
    const originalLstat = fs.promises.lstat;
    vi.spyOn(fs.promises, 'lstat').mockImplementation(async (filePath, options) => {
      if (path.resolve(String(filePath)) === source && !fs.existsSync(destination))
        fs.writeFileSync(destination, 'external');
      return originalLstat(filePath, options);
    });

    await expect(service.renameItem(source, 'destination.md')).rejects.toThrow(
      'An item with that name already exists.',
    );
    expect(fs.readFileSync(source, 'utf8')).toBe('source');
    expect(fs.readFileSync(destination, 'utf8')).toBe('external');
  });

  it('keeps a directory rename source when the destination appears after preflight', async () => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'entry.md'), 'source');

    class RacingFileManager extends FileManagerService {
      override async prepareRename(oldPath: string, newName: string): Promise<string> {
        const planned = await super.prepareRename(oldPath, newName);
        fs.mkdirSync(planned);
        return planned;
      }
    }
    service = new RacingFileManager();

    await expect(service.renameItem(source, 'destination')).rejects.toThrow(
      'An item with that name already exists.',
    );
    expect(fs.readFileSync(path.join(source, 'entry.md'), 'utf8')).toBe('source');
    expect(fs.statSync(destination).isDirectory()).toBe(true);
  });

  it('renames a directory when only its case changes on Linux', async () => {
    if (process.platform !== 'linux') return;
    const source = path.join(root, 'Source');
    const destination = path.join(root, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'entry.md'), 'source');

    await expect(service.renameItem(source, 'source')).resolves.toBe(destination);
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(destination, 'entry.md'), 'utf8')).toBe('source');
  });

  it('rolls back a file rename destination when removing the source fails', async () => {
    const source = path.join(root, 'source.md');
    const destination = path.join(root, 'destination.md');
    fs.writeFileSync(source, 'source');
    const originalUnlink = fs.promises.unlink;
    vi.spyOn(fs.promises, 'unlink').mockImplementation(async (filePath) => {
      if (path.resolve(String(filePath)) === source)
        throw Object.assign(new Error('source is busy'), { code: 'EBUSY' });
      return originalUnlink(filePath);
    });

    await expect(service.renameItem(source, 'destination.md')).rejects.toThrow('source is busy');
    expect(fs.readFileSync(source, 'utf8')).toBe('source');
    expect(fs.existsSync(destination)).toBe(false);
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

  it('skips entries that disappear or become inaccessible during a directory read', async () => {
    const available = path.join(root, 'available.md');
    const unavailable = path.join(root, 'unavailable.md');
    fs.writeFileSync(available, 'available');
    fs.writeFileSync(unavailable, 'unavailable');
    const originalStat = fs.promises.stat;
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (filePath, ...args) => {
      if (filePath === unavailable)
        throw Object.assign(new Error('entry disappeared'), { code: 'ENOENT' });
      return originalStat(filePath, ...args);
    });

    await expect(service.listDir(root)).resolves.toEqual([
      expect.objectContaining({ name: 'available.md' }),
    ]);
  });

  it('returns an empty result when the requested directory has disappeared', async () => {
    const missing = path.join(root, 'missing');

    await expect(service.listDir(missing)).resolves.toEqual([]);
  });

  it.runIf(process.platform !== 'win32')(
    'classifies symbolic-link directories by their resolved workspace target',
    async () => {
      const workspace = path.join(root, 'workspace');
      const inside = path.join(workspace, 'inside');
      const outside = path.join(root, 'outside');
      fs.mkdirSync(inside, { recursive: true });
      fs.mkdirSync(outside);
      fs.symlinkSync(inside, path.join(workspace, 'inside-link'), 'dir');
      fs.symlinkSync(outside, path.join(workspace, 'outside-link'), 'dir');

      const entries = await service.listDir(workspace, workspace);

      expect(entries).toEqual([
        expect.objectContaining({
          name: 'inside',
          type: 'directory',
        }),
        expect.objectContaining({
          name: 'inside-link',
          type: 'directory',
          link: expect.objectContaining({
            targetPath: inside,
            status: 'inside-workspace',
            workspaceDepth: 1,
          }),
        }),
        expect.objectContaining({
          name: 'outside-link',
          type: 'directory',
          link: expect.objectContaining({
            targetPath: outside,
            status: 'outside-workspace',
          }),
        }),
      ]);
    },
  );

  it('renames items', async () => {
    const original = path.join(root, 'old.md');
    fs.writeFileSync(original, 'content');

    await expect(service.renameItem(original, 'new.md')).resolves.toBe(path.join(root, 'new.md'));
  });

  it('preflights a rename without changing the filesystem', async () => {
    const original = path.join(root, 'old.md');
    fs.writeFileSync(original, 'content');

    await expect(service.prepareRename(original, 'new.md')).resolves.toBe(
      path.join(root, 'new.md'),
    );
    expect(fs.existsSync(original)).toBe(true);
    expect(fs.existsSync(path.join(root, 'new.md'))).toBe(false);
  });

  it('rebases paths inside a renamed directory without touching siblings', () => {
    const oldDirectory = path.join(root, 'old');
    const newDirectory = path.join(root, 'new');
    const nested = path.join(oldDirectory, 'notes', 'entry.md');

    expect(service.rebasePath(oldDirectory, newDirectory, nested)).toBe(
      path.join(newDirectory, 'notes', 'entry.md'),
    );
    expect(service.rebasePath(oldDirectory, newDirectory, oldDirectory)).toBe(newDirectory);
    expect(
      service.rebasePath(oldDirectory, newDirectory, path.join(root, 'sibling.md')),
    ).toBeNull();
  });

  it('writes image bytes without text conversion', async () => {
    const filePath = path.join(root, 'assets', 'pixel.png');
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await service.writeBinaryFile(filePath, bytes);

    expect(fs.readFileSync(filePath)).toEqual(Buffer.from(bytes));
  });
});
