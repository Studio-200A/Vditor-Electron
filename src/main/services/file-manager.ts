import * as fs from 'fs';
import * as path from 'path';
import { resolveFileIdentity } from './file-identity';
import { ExternalDocumentChangeError, SafeFileWriter, SafeWriteResult } from './safe-file-writer';

function fileManagerError(
  message: string,
  code: 'EEXIST' | 'EINVAL',
  cause?: unknown,
): Error & { code: 'EEXIST' | 'EINVAL' } {
  return Object.assign(new Error(message, { cause }), { code });
}

export type DocumentWriteResult =
  | SafeWriteResult
  | { error: 'external-change'; content: string; encoding: string }
  | { error: 'permission-denied' | 'write-failed' };

interface DocumentFileWriter {
  write(
    filePath: string,
    content: string,
    options?: { expectedBytes?: Buffer; expectedAbsent?: boolean },
  ): Promise<SafeWriteResult>;
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
  link?: {
    targetPath: string;
    status: 'inside-workspace' | 'outside-workspace';
    workspaceDepth: number;
    targetsWorkspaceRoot: boolean;
  };
}

export class FileManagerService {
  constructor(private readonly safeFileWriter: DocumentFileWriter = new SafeFileWriter()) {}

  async readFile(filePath: string): Promise<{ content: string; encoding: string }> {
    return readDocumentFile(filePath);
  }

  async writeFile(filePath: string, content: string): Promise<SafeWriteResult> {
    return this.safeFileWriter.write(filePath, content);
  }

  async writeDocument(
    filePath: string,
    content: string,
    expectedContent?: string,
    expectedAbsent = false,
  ): Promise<DocumentWriteResult> {
    try {
      if (expectedContent !== undefined && expectedAbsent)
        throw new Error('A document write cannot expect both content and absence.');
      let expectedBytes: Buffer | undefined;
      if (expectedContent !== undefined) {
        const diskBytes = await fs.promises.readFile(path.resolve(filePath));
        const diskVersion = decodeDocumentBuffer(diskBytes);
        if (diskVersion.content !== expectedContent)
          return { error: 'external-change', ...diskVersion };
        expectedBytes = diskBytes;
      } else if (expectedAbsent) {
        try {
          const diskVersion = await this.readFile(filePath);
          return { error: 'external-change', ...diskVersion };
        } catch (error) {
          if (!this.isMissingFileError(error)) throw error;
        }
      }
      return await this.safeFileWriter.write(filePath, content, { expectedBytes, expectedAbsent });
    } catch (error) {
      if (error instanceof ExternalDocumentChangeError) {
        try {
          return { error: 'external-change', ...(await this.readFile(filePath)) };
        } catch {
          return { error: 'external-change', content: '', encoding: 'utf-8' };
        }
      }
      if (this.isPermissionError(error)) {
        console.error(
          'WARNING: Document write error: the file or its directory may not be writable.',
        );
        return { error: 'permission-denied' };
      }
      console.error('Document write error: unable to safely replace the file.');
      return { error: 'write-failed' };
    }
  }

