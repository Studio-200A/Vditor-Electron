import type { AppStore } from '../state/store.js';
import type { AppSettings } from '../state/types.js';

export type SettingsImpact =
  | 'none'
  | 'presentation'
  | 'theme'
  | 'locale'
  | 'workspace-watch'
  | 'live-editor'
  | 'rebuild-editor';

export interface SettingsChange {
  readonly changedKeys: readonly string[];
  readonly impacts: ReadonlySet<SettingsImpact>;
  readonly shouldRebuildEditor: boolean;
}

const PRESENTATION_KEYS = new Set([
  'uiFontFamily',
  'uiZoom',
  'editorFontFamily',
  'editorFontSize',
  'previewFontFamily',
  'previewFontSize',
  'previewCodeFontFamily',
  'previewCodeFontSize',
  'editorTextWidth',
  'scrollbarMode',
  'toolbarVisible',
]);
const THEME_KEYS = new Set([
  'theme',
  'systemTheme',
  'lightTheme',
  'darkTheme',
  'contentTheme',
  'codeTheme',
  'lightCodeTheme',
  'darkCodeTheme',
]);

function valuesEqual(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous) === JSON.stringify(next);
}

/** Classifies settings by their explicit runtime effect; presentation never implies rebuild. */
export function classifySettingsChange(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  initializationSettings: ReadonlySet<string>,
): SettingsChange {
  const changedKeys = Object.keys(next).filter((key) => !valuesEqual(previous[key], next[key]));
  const impacts = new Set<SettingsImpact>();
  if (!changedKeys.length) impacts.add('none');
  if (changedKeys.some((key) => PRESENTATION_KEYS.has(key))) impacts.add('presentation');
  if (changedKeys.some((key) => THEME_KEYS.has(key))) impacts.add('theme');
  if (changedKeys.includes('locale')) impacts.add('locale');
  if (changedKeys.includes('workspaceReadDepth')) impacts.add('workspace-watch');
  if (changedKeys.includes('previewMode')) impacts.add('live-editor');
  const shouldRebuildEditor = changedKeys.some((key) => initializationSettings.has(key));
  if (shouldRebuildEditor) impacts.add('rebuild-editor');
  return { changedKeys, impacts, shouldRebuildEditor };
}

export interface SettingsControllerOptions {
  readonly store: AppStore;
  readonly save: (patch: Record<string, unknown>) => Promise<AppSettings>;
}

/** Owns settings/default-settings Store writes and serialized persistence requests. */
export class SettingsController {
  private readonly store: AppStore;
  private readonly save: SettingsControllerOptions['save'];

  constructor(options: SettingsControllerOptions) {
    this.store = options.store;
    this.save = options.save;
  }

  load(settings: AppSettings, defaults: AppSettings): void {
    this.store.updateSettings(settings);
    this.store.updateDefaultSettings(defaults);
  }

  async savePatch(patch: Record<string, unknown>): Promise<AppSettings> {
    const settings = await this.save(patch);
    this.store.updateSettings(settings);
    return settings;
  }

  async reset(resetSettings: () => Promise<AppSettings>): Promise<AppSettings> {
    const settings = await resetSettings();
    this.store.updateSettings(settings);
    return settings;
  }
}
