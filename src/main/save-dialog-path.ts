import * as path from 'node:path';

type PathApi = Pick<typeof path, 'isAbsolute' | 'join'>;

/**
 * Computes the Save dialog default path from the renderer-supplied values.
 *
 * Save As forwards the current document's absolute path as `defaultPath` while the composition
 * layer always injects the workspace as `defaultDirectory`. Joining an absolute `defaultPath`
 * onto the directory nests the workspace twice (`/workspace` + `/workspace/file.md`), pointing the
 * dialog at a non-existent location, so an absolute `defaultPath` is already the exact target and
 * wins outright. Only a bare file name is resolved against `defaultDirectory`. This differs from
 * the export dialogs, which intentionally reduce `defaultPath` to a file name under a directory.
 */
export function resolveSaveDialogDefaultPath(
  defaultPath: string | undefined,
  defaultDirectory: string | undefined,
  fallbackFileName = 'untitled.md',
  pathApi: PathApi = path,
): string {
  if (defaultPath) {
    if (pathApi.isAbsolute(defaultPath)) return defaultPath;
    return defaultDirectory ? pathApi.join(defaultDirectory, defaultPath) : defaultPath;
  }
  return defaultDirectory ? pathApi.join(defaultDirectory, fallbackFileName) : fallbackFileName;
}
