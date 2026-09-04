import * as fs from 'node:fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';
import { parseSettingsPatch } from '../ipc-validation';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  PersistentAppState,
  normalizeWorkspaceReadDepth,
} from './app-state';

type SettingsDocument = {
  application: Pick<AppSettings, 'restoreTabs' | 'restoreWorkspace' | 'devToolsEnabled' | 'locale'>;
  appearance: Pick<
    AppSettings,
    | 'systemTheme'
    | 'theme'
    | 'lightTheme'
    | 'darkTheme'
    | 'contentTheme'
    | 'codeTheme'
    | 'lightCodeTheme'
    | 'darkCodeTheme'
    | 'iconSet'
    | 'uiZoom'
    | 'editorZoom'
    | 'previewZoom'
    | 'scrollbarMode'
  >;
  fonts: Pick<
    AppSettings,
    | 'uiFontFamily'
    | 'editorFontFamily'
    | 'editorFontSize'
    | 'previewFontFamily'
    | 'previewFontSize'
    | 'previewCodeFontFamily'
    | 'previewCodeFontSize'
  >;
  editor: Pick<
    AppSettings,
    | 'editMode'
    | 'previewMode'
    | 'placeholder'
    | 'typewriterMode'
    | 'tabString'
    | 'tabInsertSpaces'
    | 'tabSize'
    | 'showWhitespace'
    | 'autoIndent'
    | 'rtl'
    | 'wordWrap'
    | 'editorTextWidth'
    | 'previewTextWidth'
    | 'splitRatio'
    | 'toolbarConfig'
    | 'toolbarItems'
  >;
  preview: Pick<
    AppSettings,
    | 'previewDelay'
    | 'previewMaxWidth'
    | 'multiPlatformPreview'
    | 'mathEngine'
    | 'enableHighlight'
    | 'lineNumbers'
    | 'enableAutoSpace'
    | 'enableCallout'
    | 'enableFootnotes'
    | 'enableImageCaption'
    | 'enableMark'
    | 'enableSub'
    | 'enableSup'
    | 'scrollSync'
    | 'paragraphBeginningSpace'
    | 'fixTermTypo'
    | 'gfmAutoLink'
    | 'toc'
    | 'listStyle'
    | 'headingAnchor'
    | 'sanitize'
    | 'allowSvgImages'
  >;
  files: Pick<
    AppSettings,
    | 'autoSave'
    | 'autoSaveDelay'
    | 'pasteImagesDir'
    | 'imageMaxWidth'
    | 'imageQuality'
    | 'workspaceReadDepth'
  >;
  workspace: Pick<AppSettings, 'fileExplorer'>;
  /** Accepted only as an upgrade input; new config.toml files never write these fields. */
  window?: Pick<AppSettings, 'windowMaximized'> & {
    bounds?: AppSettings['windowBounds'];
    settingsDialog?: AppSettings['settingsDialogSize'];
  };
  session?: AppSettings['session'];
};

type SettingsFileSystem = Pick<
  typeof fs,
  'existsSync' | 'mkdirSync' | 'readFileSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync'
>;

export class SettingsPersistenceError extends Error {
  readonly code = 'SETTINGS_PERSIST_FAILED' as const;

  constructor() {
    super('Unable to persist settings.');
    this.name = 'SettingsPersistenceError';
  }
}

const pick = <K extends keyof AppSettings>(
  settings: AppSettings,
  keys: readonly K[],
): Pick<AppSettings, K> =>
  Object.fromEntries(keys.map((key) => [key, settings[key]])) as Pick<AppSettings, K>;

export class SettingsStore {
  private configDir: string;
  private configPath: string;
  private data: AppSettings;

  constructor(
    configDir?: string,
    private readonly fileSystem: SettingsFileSystem = fs,
  ) {
    this.configDir = configDir || path.join(os.homedir(), '.vditor-desktop');
    this.configPath = path.join(this.configDir, 'config.toml');

    if (!this.fileSystem.existsSync(this.configDir)) {
      this.fileSystem.mkdirSync(this.configDir, { recursive: true });
    }

    this.data = this.load();
  }

  private load(): AppSettings {
    try {
      if (this.fileSystem.existsSync(this.configPath)) {
        const raw = this.fileSystem.readFileSync(this.configPath, 'utf-8');
        const parsed = TOML.parse(raw) as unknown as Partial<SettingsDocument>;
        const merged = this.deepMerge(DEFAULT_SETTINGS, this.fromDocument(parsed));
        const settings = this.validateLoadedSettings(merged);
        return {
          ...settings,
          workspaceReadDepth: normalizeWorkspaceReadDepth(settings.workspaceReadDepth),
        };
      }
    } catch {
      console.error('Failed to load settings, using defaults');
    }
    return { ...DEFAULT_SETTINGS };
  }

