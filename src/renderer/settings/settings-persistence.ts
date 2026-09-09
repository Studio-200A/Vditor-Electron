export interface SettingsPersistenceOptions<TSettings extends Record<string, unknown>> {
  readonly persistentKeys: ReadonlySet<string>;
  readonly savePreferences: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly savePersistentState: (
    settings: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  readonly getCurrent: () => TSettings;
  readonly setCurrent: (settings: TSettings) => void;
  readonly onFailure: (error: unknown) => void;
}

/** Serializes TOML preferences and state.json writes without mixing their result snapshots. */
export class SettingsPersistence<TSettings extends Record<string, unknown>> {
  private queue: Promise<TSettings>;

  constructor(private readonly options: SettingsPersistenceOptions<TSettings>) {
    this.queue = Promise.resolve(options.getCurrent());
  }

  save(settings: Record<string, unknown>, throwOnFailure = false): Promise<TSettings> {
    const preferences: Record<string, unknown> = {};
    const persistentState: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (this.options.persistentKeys.has(key)) persistentState[key] = value;
      else preferences[key] = value;
    }
    const queued = this.queue
      .catch(() => this.options.getCurrent())
      .then(async () => {
        let current = this.options.getCurrent();
        if (Object.keys(preferences).length > 0) {
          const saved = await this.options.savePreferences(preferences);
          // The preferences IPC result contains state defaults for compatibility. Merge only
          // keys written by this request so concurrent state.json data remains authoritative.
          const confirmed = Object.fromEntries(
            Object.keys(preferences).map((key) => [key, saved[key]]),
          );
          current = { ...current, ...confirmed };
          this.options.setCurrent(current);
        }
        if (Object.keys(persistentState).length > 0) {
          current = { ...current, ...(await this.options.savePersistentState(persistentState)) };
          this.options.setCurrent(current);
        }
        return current;
      });
    this.queue = queued;
    if (throwOnFailure) return queued;
    return queued.catch((error) => {
      this.options.onFailure(error);
      return this.options.getCurrent();
    });
  }
}
