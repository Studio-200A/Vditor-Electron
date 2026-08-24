import * as fs from 'fs';
import * as path from 'path';
import { SafeFileWriter, SafeWriteResult } from './safe-file-writer';

export type DocumentWriteResult = SafeWriteResult | { error: 'permission-denied' | 'write-failed' };

interface DocumentFileWriter {
  write(filePath: string, content: string): Promise<SafeWriteResult>;
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
}

export class FileManagerService {
  constructor(private readonly safeFileWriter: DocumentFileWriter = new SafeFileWriter()) {}

  async readFile(filePath: string): Promise<{ content: string; encoding: string }> {
    const resolvedPath = path.resolve(filePath);
    const buffer = fs.readFileSync(resolvedPath);

    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return { content: buffer.toString('utf-8', 3), encoding: 'utf-8-bom' };
    }

    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return { content, encoding: 'utf-8' };
    } catch {
      return { content: new TextDecoder('gb18030').decode(buffer), encoding: 'gb18030' };
    }
  }

  async writeFile(filePath: string, content: string): Promise<SafeWriteResult> {
    return this.safeFileWriter.write(filePath, content);
  }

  async writeDocument(filePath: string, content: string): Promise<DocumentWriteResult> {
    try {
      return await this.safeFileWriter.write(filePath, content);
    } catch (error) {
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

  async exists(filePath: string): Promise<boolean> {
    return fs.existsSync(path.resolve(filePath));
  }

  async listDir(dirPath: string): Promise<DirEntry[]> {
    const resolved = path.resolve(dirPath);
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    const result = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(resolved, entry.name);
        const stat = await fs.promises.stat(entryPath);
        return {
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
        };
      }),
    );
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  async createItem(parentDir: string, name: string, type: 'file' | 'directory'): Promise<string> {
    const destination = path.resolve(parentDir, name);
    if (path.dirname(destination) !== path.resolve(parentDir)) {
      throw new Error('The item name must not contain a path.');
    }
    if (fs.existsSync(destination)) throw new Error('An item with that name already exists.');
    if (type === 'directory') await fs.promises.mkdir(destination);
    else await fs.promises.writeFile(destination, '', 'utf8');
    return destination;
  }

  async renameItem(oldPath: string, newName: string): Promise<string> {
    const resolved = path.resolve(oldPath);
    const destination = path.join(path.dirname(resolved), newName);
    if (path.dirname(destination) !== path.dirname(resolved)) {
      throw new Error('The new name must not contain a path.');
    }
    await fs.promises.rename(resolved, destination);
    return destination;
  }

  async writeBinaryFile(filePath: string, bytes: Uint8Array): Promise<void> {
    const resolved = path.resolve(filePath);
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, Buffer.from(bytes));
  }
}