  private validateLoadedSettings(settings: AppSettings): AppSettings {
    const validSettings: Partial<AppSettings> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      try {
        Object.assign(validSettings, parseSettingsPatch({ [key]: settings[key] }));
      } catch {
        console.error(`Invalid persisted setting "${String(key)}", using its default`);
      }
    }
    return this.deepMerge(DEFAULT_SETTINGS, validSettings);
  }

  private save(data: AppSettings): boolean {
    const temporaryPath = `${this.configPath}.tmp`;
    try {
      this.fileSystem.writeFileSync(
        temporaryPath,
        TOML.stringify(this.withoutUndefined(this.toDocument(data)) as TOML.JsonMap),
        'utf-8',
      );
      this.fileSystem.renameSync(temporaryPath, this.configPath);
      return true;
    } catch (err) {
      console.error('Failed to save settings:', err);
      try {
        if (this.fileSystem.existsSync(temporaryPath)) this.fileSystem.unlinkSync(temporaryPath);
      } catch {
        // Preserve the original error and leave the previous settings file intact.
      }
      return false;
    }
  }

  private commit(nextData: AppSettings, throwOnFailure: boolean): AppSettings {
    if (this.save(nextData)) this.data = nextData;
    else if (throwOnFailure) throw new SettingsPersistenceError();
    return this.getAll();
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

  getLegacyPersistentState(): PersistentAppState {
    const settings = this.data;
    return {
      schemaVersion: 1,
      defaultOpenPath: settings.defaultOpenPath,
      recentPaths: structuredClone(settings.recentPaths),
      recentFiles: structuredClone(settings.recentFiles),
      workspaceTreeStates: structuredClone(settings.workspaceTreeStates),
      sidebarWidth: settings.sidebarWidth,
      sidebarVisible: settings.sidebarVisible,
      toolbarVisible: settings.toolbarVisible,
      windowBounds: structuredClone(settings.windowBounds),
      windowMaximized: settings.windowMaximized,
      settingsDialogSize: structuredClone(settings.settingsDialogSize),
      session: structuredClone(settings.session),
    };
  }

  removeLegacyPersistentStateFromDisk(): boolean {
    return this.save(this.data);
  }

  reset(): AppSettings {
    return this.commit(structuredClone(DEFAULT_SETTINGS), false);
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.commit({ ...this.data, [key]: value }, false);
  }

  update(settings: Partial<AppSettings>): AppSettings {
    return this.commit(this.nextData(settings), false);
  }

  updateOrThrow(settings: Partial<AppSettings>): AppSettings {
    return this.commit(this.nextData(settings), true);
  }

  private nextData(settings: Partial<AppSettings>): AppSettings {
    const updated = this.deepMerge(this.data, settings);
    return {
      ...updated,
      workspaceReadDepth: normalizeWorkspaceReadDepth(updated.workspaceReadDepth),
    };
  }

  private toDocument(settings: AppSettings): SettingsDocument {
    return {
      application: pick(settings, ['restoreTabs', 'restoreWorkspace', 'devToolsEnabled', 'locale']),
      appearance: pick(settings, [
        'systemTheme',
        'theme',
        'lightTheme',
        'darkTheme',
        'contentTheme',
        'codeTheme',
        'lightCodeTheme',
        'darkCodeTheme',
        'iconSet',
        'uiZoom',
        'editorZoom',
        'previewZoom',
        'scrollbarMode',
      ]),
      fonts: pick(settings, [
        'uiFontFamily',
        'editorFontFamily',
        'editorFontSize',
        'previewFontFamily',
        'previewFontSize',
        'previewCodeFontFamily',
        'previewCodeFontSize',
      ]),
      editor: pick(settings, [
        'editMode',
        'previewMode',
        'placeholder',
        'typewriterMode',
        'tabString',
        'tabInsertSpaces',
        'tabSize',
        'showWhitespace',
        'autoIndent',
        'rtl',
        'wordWrap',
        'editorTextWidth',
        'previewTextWidth',
        'splitRatio',
        'toolbarConfig',
        'toolbarItems',
      ]),
      preview: pick(settings, [
        'previewDelay',
        'previewMaxWidth',
        'multiPlatformPreview',
        'mathEngine',
        'enableHighlight',
        'lineNumbers',
        'enableAutoSpace',
        'enableCallout',
        'enableFootnotes',
        'enableImageCaption',
        'enableMark',
        'enableSub',
        'enableSup',
        'scrollSync',
        'paragraphBeginningSpace',
        'fixTermTypo',
        'gfmAutoLink',
        'toc',
        'listStyle',
        'headingAnchor',
        'sanitize',
        'allowSvgImages',
      ]),
      files: pick(settings, [
        'autoSave',
        'autoSaveDelay',
        'pasteImagesDir',
        'imageMaxWidth',
        'imageQuality',
        'workspaceReadDepth',
      ]),
      workspace: pick(settings, ['fileExplorer']),
    };
  }

  private fromDocument(document: Partial<SettingsDocument>): Partial<AppSettings> {
    const { bounds, settingsDialog, ...windowSettings } = document.window || {};
    return {
      ...document.application,
      ...document.appearance,
      ...document.fonts,
      ...document.editor,
      ...document.preview,
      ...document.files,
      ...document.workspace,
      ...windowSettings,
      ...(bounds ? { windowBounds: bounds } : {}),
      ...(settingsDialog ? { settingsDialogSize: settingsDialog } : {}),
      ...(document.session ? { session: document.session } : {}),
    };
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

  private withoutUndefined(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.withoutUndefined(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, this.withoutUndefined(item)]),
      );
    }
    return value;
  }
}
