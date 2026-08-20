import * as fs from 'node:fs';
import * as path from 'node:path';

const MARKDOWN_EXTENSION = /\.(?:md|markdown|mdown|mkd|mkdn)$/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

type PathApi = Pick<typeof path, 'dirname' | 'isAbsolute' | 'normalize' | 'resolve'>;
interface FileSystem {
  realpathSync(filePath: string): string;
  statSync(filePath: string): { isFile(): boolean };
}

export type MarkdownLinkResolution =
  | { kind: 'resolved'; filePath: string; fragment: string }
  | { kind: 'error'; code: 'invalid-source' | 'invalid-link' | 'unsupported-target' | 'not-found' };

interface ResolveOptions {
  fsApi?: FileSystem;
  pathApi?: PathApi;
}

function isRegularFile(filePath: string, fsApi: FileSystem): boolean {
  try {
    return fsApi.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveRelativeMarkdownLink(
  sourceFile: unknown,
  href: unknown,
  { fsApi = fs, pathApi = path }: ResolveOptions = {},
): MarkdownLinkResolution {
  if (typeof sourceFile !== 'string' || !pathApi.isAbsolute(sourceFile)) {
    return { kind: 'error', code: 'invalid-source' };
  }
  if (!isRegularFile(sourceFile, fsApi)) return { kind: 'error', code: 'invalid-source' };
  if (typeof href !== 'string') return { kind: 'error', code: 'invalid-link' };

  const fragmentIndex = href.indexOf('#');
  const rawPath = (fragmentIndex < 0 ? href : href.slice(0, fragmentIndex)).trim();
  const fragment = fragmentIndex < 0 ? '' : href.slice(fragmentIndex + 1);
  if (!rawPath || rawPath.startsWith('//') || URL_SCHEME.test(rawPath)) {
    return { kind: 'error', code: 'invalid-link' };
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(rawPath);
  } catch {
    return { kind: 'error', code: 'invalid-link' };
  }
  if (pathApi.isAbsolute(relativePath)) return { kind: 'error', code: 'invalid-link' };
  if (!MARKDOWN_EXTENSION.test(relativePath)) {
    return { kind: 'error', code: 'unsupported-target' };
  }

  const canonicalSource = pathApi.normalize(fsApi.realpathSync(sourceFile));
  const destination = pathApi.resolve(pathApi.dirname(canonicalSource), relativePath);
  if (!isRegularFile(destination, fsApi)) return { kind: 'error', code: 'not-found' };
  return {
    kind: 'resolved',
    filePath: pathApi.normalize(fsApi.realpathSync(destination)),
    fragment,
  };
}
