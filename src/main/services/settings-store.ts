import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AppSettings, DEFAULT_SETTINGS } from './app-state';

export class SettingsStore {
  private configDir: string;
  private configPath: string;
  private data: AppSettings;

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(os.homedir(), '.vditor-desktop');
    this.configPath = path.join(this.configDir, 'settings.json');

    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    this.data = this.load();
  }

  private load(): AppSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return this.deepMerge(DEFAULT_SETTINGS, parsed);
      }
    } catch {
      console.error('Failed to load settings, using defaults');
    }
    return { ...DEFAULT_SETTINGS };
  }

  private save(): void {
    const temporaryPath = `${this.configPath}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(temporaryPath, this.configPath);
    } catch (err) {
      console.error('Failed to save settings:', err);
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      } catch {
        // Preserve the original error and leave the previous settings file intact.
      }
    }
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.data[key];
  }

  getAll(): AppSettings {
    return structuredClone(this.data);
  }

  getPath(): string {
    return this.configPath;
  }

  reset(): AppSettings {
    this.data = structuredClone(DEFAULT_SETTINGS);
    this.save();
    return this.getAll();
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.data[key] = value;
    this.save();
  }

  update(settings: Partial<AppSettings>): AppSettings {
    this.data = this.deepMerge(this.data, settings);
    this.save();
    return this.getAll();
  }

  private deepMerge<T extends object>(defaults: T, overrides: Partial<T>): T {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const overrideVal = overrides[key];
      const defaultVal = defaults[key];
      if (
        overrideVal !== undefined &&
        overrideVal !== null &&
        typeof overrideVal === 'object' &&
        !Array.isArray(overrideVal) &&
        typeof defaultVal === 'object' &&
        !Array.isArray(defaultVal) &&
        defaultVal !== null
      ) {
        result[key] = this.deepMerge(
          defaultVal as Record<string, unknown>,
          overrideVal as Record<string, unknown>,
        ) as T[keyof T];
      } else if (overrideVal !== undefined) {
        result[key] = overrideVal as T[keyof T];
      }
    }
    return result;
  }
}
