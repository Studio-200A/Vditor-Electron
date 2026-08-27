import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SafeWriteResult {
  expectedContent: string;
  wrote: boolean;
}

export class ExternalDocumentChangeError extends Error {
  constructor() {
    super('The document changed on disk before it could be saved.');
    this.name = 'ExternalDocumentChangeError';
  }
}

export interface SafeFileSystem {
  chmod(path: fs.PathLike, mode: fs.Mode): Promise<void>;
  link(existingPath: fs.PathLike, newPath: fs.PathLike): Promise<void>;
  mkdir(
    path: fs.PathLike,
    options: fs.MakeDirectoryOptions & { recursive: true },
  ): Promise<string | undefined>;
  open(path: fs.PathLike, flags: string, mode?: fs.Mode): Promise<fs.promises.FileHandle>;
  readFile(path: fs.PathLike): Promise<Buffer>;
  rename(oldPath: fs.PathLike, newPath: fs.PathLike): Promise<void>;
  stat(path: fs.PathLike): Promise<fs.Stats>;
  unlink(path: fs.PathLike): Promise<void>;
}

/**
 * Replaces a file only after a fully synced sibling temporary file is ready.
 * A failed replacement deliberately leaves the original target untouched.
 */
export class SafeFileWriter {
  constructor(
    private readonly fileSystem: SafeFileSystem = fs.promises,
    private readonly defaultFileMode?: fs.Mode,
  ) {}

  async write(
    filePath: string,
    content: string,
    options: { expectedBytes?: Buffer; expectedAbsent?: boolean } = {},
  ): Promise<SafeWriteResult> {
    const destination = path.resolve(filePath);
    const directory = path.dirname(destination);
    const bytes = Buffer.from(content, 'utf8');

    try {
      const existing = await this.fileSystem.readFile(destination);
      if (
        options.expectedAbsent ||
        (options.expectedBytes && !existing.equals(options.expectedBytes))
      )
        throw new ExternalDocumentChangeError();
      if (existing.equals(bytes)) return { expectedContent: content, wrote: false };
    } catch (error) {
      if (error instanceof ExternalDocumentChangeError) throw error;
      // An unreadable or absent destination must not be treated as unchanged.
    }

    await this.fileSystem.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(destination)}.${randomUUID()}.tmp`,
    );
    let temporaryCreated = false;

    try {
      let existingMode: number | undefined;
      try {
        existingMode = (await this.fileSystem.stat(destination)).mode & 0o777;
      } catch {
        // New files and unreadable metadata use the platform default mode.
      }

      const temporary = await this.fileSystem.open(
        temporaryPath,
        'wx',
        existingMode ?? this.defaultFileMode,
      );
      temporaryCreated = true;
      try {
        await temporary.writeFile(bytes);
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      if (existingMode !== undefined) await this.fileSystem.chmod(temporaryPath, existingMode);

      if (options.expectedBytes) {
        try {
          const current = await this.fileSystem.readFile(destination);
          if (!current.equals(options.expectedBytes)) throw new ExternalDocumentChangeError();
        } catch (error) {
          if (error instanceof ExternalDocumentChangeError) throw error;
          throw new ExternalDocumentChangeError();
        }
      }

      if (options.expectedAbsent) {
        try {
          // A hard link creates the final name only when it is still absent. This is the
          // no-replace counterpart to rename() for a newly saved document in the same directory.
          await this.fileSystem.link(temporaryPath, destination);
        } catch (error) {
          if (this.isAlreadyExistsError(error)) throw new ExternalDocumentChangeError();
          throw error;
        }
        await this.fileSystem.unlink(temporaryPath);
        temporaryCreated = false;
        return { expectedContent: content, wrote: true };
      }

      // Node delegates replacement semantics to the current platform. If replacement fails
      // (for example, a locked target on Windows), the target is intentionally not removed.
      await this.fileSystem.rename(temporaryPath, destination);
      temporaryCreated = false;
      return { expectedContent: content, wrote: true };
    } catch (error) {
      if (temporaryCreated) {
        try {
          await this.fileSystem.unlink(temporaryPath);
        } catch (cleanupError) {
          console.error('Failed to remove temporary document file:', temporaryPath, cleanupError);
        }
      }
      throw error;
    }
  }

  private isAlreadyExistsError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
    );
  }
}
