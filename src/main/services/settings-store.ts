import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';
import { AppSettings, DEFAULT_SETTINGS, normalizeWorkspaceReadDepth } from './app-state';

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
  >;
  files: Pick<
    AppSettings,
    | 'autoSave'
    | 'autoSaveDelay'
    | 'pasteImagesDir'
    | 'imageMaxWidth'
    | 'imageQuality'
    | 'workspaceReadDepth'
    | 'defaultOpenPath'
    | 'recentPaths'
    | 'recentFiles'
  >;
  workspace: Pick<
    AppSettings,
    'sidebarWidth' | 'sidebarVisible' | 'toolbarVisible' | 'fileExplorer' | 'workspaceTreeStates'
  >;
  window: Pick<AppSettings, 'windowMaximized'> & {
    bounds: AppSettings['windowBounds'];
    settingsDialog: AppSettings['settingsDialogSize'];
  };
  session: AppSettings['session'];
};

const pick = <K extends keyof AppSettings>(
  settings: AppSettings,
  keys: readonly K[],
): Pick<AppSettings, K> =>
  Object.fromEntries(keys.map((key) => [key, settings[key]])) as Pick<AppSettings, K>;

export class SettingsStore {
  private configDir: string;
  private configPath: string;
  private data: AppSettings;

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(os.homedir(), '.vditor-desktop');
    this.configPath = path.join(this.configDir, 'config.toml');

    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    this.data = this.load();
  }

  private load(): AppSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = TOML.parse(raw) as unknown as Partial<SettingsDocument>;
        const settings = this.deepMerge(DEFAULT_SETTINGS, this.fromDocument(parsed));
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

  private save(): void {
    const temporaryPath = `${this.configPath}.tmp`;
    try {
      fs.writeFileSync(
        temporaryPath,
        TOML.stringify(this.withoutUndefined(this.toDocument(this.data)) as TOML.JsonMap),
        'utf-8',
      );
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
    const updated = this.deepMerge(this.data, settings);
    this.data = {
      ...updated,
      workspaceReadDepth: normalizeWorkspaceReadDepth(updated.workspaceReadDepth),
    };
    this.save();
    return this.getAll();
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
      ]),
      files: pick(settings, [
        'autoSave',
        'autoSaveDelay',
        'pasteImagesDir',
        'imageMaxWidth',
        'imageQuality',
        'workspaceReadDepth',
        'defaultOpenPath',
        'recentPaths',
        'recentFiles',
      ]),
      workspace: pick(settings, [
        'sidebarWidth',
        'sidebarVisible',
        'toolbarVisible',
        'fileExplorer',
        'workspaceTreeStates',
      ]),
      window: {
        windowMaximized: settings.windowMaximized,
        bounds: settings.windowBounds,
        settingsDialog: settings.settingsDialogSize,
      },
      session: settings.session,
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
