import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
    expect(store.getPath()).toBe(path.join(configDir, 'settings.json'));
  });

  it('deep-merges an older partial settings file with new defaults', () => {
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({ locale: 'zh_CN', toolbarConfig: { hide: true } }),
    );

    const settings = new SettingsStore(configDir).getAll();
    expect(settings.locale).toBe('zh_CN');
    expect(settings.toolbarConfig).toEqual({ hide: true, pin: false });
    expect(settings.uiZoom).toBe(DEFAULT_SETTINGS.uiZoom);
  });

  it('drops fields that are not part of the current settings schema', () => {
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({ sessionRestore: false, unknownSetting: true }),
    );

    const settings = new SettingsStore(configDir).getAll() as Record<string, unknown>;
    expect(settings).not.toHaveProperty('sessionRestore');
    expect(settings).not.toHaveProperty('unknownSetting');
  });

  it('persists changed values', () => {
    const store = new SettingsStore(configDir);
    store.set('editorZoom', 125);

    expect(new SettingsStore(configDir).get('editorZoom')).toBe(125);
  });

  it('updates multiple values in a single settings snapshot', () => {
    const store = new SettingsStore(configDir);
    const settings = store.update({ theme: 'dark', editorZoom: 125 });

    expect(settings.theme).toBe('dark');
    expect(settings.editorZoom).toBe(125);
    expect(new SettingsStore(configDir).getAll()).toEqual(settings);
  });

  it('returns clones instead of mutable internal state', () => {
    const store = new SettingsStore(configDir);
    const settings = store.getAll();
    settings.toolbarConfig.hide = true;

    expect(store.get('toolbarConfig').hide).toBe(false);
  });

  it('resets both memory and the settings file', () => {
    const store = new SettingsStore(configDir);
    store.set('locale', 'zh_CN');

    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(configDir).get('locale')).toBe(DEFAULT_SETTINGS.locale);
  });
});
