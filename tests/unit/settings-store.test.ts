import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as TOML from '@iarna/toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/main/services/app-state';
import { SettingsStore } from '../../src/main/services/settings-store';

describe('SettingsStore', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-settings-'));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('starts with the application defaults', () => {
    const store = new SettingsStore(configDir);
    expect(store.getAll()).toEqual(DEFAULT_SETTINGS);
    expect(store.getPath()).toBe(path.join(configDir, 'config.toml'));
  });

  it('deep-merges a partial TOML settings file with defaults', () => {
    fs.writeFileSync(
      path.join(configDir, 'config.toml'),
      TOML.stringify({
        application: { locale: 'zh_Hans' },
        editor: { toolbarConfig: { hide: true } },
      }),
    );

    const settings = new SettingsStore(configDir).getAll();
    expect(settings.locale).toBe('zh_Hans');
    expect(settings.toolbarConfig).toEqual({ hide: true, pin: false });
    expect(settings.uiZoom).toBe(DEFAULT_SETTINGS.uiZoom);
  });

  it('drops fields that are not part of the current settings schema', () => {
    fs.writeFileSync(
      path.join(configDir, 'config.toml'),
      TOML.stringify({
        theme: 'dark',
        application: { sessionRestore: false, unknownSetting: true },
        unknownSection: { theme: 'dark' },
      }),
    );

    const settings = new SettingsStore(configDir).getAll() as Record<string, unknown>;
    expect(settings).not.toHaveProperty('sessionRestore');
    expect(settings).not.toHaveProperty('unknownSetting');
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('persists changed values', () => {
    const store = new SettingsStore(configDir);
    store.set('editorZoom', 125);

    expect(new SettingsStore(configDir).get('editorZoom')).toBe(125);
    const contents = fs.readFileSync(store.getPath(), 'utf8');
    expect(contents).toContain('[application]');
    expect(contents).toContain('[appearance]');
    expect(contents).toContain('editorZoom = 125');
    expect(contents).toContain('[editor.toolbarConfig]');
    expect(contents).toContain('[window.bounds]');
    expect(contents).toContain('[window.settingsDialog]');
    expect(fs.existsSync(path.join(configDir, 'settings.json'))).toBe(false);
  });

  it('updates multiple values in a single settings snapshot', () => {
    const store = new SettingsStore(configDir);
    const settings = store.update({
      theme: 'monokai-pro-dark',
      lastDarkTheme: 'monokai-pro-dark',
      lightCodeTheme: 'atom-one-light',
      darkCodeTheme: 'monokai-sublime',
      editorZoom: 125,
    });

    expect(settings.theme).toBe('monokai-pro-dark');
    expect(settings.lastDarkTheme).toBe('monokai-pro-dark');
    expect(settings.lightCodeTheme).toBe('atom-one-light');
    expect(settings.darkCodeTheme).toBe('monokai-sublime');
    expect(settings.editorZoom).toBe(125);
    expect(new SettingsStore(configDir).getAll()).toEqual(settings);
  });

  it('persists the settings dialog size in the window section', () => {
    const store = new SettingsStore(configDir);
    store.set('settingsDialogSize', { width: 920, height: 640, customized: true });

    expect(new SettingsStore(configDir).get('settingsDialogSize')).toEqual({
      width: 920,
      height: 640,
      customized: true,
    });
    const document = TOML.parse(fs.readFileSync(store.getPath(), 'utf8'));
    expect(document.window.settingsDialog).toEqual({
      width: 920,
      height: 640,
      customized: true,
    });
  });

  it('returns clones instead of mutable internal state', () => {
    const store = new SettingsStore(configDir);
    const settings = store.getAll();
    settings.toolbarConfig.hide = true;

    expect(store.get('toolbarConfig').hide).toBe(false);
  });

  it('resets both memory and the settings file', () => {
    const store = new SettingsStore(configDir);
    store.set('locale', 'zh_Hans');

    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(configDir).get('locale')).toBe(DEFAULT_SETTINGS.locale);
  });
});
