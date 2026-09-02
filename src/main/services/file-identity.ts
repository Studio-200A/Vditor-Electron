import * as fs from 'node:fs';
import * as path from 'node:path';

export type FileIdentityPlatform = NodeJS.Platform;

export function normalizeFileIdentityPath(
  filePath: string,
  platform: FileIdentityPlatform = process.platform,
): string {
  return platform === 'win32' ? filePath.toLocaleLowerCase() : filePath;
}

export function resolveFileIdentitySync(
  filePath: string,
  platform: FileIdentityPlatform = process.platform,
): string {
  const resolved = path.resolve(filePath);
  try {
    return normalizeFileIdentityPath(fs.realpathSync.native(resolved), platform);
  } catch (error) {
    if (!isMissingPathError(error)) return normalizeFileIdentityPath(resolved, platform);
    return normalizeFileIdentityPath(resolveFromExistingAncestorSync(resolved), platform);
  }
}

export async function resolveFileIdentity(
  filePath: string,
  platform: FileIdentityPlatform = process.platform,
): Promise<string> {
  const resolved = path.resolve(filePath);
  try {
    return normalizeFileIdentityPath(await fs.promises.realpath(resolved), platform);
  } catch (error) {
    if (!isMissingPathError(error)) return normalizeFileIdentityPath(resolved, platform);
    return normalizeFileIdentityPath(await resolveFromExistingAncestor(resolved), platform);
  }
}

function resolveFromExistingAncestorSync(filePath: string): string {
  let ancestor = filePath;
  const missingSegments: string[] = [];
  while (true) {
    try {
      return path.join(fs.realpathSync.native(ancestor), ...missingSegments);
    } catch (error) {
      if (!isMissingPathError(error)) return filePath;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return filePath;
      missingSegments.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

async function resolveFromExistingAncestor(filePath: string): Promise<string> {
  let ancestor = filePath;
  const missingSegments: string[] = [];
  while (true) {
    try {
      return path.join(await fs.promises.realpath(ancestor), ...missingSegments);
    } catch (error) {
      if (!isMissingPathError(error)) return filePath;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return filePath;
      missingSegments.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
