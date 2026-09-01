import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  formatLocalResourceBase,
  isWithinLocalResourceDirectory,
  localResourceContentType,
  LocalResourcePolicy,
  parseLocalResourcePath,
} from '../../src/main/local-resource';

type FakeEntry = { kind: 'directory' | 'file'; realPath?: string };

function fakeFileSystem(entries: Record<string, FakeEntry>) {
  const getEntry = (filePath: string): FakeEntry => {
    const entry = entries[filePath];
    if (!entry) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return entry;
  };
  return {
    realpath: vi.fn(async (filePath: string) => getEntry(filePath).realPath || filePath),
    stat: vi.fn(async (filePath: string) => {
      const entry = getEntry(filePath);
      return {
        isDirectory: () => entry.kind === 'directory',
        isFile: () => entry.kind === 'file',
      };
    }),
  };
}

describe('local resource policy', () => {
  it('allows SVG only when the explicit image setting is enabled', () => {
    expect(localResourceContentType('/workspace/image.svg', path.posix)).toBeNull();
    expect(localResourceContentType('/workspace/image.svg', path.posix, true)).toBe(
      'image/svg+xml',
    );
  });
  it('keeps native path hierarchy in a fixed-authority URL for POSIX, drive, and UNC paths', () => {
    const posixBase = formatLocalResourceBase('/home/user/project', 'posix');
    const driveBase = formatLocalResourceBase('C:\\Users\\test\\project', 'win32');
    const uncBase = formatLocalResourceBase('\\\\server\\share\\project', 'win32');

    expect(posixBase).toBe('local-file://root//home/user/project/');
    expect(driveBase).toBe('local-file://root/C%3A/Users/test/project/');
    expect(uncBase).toBe('local-file://root///server/share/project/');
    expect(parseLocalResourcePath(new URL('../assets/pixel.png', posixBase).href, path.posix)).toBe(
      '/home/user/assets/pixel.png',
    );
    expect(parseLocalResourcePath(new URL('../assets/pixel.png', driveBase).href, path.win32)).toBe(
      'C:/Users/test/assets/pixel.png',
    );
    expect(parseLocalResourcePath(new URL('assets/pixel.png', uncBase).href, path.win32)).toBe(
      '//server/share/project/assets/pixel.png',
    );
  });

  it('accepts only the fixed authority and rejects lexical URL escape forms', () => {
    const valid = 'local-file://root//workspace/assets/pixel.png';
    expect(parseLocalResourcePath(valid, path.posix)).toBe('/workspace/assets/pixel.png');

    for (const value of [
      'local-file://rootC%3A/Users/test/project/assets/pixel.png',
      'local-file://other//workspace/assets/pixel.png',
      'local-file:///workspace/assets/pixel.png',
      'local-file://root//workspace/../secret.png',
      'local-file://root//workspace/%2e%2e/secret.png',
      'local-file://root//workspace/%2Fetc/passwd',
      'local-file://root//workspace/%5Cetc/passwd',
      'local-file://root//workspace/%00secret.png',
      'local-file://root//workspace/%zz.png',
      'local-file://root\\workspace\\assets\\pixel.png',
      'local-file://root/workspace/assets/pixel.png',
    ]) {
      expect(parseLocalResourcePath(value, path.posix)).toBeNull();
    }
  });

  it('uses path-boundary semantics with Windows case-insensitive comparisons', () => {
    expect(
      isWithinLocalResourceDirectory('C:\\Work', 'c:\\work\\assets\\pixel.png', path.win32, true),
    ).toBe(true);
    expect(
      isWithinLocalResourceDirectory('C:\\Work', 'C:\\Work-old\\pixel.png', path.win32, true),
    ).toBe(false);
    expect(isWithinLocalResourceDirectory('/work', '/work/assets/pixel.png', path.posix)).toBe(
      true,
    );
    expect(isWithinLocalResourceDirectory('/work', '/work-old/pixel.png', path.posix)).toBe(false);
  });

  it('allows authorized files, blocks missing or outside files, and rejects symlink escape', async () => {
    const fileSystem = fakeFileSystem({
      '/private': { kind: 'directory' },
      '/workspace': { kind: 'directory' },
      '/workspace/assets/pixel.png': { kind: 'file' },
      '/workspace/escape.png': { kind: 'file', realPath: '/outside/secret.png' },
      '/outside/secret.png': { kind: 'file' },
    });
    const policy = new LocalResourcePolicy({
      platform: 'posix',
      fileSystem,
      privateRoots: ['/private'],
    });
    await policy.setRoots(['/workspace']);

    expect(await policy.resolveResourcePath('local-file://root//workspace/assets/pixel.png')).toBe(
      '/workspace/assets/pixel.png',
    );
    expect(await policy.resolveResourcePath('local-file://root//outside/secret.png')).toBeNull();
    expect(await policy.resolveResourcePath('local-file://root//workspace/missing.png')).toBeNull();
    expect(await policy.resolveResourcePath('local-file://root//workspace/escape.png')).toBeNull();
  });

  it('does not register private roots and keeps private descendants blocked under a broader root', async () => {
    const fileSystem = fakeFileSystem({
      '/private': { kind: 'directory' },
      '/workspace': { kind: 'directory' },
      '/workspace/private': { kind: 'directory' },
      '/workspace/private/config.toml': { kind: 'file' },
      '/workspace/assets/pixel.png': { kind: 'file' },
    });
    const policy = new LocalResourcePolicy({
      platform: 'posix',
      fileSystem,
      privateRoots: ['/private', '/workspace/private'],
    });
    await policy.setRoots(['/private', '/workspace', '/workspace']);

    expect(policy.getRegisteredRoots()).toEqual(['/workspace']);
    expect(await policy.resolveResourcePath('local-file://root//workspace/assets/pixel.png')).toBe(
      '/workspace/assets/pixel.png',
    );
    expect(
      await policy.resolveResourcePath('local-file://root//workspace/private/config.toml'),
    ).toBeNull();
  });

  it('collapses nested roots and resolves authorized Windows files with native boundaries', async () => {
    const fileSystem = fakeFileSystem({
      'C:\\Workspace': { kind: 'directory' },
      'C:\\Workspace\\assets': { kind: 'directory' },
      'C:\\Workspace\\assets\\pixel.png': { kind: 'file' },
      'D:\\outside\\secret.png': { kind: 'file' },
      'C:\\Workspace\\escape.png': {
        kind: 'file',
        realPath: 'D:\\outside\\secret.png',
      },
    });
    const policy = new LocalResourcePolicy({ platform: 'win32', fileSystem });
    await policy.setRoots(['C:\\Workspace\\assets', 'C:\\Workspace']);

    expect(policy.getRegisteredRoots()).toEqual(['C:\\Workspace']);
    const base = formatLocalResourceBase('C:\\Workspace', 'win32');
    expect(await policy.resolveResourcePath(new URL('assets/pixel.png', base).href)).toBe(
      'C:\\Workspace\\assets\\pixel.png',
    );
    expect(await policy.resolveResourcePath(new URL('escape.png', base).href)).toBeNull();
  });

  it('revokes roots immediately and ignores late root registration results', async () => {
    const fileSystem = fakeFileSystem({
      '/workspace': { kind: 'directory' },
      '/workspace/assets/pixel.png': { kind: 'file' },
    });
    const policy = new LocalResourcePolicy({ platform: 'posix', fileSystem });
    await policy.setRoots(['/workspace']);
    const pending = policy.setRoots(['/workspace']);
    policy.clear();
    await pending;

    expect(policy.getRegisteredRoots()).toEqual([]);
    expect(
      await policy.resolveResourcePath('local-file://root//workspace/assets/pixel.png'),
    ).toBeNull();
  });

  it('reports safe rejection categories without including resource values', async () => {
    const fileSystem = fakeFileSystem({
      '/workspace': { kind: 'directory' },
      '/workspace/assets/pixel.png': { kind: 'file' },
    });
    const reasons: string[] = [];
    const policy = new LocalResourcePolicy({
      platform: 'posix',
      fileSystem,
      onRejected: (reason) => reasons.push(reason),
    });

    await policy.resolveResourcePath('not-a-local-resource-url');
    await policy.setRoots(['/workspace']);
    await policy.resolveResourcePath('local-file://root//outside/secret.png');
    await policy.resolveResourcePath('local-file://root//workspace/assets/missing.png');

    expect(reasons).toEqual(['invalid-url', 'outside-root', 'unavailable']);
    expect(reasons.every((reason) => !reason.includes('/'))).toBe(true);
  });

  it('returns only the image MIME types used by local previews and rejects active or unknown content', () => {
    expect(localResourceContentType('/workspace/pixel.PNG', path.posix)).toBe('image/png');
    expect(localResourceContentType('/workspace/photo.jpeg', path.posix)).toBe('image/jpeg');
    expect(localResourceContentType('C:\\workspace\\photo.webp', path.win32)).toBe('image/webp');
    expect(localResourceContentType('/workspace/vector.svg', path.posix)).toBeNull();
    expect(localResourceContentType('/workspace/script.js', path.posix)).toBeNull();
    expect(localResourceContentType('/workspace/page.html', path.posix)).toBeNull();
    expect(localResourceContentType('/workspace/data.xml', path.posix)).toBeNull();
    expect(localResourceContentType('/workspace/unknown.bin', path.posix)).toBeNull();
  });
});
