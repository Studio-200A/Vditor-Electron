import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as TOML from '@iarna/toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSISTENT_APP_STATE } from '../../src/main/services/app-state';
import { PersistentStateStore } from '../../src/main/services/persistent-state-store';
import { SettingsStore } from '../../src/main/services/settings-store';

describe('PersistentStateStore', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-state-'));
  });
  afterEach(() => fs.rmSync(configDir, { recursive: true, force: true }));

  it('migrates legacy TOML state once and keeps config.toml preference-only', () => {
    fs.writeFileSync(
      path.join(configDir, 'config.toml'),
      TOML.stringify({ files: { defaultOpenPath: '/notes', recentPaths: ['/notes'] } }),
    );
    const settings = new SettingsStore(configDir);
    const state = new PersistentStateStore(configDir, settings.getLegacyPersistentState());
    expect(state.migratedFromToml).toBe(true);
    expect(state.getAll()).toMatchObject({ defaultOpenPath: '/notes', recentPaths: ['/notes'] });
    expect(settings.removeLegacyPersistentStateFromDisk()).toBe(true);
    expect(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8')).not.toContain(
      'defaultOpenPath',
    );

    const existing = new PersistentStateStore(configDir, DEFAULT_PERSISTENT_APP_STATE);
    expect(existing.migratedFromToml).toBe(false);
    expect(existing.getAll().defaultOpenPath).toBe('/notes');
  });

  it('uses safe defaults for corrupt or unsupported state without blocking startup', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      fs.writeFileSync(path.join(configDir, 'state.json'), '{broken');
      expect(new PersistentStateStore(configDir, DEFAULT_PERSISTENT_APP_STATE).getAll()).toEqual(
        DEFAULT_PERSISTENT_APP_STATE,
      );
      fs.writeFileSync(path.join(configDir, 'state.json'), JSON.stringify({ schemaVersion: 2 }));
      expect(new PersistentStateStore(configDir, DEFAULT_PERSISTENT_APP_STATE).getAll()).toEqual(
        DEFAULT_PERSISTENT_APP_STATE,
      );
      fs.writeFileSync(
        path.join(configDir, 'state.json'),
        JSON.stringify({ schemaVersion: 1, defaultOpenPath: '/notes', sidebarWidth: 900 }),
      );
      expect(
        new PersistentStateStore(configDir, DEFAULT_PERSISTENT_APP_STATE).getAll(),
      ).toMatchObject({
        defaultOpenPath: '/notes',
        sidebarWidth: DEFAULT_PERSISTENT_APP_STATE.sidebarWidth,
      });
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('serializes atomic state updates and leaves preferences untouched when cleared', async () => {
    const settings = new SettingsStore(configDir);
    settings.update({ locale: 'zh_Hans' });
    const state = new PersistentStateStore(configDir, settings.getLegacyPersistentState());
    await Promise.all([
      state.updateOrThrow({ recentPaths: ['/notes'] }),
      state.updateOrThrow({ defaultOpenPath: '/notes' }),
    ]);
    expect(state.getAll()).toMatchObject({ recentPaths: ['/notes'], defaultOpenPath: '/notes' });
    await state.clearOrThrow();
    expect(state.getAll()).toEqual(DEFAULT_PERSISTENT_APP_STATE);
    expect(new SettingsStore(configDir).get('locale')).toBe('zh_Hans');
  });
});
