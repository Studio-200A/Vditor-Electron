import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeFileIdentityPath,
  resolveFileIdentity,
  resolveFileIdentitySync,
} from '../../src/main/services/file-identity';

describe('file identity', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('preserves case on Linux-style identities and normalizes only Windows identities', () => {
    expect(normalizeFileIdentityPath('/work/Readme.md', 'linux')).toBe('/work/Readme.md');
    expect(normalizeFileIdentityPath('C:\\Work\\Readme.md', 'win32')).toBe('c:\\work\\readme.md');
  });

  it.runIf(process.platform !== 'win32')('deduplicates a symlink and its target', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-file-identity-'));
    roots.push(root);
    const target = path.join(root, 'target.md');
    const alias = path.join(root, 'alias.md');
    fs.writeFileSync(target, 'content');
    fs.symlinkSync(target, alias);

    await expect(resolveFileIdentity(alias)).resolves.toBe(await resolveFileIdentity(target));
    expect(resolveFileIdentitySync(alias)).toBe(resolveFileIdentitySync(target));
  });

  it.runIf(process.platform !== 'win32')(
    'deduplicates a missing file through a symlinked existing ancestor',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-file-identity-'));
      roots.push(root);
      const targetDirectory = path.join(root, 'target');
      const aliasDirectory = path.join(root, 'alias');
      fs.mkdirSync(targetDirectory);
      fs.symlinkSync(targetDirectory, aliasDirectory, 'dir');
      const target = path.join(targetDirectory, 'missing', 'document.md');
      const alias = path.join(aliasDirectory, 'missing', 'document.md');

      await expect(resolveFileIdentity(alias)).resolves.toBe(await resolveFileIdentity(target));
      expect(resolveFileIdentitySync(alias)).toBe(resolveFileIdentitySync(target));
    },
  );

  it('uses a stable resolved identity for a deleted path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-file-identity-'));
    roots.push(root);
    const deleted = path.join(root, 'deleted.md');

    await expect(resolveFileIdentity(deleted)).resolves.toBe(path.resolve(deleted));
    expect(resolveFileIdentitySync(deleted)).toBe(path.resolve(deleted));
  });
});
