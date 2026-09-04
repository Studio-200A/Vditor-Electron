import * as fs from 'node:fs';
import * as path from 'node:path';
import { parsePersistentStatePatch } from '../ipc-validation';
import { DEFAULT_PERSISTENT_APP_STATE, PersistentAppState } from './app-state';

type StateFileSystem = Pick<
  typeof fs,
  'existsSync' | 'mkdirSync' | 'readFileSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync'
>;

export class PersistentStatePersistenceError extends Error {
  readonly code = 'PERSISTENT_STATE_PERSIST_FAILED' as const;

  constructor() {
    super('Unable to persist application state.');
    this.name = 'PersistentStatePersistenceError';
  }
}

/**
 * Owns the versioned, cross-launch state file. Synchronous replacement keeps every individual
 * write atomic; the promise queue makes renderer-originated patches deterministic as well.
 */
export class PersistentStateStore {
  private readonly statePath: string;
  private data: PersistentAppState;
  private writeQueue: Promise<void> = Promise.resolve();
  readonly migratedFromToml: boolean;

  constructor(
    configDir: string,
    legacyState: PersistentAppState,
    private readonly fileSystem: StateFileSystem = fs,
  ) {
    if (!this.fileSystem.existsSync(configDir))
      this.fileSystem.mkdirSync(configDir, { recursive: true });
    this.statePath = path.join(configDir, 'state.json');
    const loaded = this.load();
    if (loaded) {
      this.data = loaded;
      this.migratedFromToml = false;
      return;
    }
    this.data = this.normalize(legacyState);
    if (!this.save(this.data)) {
      console.error('Failed to migrate persistent application state; using in-memory defaults.');
      this.data = structuredClone(DEFAULT_PERSISTENT_APP_STATE);
    }
    this.migratedFromToml = true;
  }

  getAll(): PersistentAppState {
    return structuredClone(this.data);
  }

  getPath(): string {
    return this.statePath;
  }

  async updateOrThrow(patch: Partial<PersistentAppState>): Promise<PersistentAppState> {
    let saved: PersistentAppState | undefined;
    const operation = this.writeQueue
      .catch(() => undefined)
      .then(() => {
        const next = this.normalize({ ...this.data, ...patch, schemaVersion: 1 });
        if (!this.save(next)) throw new PersistentStatePersistenceError();
        this.data = next;
        saved = this.getAll();
      });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    return saved!;
  }

  async clearOrThrow(): Promise<PersistentAppState> {
    return this.updateOrThrow(structuredClone(DEFAULT_PERSISTENT_APP_STATE));
  }

  private load(): PersistentAppState | null {
    if (!this.fileSystem.existsSync(this.statePath)) return null;
    try {
      const parsed: unknown = JSON.parse(this.fileSystem.readFileSync(this.statePath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('Persistent state must be an object.');
      const source = parsed as Record<string, unknown>;
      if (source.schemaVersion !== 1) throw new Error('Unsupported persistent state schema.');
      const valid: Partial<PersistentAppState> = { schemaVersion: 1 };
      for (const [key, value] of Object.entries(source)) {
        if (key === 'schemaVersion') continue;
        try {
          Object.assign(valid, parsePersistentStatePatch({ schemaVersion: 1, [key]: value }));
        } catch {
          console.error(`Invalid persistent state field "${key}", using its default.`);
        }
      }
      return this.normalize(valid);
    } catch (error) {
      console.error('Failed to load persistent application state, using defaults:', error);
      return structuredClone(DEFAULT_PERSISTENT_APP_STATE);
    }
  }

  private normalize(value: Partial<PersistentAppState>): PersistentAppState {
    const merged = { ...DEFAULT_PERSISTENT_APP_STATE, ...value };
    return {
      ...merged,
      schemaVersion: 1,
      recentPaths: structuredClone(merged.recentPaths),
      recentFiles: structuredClone(merged.recentFiles),
      workspaceTreeStates: structuredClone(merged.workspaceTreeStates),
      windowBounds: structuredClone(merged.windowBounds),
      settingsDialogSize: structuredClone(merged.settingsDialogSize),
      session: structuredClone(merged.session),
    };
  }

  private save(data: PersistentAppState): boolean {
    const temporaryPath = `${this.statePath}.tmp`;
    try {
      this.fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      this.fileSystem.renameSync(temporaryPath, this.statePath);
      return true;
    } catch (error) {
      console.error('Failed to save persistent application state:', error);
      try {
        if (this.fileSystem.existsSync(temporaryPath)) this.fileSystem.unlinkSync(temporaryPath);
      } catch {
        // Leave the old atomically-replaced file intact and preserve the write failure.
      }
      return false;
    }
  }
}
