import * as fs from 'node:fs';
import * as path from 'node:path';
import { SafeFileWriter } from './safe-file-writer';

export const RECOVERY_SCHEMA_VERSION = 1;
export const MAX_RECOVERY_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export interface RecoverySnapshot {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  id: string;
  filePath: string | null;
  title: string;
  content: string;
  savedContent: string;
  encoding: string;
  lineEnding: 'LF' | 'CRLF';
  mode: 'wysiwyg' | 'ir' | 'sv';
  updatedAt: number;
}

export interface RecoveryCandidate {
  id: string;
  title: string;
  updatedAt: number;
}

export interface RestoredRecoverySnapshot extends RecoverySnapshot {
  diskState: 'unchanged' | 'changed' | 'unavailable';
}

const RECOVERY_ID = /^[a-z0-9-]{8,128}$/i;

/** Stores crash-recovery data separately from user-editable TOML settings. */
export class RecoveryStore {
  private readonly recoveryDir: string;
  private readonly writer = new SafeFileWriter(fs.promises, 0o600);

  constructor(recoveryDir: string) {
    this.recoveryDir = recoveryDir;
  }

  async save(snapshot: unknown): Promise<void> {
    this.assertSnapshot(snapshot);
    await this.ensureDirectory();
    await this.writer.write(this.snapshotPath(snapshot.id), JSON.stringify(snapshot));
  }

  async listCandidates(): Promise<RecoveryCandidate[]> {
    try {
      await this.ensureDirectory();
      const entries = await fs.promises.readdir(this.recoveryDir, { withFileTypes: true });
      const candidates: RecoveryCandidate[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const snapshot = await this.readSnapshot(path.join(this.recoveryDir, entry.name));
        if (!snapshot || entry.name !== `${snapshot.id}.json`) {
          await this.removeInvalidSnapshot(path.join(this.recoveryDir, entry.name));
          continue;
        }
        candidates.push({ id: snapshot.id, title: snapshot.title, updatedAt: snapshot.updatedAt });
      }
      return candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      console.error('Recovery store could not list snapshots:', this.errorCode(error));
      return [];
    }
  }

  async restore(id: string): Promise<RestoredRecoverySnapshot | null> {
    if (!RECOVERY_ID.test(id)) return null;
    const snapshot = await this.readSnapshot(this.snapshotPath(id));
    if (!snapshot) return null;
    const diskState = await this.diskState(snapshot);
    return { ...snapshot, diskState };
  }

  async discard(id: string): Promise<void> {
    if (!RECOVERY_ID.test(id)) return;
    try {
      await fs.promises.unlink(this.snapshotPath(id));
    } catch (error) {
      if (this.errorCode(error) !== 'ENOENT')
        console.error('Recovery store could not remove snapshot:', this.errorCode(error));
    }
  }

  private async ensureDirectory(): Promise<void> {
    await fs.promises.mkdir(this.recoveryDir, { recursive: true, mode: 0o700 });
    try {
      await fs.promises.chmod(this.recoveryDir, 0o700);
    } catch {
      // Permission tightening is best-effort on platforms without POSIX modes.
    }
  }

  private snapshotPath(id: string): string {
    return path.join(this.recoveryDir, `${id}.json`);
  }

  private async readSnapshot(snapshotPath: string): Promise<RecoverySnapshot | null> {
    try {
      const raw = await fs.promises.readFile(snapshotPath, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_RECOVERY_SNAPSHOT_BYTES) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!this.isSnapshot(parsed)) return null;
      return parsed;
    } catch (error) {
      if (this.errorCode(error) !== 'ENOENT')
        console.error('Recovery store skipped an unreadable snapshot:', this.errorCode(error));
      return null;
    }
  }

  private isSnapshot(value: unknown): value is RecoverySnapshot {
    if (!value || typeof value !== 'object') return false;
    const snapshot = value as Partial<RecoverySnapshot>;
    return (
      snapshot.schemaVersion === RECOVERY_SCHEMA_VERSION &&
      typeof snapshot.id === 'string' &&
      RECOVERY_ID.test(snapshot.id) &&
      (snapshot.filePath === null || typeof snapshot.filePath === 'string') &&
      typeof snapshot.title === 'string' &&
      typeof snapshot.content === 'string' &&
      typeof snapshot.savedContent === 'string' &&
      typeof snapshot.encoding === 'string' &&
      (snapshot.lineEnding === 'LF' || snapshot.lineEnding === 'CRLF') &&
      (snapshot.mode === 'wysiwyg' || snapshot.mode === 'ir' || snapshot.mode === 'sv') &&
      typeof snapshot.updatedAt === 'number' &&
      Number.isFinite(snapshot.updatedAt)
    );
  }

  private assertSnapshot(snapshot: unknown): asserts snapshot is RecoverySnapshot {
    if (!this.isSnapshot(snapshot)) throw new Error('Invalid recovery snapshot');
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_RECOVERY_SNAPSHOT_BYTES)
      throw new Error('Recovery snapshot exceeds the size limit');
  }

  private async diskState(
    snapshot: RecoverySnapshot,
  ): Promise<'unchanged' | 'changed' | 'unavailable'> {
    if (!snapshot.filePath) return 'unchanged';
    try {
      return (await fs.promises.readFile(snapshot.filePath, 'utf8')) === snapshot.savedContent
        ? 'unchanged'
        : 'changed';
    } catch {
      return 'unavailable';
    }
  }

  private async removeInvalidSnapshot(snapshotPath: string): Promise<void> {
    try {
      await fs.promises.unlink(snapshotPath);
      console.error('Recovery store removed an invalid snapshot.');
    } catch (error) {
      if (this.errorCode(error) !== 'ENOENT')
        console.error(
          'Recovery store could not remove an invalid snapshot:',
          this.errorCode(error),
        );
    }
  }

  private errorCode(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'unknown';
  }
}