  private isPermissionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'EACCES' || error.code === 'EPERM')
    );
  }

  private isMissingFileError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    );
  }

  async exists(filePath: string): Promise<boolean> {
    return fs.existsSync(path.resolve(filePath));
  }

  async fileIdentity(filePath: string): Promise<string> {
    return resolveFileIdentity(filePath);
  }

  async listDir(dirPath: string, workspacePath?: string): Promise<DirEntry[]> {
    const resolved = path.resolve(dirPath);
    const workspaceRoot = workspacePath ? await this.realPathOrResolved(workspacePath) : null;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    } catch (error) {
      if (this.isUnavailableEntryError(error)) return [];
      throw error;
    }
    const result = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(resolved, entry.name);
        try {
          const stat = await fs.promises.stat(entryPath);
          const isDirectory = stat.isDirectory();
          const targetPath = entry.isSymbolicLink()
            ? await this.realPathOrResolved(entryPath)
            : null;
          const link =
            isDirectory && targetPath && workspaceRoot
              ? {
                  targetPath,
                  status: this.isWithinDirectory(workspaceRoot, targetPath)
                    ? ('inside-workspace' as const)
                    : ('outside-workspace' as const),
                  workspaceDepth: this.workspaceDepth(workspaceRoot, targetPath),
                  targetsWorkspaceRoot: targetPath === workspaceRoot,
                }
              : undefined;
          return {
            name: entry.name,
            path: entryPath,
            type: isDirectory ? ('directory' as const) : ('file' as const),
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            ...(link ? { link } : {}),
          };
        } catch (error) {
          if (this.isUnavailableEntryError(error)) return null;
          throw error;
        }
      }),
    );
    return result
      .filter((entry): entry is DirEntry => entry !== null)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
  }

  private isUnavailableEntryError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['EACCES', 'ENOENT', 'ENOTDIR', 'EPERM'].includes(String(error.code))
    );
  }

  private async realPathOrResolved(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath);
    try {
      return await fs.promises.realpath(resolved);
    } catch (error) {
      if (this.isUnavailableEntryError(error)) return resolved;
      throw error;
    }
  }

  private isWithinDirectory(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(rootPath, targetPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
  }

  private workspaceDepth(rootPath: string, targetPath: string): number {
    const relative = path.relative(rootPath, targetPath);
    return relative ? relative.split(path.sep).length : 0;
  }

  async createItem(parentDir: string, name: string, type: 'file' | 'directory'): Promise<string> {
    const destination = path.resolve(parentDir, name);
    if (path.dirname(destination) !== path.resolve(parentDir)) {
      throw fileManagerError('The item name must not contain a path.', 'EINVAL');
    }
    if (fs.existsSync(destination))
      throw fileManagerError('An item with that name already exists.', 'EEXIST');
    if (type === 'directory') await fs.promises.mkdir(destination);
    else await fs.promises.writeFile(destination, '', 'utf8');
    return destination;
  }

  async prepareRename(oldPath: string, newName: string): Promise<string> {
    const resolved = path.resolve(oldPath);
    const destination = path.join(path.dirname(resolved), newName);
    if (path.dirname(destination) !== path.dirname(resolved)) {
      throw fileManagerError('The new name must not contain a path.', 'EINVAL');
    }
    if (destination === resolved) return destination;
    if (fs.existsSync(destination)) {
      const caseOnlyRename =
        process.platform === 'win32' &&
        resolved.toLocaleLowerCase() === destination.toLocaleLowerCase();
      if (!caseOnlyRename)
        throw fileManagerError('An item with that name already exists.', 'EEXIST');
    }
    return destination;
  }

  async renameItem(oldPath: string, newName: string): Promise<string> {
    const resolved = path.resolve(oldPath);
    const destination = await this.prepareRename(oldPath, newName);
    if (destination === resolved) return destination;
    const source = await fs.promises.lstat(resolved);
    if (!source.isDirectory()) {
      try {
        // link() fails atomically when another process claims the destination after preflight.
        await fs.promises.link(resolved, destination);
      } catch (error) {
        if (this.isAlreadyExistsError(error))
          throw fileManagerError('An item with that name already exists.', 'EEXIST', error);
        throw error;
      }
      try {
        await fs.promises.unlink(resolved);
      } catch (error) {
        try {
          await fs.promises.unlink(destination);
        } catch {
          // The original source remains authoritative if rollback cannot remove the new link.
        }
        throw error;
      }
      return destination;
    }
    if (this.isCaseOnlyRename(resolved, destination)) {
      await fs.promises.rename(resolved, destination);
      return destination;
    }

    let destinationReserved = false;
    try {
      // mkdir is an atomic no-replace claim for a directory name. The subsequent rename
      // can replace only this empty reservation, so a competing directory cannot win
      // between prepareRename() and the filesystem operation.
      await fs.promises.mkdir(destination);
      destinationReserved = true;
      await fs.promises.rename(resolved, destination);
      destinationReserved = false;
      return destination;
    } catch (error) {
      if (destinationReserved) {
        try {
          await fs.promises.rmdir(destination);
        } catch {
          // Never remove a reservation that is no longer empty or no longer ours.
        }
      }
      if (this.isAlreadyExistsError(error))
        throw fileManagerError('An item with that name already exists.', 'EEXIST', error);
      throw error;
    }
  }

  private isCaseOnlyRename(source: string, destination: string): boolean {
    return (
      process.platform === 'win32' &&
      source !== destination &&
      source.toLocaleLowerCase() === destination.toLocaleLowerCase()
    );
  }

  private isAlreadyExistsError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
    );
  }

  rebasePath(oldRoot: string, newRoot: string, candidatePath: string): string | null {
    const resolvedOldRoot = path.resolve(oldRoot);
    const resolvedCandidate = path.resolve(candidatePath);
    const relative = path.relative(resolvedOldRoot, resolvedCandidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return null;
    return path.resolve(newRoot, relative);
  }

  async writeBinaryFile(filePath: string, bytes: Uint8Array): Promise<void> {
    const resolved = path.resolve(filePath);
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, Buffer.from(bytes));
  }
}

export async function readDocumentFile(
  filePath: string,
): Promise<{ content: string; encoding: string }> {
  const buffer = await fs.promises.readFile(path.resolve(filePath));
  return decodeDocumentBuffer(buffer);
}

function decodeDocumentBuffer(buffer: Buffer): { content: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return { content: buffer.toString('utf-8', 3), encoding: 'utf-8-bom' };
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    return { content: new TextDecoder('gb18030').decode(buffer), encoding: 'gb18030' };
  }
}
