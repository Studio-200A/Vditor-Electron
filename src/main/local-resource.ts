import * as fs from 'node:fs';
import * as path from 'node:path';

export type LocalResourcePlatform = 'posix' | 'win32';

export interface LocalResourcePathApi {
  extname(filePath: string): string;
  isAbsolute(filePath: string): boolean;
  normalize(filePath: string): string;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
  sep: string;
}

export interface LocalResourceFileStats {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface LocalResourceFileSystem {
  realpath(filePath: string): Promise<string>;
  stat(filePath: string): Promise<LocalResourceFileStats>;
}

export type LocalResourceRejectionReason =
  | 'invalid-url'
  | 'no-registered-root'
  | 'private-path'
  | 'outside-root'
  | 'unavailable'
  | 'stale-request';

export interface LocalResourcePolicyOptions {
  fileSystem?: LocalResourceFileSystem;
  onRejected?: (reason: LocalResourceRejectionReason) => void;
  pathApi?: LocalResourcePathApi;
  platform?: LocalResourcePlatform;
  privateRoots?: readonly string[];
}

export const LOCAL_RESOURCE_PROTOCOL = 'local-file:';
export const LOCAL_RESOURCE_HOST = 'root';

const MAX_LOCAL_RESOURCE_URL_LENGTH = 32_767;
const INVALID_PERCENT_ENCODING = /%(?![0-9a-f]{2})/i;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;
const LOCAL_RESOURCE_URL_PATTERN = /^local-file:\/\/([^/?#]*)([^?#]*)?(?:[?#].*)?$/i;
const LOCAL_RESOURCE_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

const DEFAULT_PLATFORM: LocalResourcePlatform = process.platform === 'win32' ? 'win32' : 'posix';
const DEFAULT_PATH_API: LocalResourcePathApi =
  DEFAULT_PLATFORM === 'win32' ? path.win32 : path.posix;
const DEFAULT_FILE_SYSTEM: LocalResourceFileSystem = {
  realpath: (filePath) => fs.promises.realpath(filePath),
  stat: (filePath) => fs.promises.stat(filePath),
};

function pathApiFor(platform: LocalResourcePlatform): LocalResourcePathApi {
  return platform === 'win32' ? path.win32 : path.posix;
}

function hasRawControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasDotPathSegment(value: string): boolean {
  return value.split(/[\\/]+/).some((segment) => segment === '.' || segment === '..');
}

function comparisonPath(
  filePath: string,
  pathApi: LocalResourcePathApi,
  caseInsensitive: boolean,
): string {
  const normalized = pathApi.normalize(filePath);
  return caseInsensitive ? normalized.toLocaleLowerCase() : normalized;
}

export function isWithinLocalResourceDirectory(
  rootPath: string,
  targetPath: string,
  pathApi: LocalResourcePathApi = DEFAULT_PATH_API,
  caseInsensitive = pathApi === path.win32,
): boolean {
  const root = comparisonPath(rootPath, pathApi, caseInsensitive);
  const target = comparisonPath(targetPath, pathApi, caseInsensitive);
  const relative = pathApi.relative(root, target);
  return (
    relative === '' ||
    (!pathApi.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`))
  );
}

function isWithinAnyLocalResourceDirectory(
  roots: readonly string[],
  targetPath: string,
  pathApi: LocalResourcePathApi,
  caseInsensitive: boolean,
): boolean {
  return roots.some((rootPath) =>
    isWithinLocalResourceDirectory(rootPath, targetPath, pathApi, caseInsensitive),
  );
}

/**
 * Encode an absolute native directory as the local-file base used by the renderer.
 * The extra slash after the fixed authority is structural; the remaining slashes keep
 * URL-relative `../` resolution aligned with the native directory hierarchy.
 */
export function formatLocalResourceBase(
  nativeDirectory: string,
  platform: LocalResourcePlatform = DEFAULT_PLATFORM,
): string {
  const pathApi = pathApiFor(platform);
  if (!nativeDirectory || !pathApi.isAbsolute(nativeDirectory)) return '';
  if (platform === 'posix' && nativeDirectory.includes('\\')) return '';
  const urlPath = platform === 'win32' ? nativeDirectory.replace(/\\/g, '/') : nativeDirectory;
  const encodedPath = urlPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `local-file://root/${encodedPath.endsWith('/') ? encodedPath : `${encodedPath}/`}`;
}

/**
 * Convert only the local-file URL shape emitted by formatLocalResourceBase back to a
 * native absolute path. Validation happens against the raw pathname before URL parsing
 * can normalize dot segments or reinterpret a backslash.
 */
export function parseLocalResourcePath(
  value: unknown,
  pathApi: LocalResourcePathApi = DEFAULT_PATH_API,
): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAX_LOCAL_RESOURCE_URL_LENGTH ||
    value.trim() !== value ||
    hasRawControlCharacter(value) ||
    INVALID_PERCENT_ENCODING.test(value) ||
    value.includes('\\')
  )
    return null;

  const match = LOCAL_RESOURCE_URL_PATTERN.exec(value);
  if (!match || match[1].toLocaleLowerCase() !== LOCAL_RESOURCE_HOST) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== LOCAL_RESOURCE_PROTOCOL ||
    url.hostname !== LOCAL_RESOURCE_HOST ||
    url.port ||
    url.username ||
    url.password
  )
    return null;

  const rawPath = match[2] || '';
  if (!rawPath.startsWith('/') || ENCODED_PATH_SEPARATOR.test(rawPath)) return null;

  const rawSegments = rawPath.split('/');
  for (const rawSegment of rawSegments) {
    let decodedSegment: string;
    try {
      decodedSegment = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (
      decodedSegment === '.' ||
      decodedSegment === '..' ||
      decodedSegment.includes('/') ||
      decodedSegment.includes('\\') ||
      decodedSegment.includes('\0')
    )
      return null;
  }

  // Empty segments are needed only for the leading POSIX/UNC root representation.
  const firstNonEmpty = rawSegments.findIndex((segment) => segment !== '');
  if (firstNonEmpty >= 0 && rawSegments.slice(firstNonEmpty).some((segment) => segment === ''))
    return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decodedPath.startsWith('/') || decodedPath.includes('\0') || decodedPath.includes('\\'))
    return null;

  const nativePath = decodedPath.slice(1);
  if (!nativePath || !pathApi.isAbsolute(nativePath) || hasDotPathSegment(nativePath)) return null;
  return nativePath;
}

export function localResourceContentType(
  filePath: string,
  pathApi: LocalResourcePathApi = DEFAULT_PATH_API,
): string | null {
  return LOCAL_RESOURCE_MIME_TYPES[pathApi.extname(filePath).toLocaleLowerCase()] || null;
}

interface RegisteredLocalResourceRoot {
  lexicalPath: string;
  realPath: string;
}

export class LocalResourcePolicy {
  private readonly fileSystem: LocalResourceFileSystem;
  private readonly pathApi: LocalResourcePathApi;
  private readonly caseInsensitive: boolean;
  private readonly privateRoots: string[];
  private readonly onRejected: (reason: LocalResourceRejectionReason) => void;
  private roots: RegisteredLocalResourceRoot[] = [];
  private revision = 0;

  constructor(options: LocalResourcePolicyOptions = {}) {
    const platform = options.platform || DEFAULT_PLATFORM;
    this.fileSystem = options.fileSystem || DEFAULT_FILE_SYSTEM;
    this.pathApi = options.pathApi || pathApiFor(platform);
    this.caseInsensitive = platform === 'win32';
    this.onRejected = options.onRejected || (() => undefined);
    this.privateRoots = Array.from(
      new Set(
        (options.privateRoots || [])
          .filter((rootPath) => this.pathApi.isAbsolute(rootPath))
          .map((rootPath) => this.pathApi.resolve(rootPath)),
      ),
    );
  }

  /** Replace all renderer-declared roots, revoking the previous set before async validation. */
  async setRoots(rootPaths: readonly string[]): Promise<void> {
    const revision = ++this.revision;
    this.roots = [];
    if (!rootPaths.length) return;

    const privateRealPaths = await this.realPaths(this.privateRoots);
    const nextRoots: RegisteredLocalResourceRoot[] = [];
    for (const rootPath of rootPaths) {
      if (!this.pathApi.isAbsolute(rootPath)) continue;
      const lexicalPath = this.pathApi.resolve(rootPath);
      if (
        isWithinAnyLocalResourceDirectory(
          this.privateRoots,
          lexicalPath,
          this.pathApi,
          this.caseInsensitive,
        )
      )
        continue;

      const realPath = await this.realPath(lexicalPath);
      if (!realPath) continue;
      if (
        isWithinAnyLocalResourceDirectory(
          privateRealPaths,
          realPath,
          this.pathApi,
          this.caseInsensitive,
        )
      )
        continue;
      try {
        if (!(await this.fileSystem.stat(realPath)).isDirectory()) continue;
      } catch {
        continue;
      }

      if (
        nextRoots.some(
          (registered) =>
            isWithinLocalResourceDirectory(
              registered.lexicalPath,
              lexicalPath,
              this.pathApi,
              this.caseInsensitive,
            ) &&
            isWithinLocalResourceDirectory(
              registered.realPath,
              realPath,
              this.pathApi,
              this.caseInsensitive,
            ),
        )
      )
        continue;

      for (let index = nextRoots.length - 1; index >= 0; index -= 1) {
        const registered = nextRoots[index];
        if (
          isWithinLocalResourceDirectory(
            lexicalPath,
            registered.lexicalPath,
            this.pathApi,
            this.caseInsensitive,
          ) &&
          isWithinLocalResourceDirectory(
            realPath,
            registered.realPath,
            this.pathApi,
            this.caseInsensitive,
          )
        )
          nextRoots.splice(index, 1);
      }
      nextRoots.push({ lexicalPath, realPath });
    }

    if (revision === this.revision) this.roots = nextRoots;
  }

  clear(): void {
    this.revision += 1;
    this.roots = [];
  }

  getRegisteredRoots(): string[] {
    return this.roots.map(({ realPath }) => realPath);
  }

  async resolveResourcePath(url: unknown): Promise<string | null> {
    const nativePath = parseLocalResourcePath(url, this.pathApi);
    if (!nativePath) return this.reject('invalid-url');
    if (!this.roots.length) return this.reject('no-registered-root');

    const revision = this.revision;
    const lexicalPath = this.pathApi.resolve(nativePath);
    if (
      isWithinAnyLocalResourceDirectory(
        this.privateRoots,
        lexicalPath,
        this.pathApi,
        this.caseInsensitive,
      )
    )
      return this.reject('private-path');

    const matchingRoot = this.roots.find((root) =>
      isWithinLocalResourceDirectory(
        root.lexicalPath,
        lexicalPath,
        this.pathApi,
        this.caseInsensitive,
      ),
    );
    if (!matchingRoot) return this.reject('outside-root');

    const realPath = await this.realPath(lexicalPath);
    if (!realPath) return this.reject('unavailable');
    if (revision !== this.revision) return this.reject('stale-request');
    const privateRealPaths = await this.realPaths(this.privateRoots);
    if (
      isWithinAnyLocalResourceDirectory(
        privateRealPaths,
        realPath,
        this.pathApi,
        this.caseInsensitive,
      )
    )
      return this.reject('private-path');
    if (
      !isWithinLocalResourceDirectory(
        matchingRoot.realPath,
        realPath,
        this.pathApi,
        this.caseInsensitive,
      )
    )
      return this.reject('outside-root');

    try {
      if (!(await this.fileSystem.stat(realPath)).isFile()) return this.reject('unavailable');
    } catch {
      return this.reject('unavailable');
    }
    return revision === this.revision ? realPath : this.reject('stale-request');
  }

  private async realPath(filePath: string): Promise<string | null> {
    try {
      return this.pathApi.resolve(await this.fileSystem.realpath(filePath));
    } catch {
      return null;
    }
  }

  private async realPaths(filePaths: readonly string[]): Promise<string[]> {
    const resolved = await Promise.all(filePaths.map((filePath) => this.realPath(filePath)));
    return resolved.filter((filePath): filePath is string => filePath !== null);
  }

  private reject(reason: LocalResourceRejectionReason): null {
    this.onRejected(reason);
    return null;
  }
}
