import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as TOML from '@iarna/toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        appearance: { lastLightTheme: 'claude-light', lastDarkTheme: 'claude-dark' },
        unknownSection: { theme: 'dark' },
      }),
    );

    const settings = new SettingsStore(configDir).getAll() as Record<string, unknown>;
    expect(settings).not.toHaveProperty('sessionRestore');
    expect(settings).not.toHaveProperty('unknownSetting');
    expect(settings).not.toHaveProperty('lastLightTheme');
    expect(settings).not.toHaveProperty('lastDarkTheme');
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.lightTheme).toBe(DEFAULT_SETTINGS.lightTheme);
    expect(settings.darkTheme).toBe(DEFAULT_SETTINGS.darkTheme);
  });

  it('persists changed values', () => {
    const store = new SettingsStore(configDir);
    store.set('editorZoom', 125);

    expect(new SettingsStore(configDir).get('editorZoom')).toBe(125);
    const contents = fs.readFileSync(store.getPath(), 'utf8');
    expect(contents).toContain('[application]');
    expect(contents).toContain('devToolsEnabled = false');
    expect(contents).toContain('[appearance]');
    expect(contents).toContain('editorZoom = 125');
    expect(contents).toContain('[editor.toolbarConfig]');
    expect(contents).toContain('[window.bounds]');
    expect(contents).toContain('[window.settingsDialog]');
    expect(fs.existsSync(path.join(configDir, 'settings.json'))).toBe(false);
  });

  it('reports strict persistence failures without changing in-memory settings', () => {
    const fileSystem = {
      ...fs,
      renameSync: vi.fn<typeof fs.renameSync>(() => {
        throw new Error('settings replacement failed');
      }),
    };
    const store = new SettingsStore(configDir, fileSystem);

    expect(() => store.updateOrThrow({ locale: 'zh_Hans' })).toThrow('Unable to persist settings.');
    expect(store.get('locale')).toBe(DEFAULT_SETTINGS.locale);
    expect(fs.existsSync(path.join(configDir, 'config.toml'))).toBe(false);
    expect(fs.readdirSync(configDir)).toEqual([]);
  });

  it('persists workspace directory read depth within its supported bounds', () => {
    const store = new SettingsStore(configDir);
    store.update({ workspaceReadDepth: 12 });

    expect(new SettingsStore(configDir).get('workspaceReadDepth')).toBe(12);

    store.update({ workspaceReadDepth: 100 });
    expect(new SettingsStore(configDir).get('workspaceReadDepth')).toBe(12);
    expect(fs.readFileSync(store.getPath(), 'utf8')).toContain('workspaceReadDepth = 12');
  });

  it('updates multiple values in a single settings snapshot', () => {
    const store = new SettingsStore(configDir);
    const settings = store.update({
      theme: 'monokai-pro-dark',
      darkTheme: 'monokai-pro-dark',
      devToolsEnabled: true,
      lightCodeTheme: 'atom-one-light',
      darkCodeTheme: 'monokai-sublime',
      editorZoom: 125,
      scrollbarMode: 'hidden',
      workspaceTreeStates: [
        { workspacePath: '/notes', expandedPaths: ['/notes/docs', '/notes/assets'] },
      ],
    });

    expect(settings.theme).toBe('monokai-pro-dark');
    expect(settings.darkTheme).toBe('monokai-pro-dark');
    expect(settings.devToolsEnabled).toBe(true);
    expect(settings.lightCodeTheme).toBe('atom-one-light');
    expect(settings.darkCodeTheme).toBe('monokai-sublime');
    expect(settings.editorZoom).toBe(125);
    expect(settings.scrollbarMode).toBe('hidden');
    expect(settings.workspaceTreeStates).toEqual([
      { workspacePath: '/notes', expandedPaths: ['/notes/docs', '/notes/assets'] },
    ]);
    expect(new SettingsStore(configDir).getAll()).toEqual(settings);
  });

  it('persists separately selected light and dark theme preferences', () => {
    const store = new SettingsStore(configDir);
    const settings = store.update({
      theme: 'claude-dark',
      lightTheme: 'claude-light',
      darkTheme: 'claude-dark',
    });

    expect(settings).toMatchObject({
      theme: 'claude-dark',
      lightTheme: 'claude-light',
      darkTheme: 'claude-dark',
    });
    expect(new SettingsStore(configDir).getAll()).toMatchObject(settings);
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
