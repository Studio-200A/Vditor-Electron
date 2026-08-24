import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_IDENTIFIER, resolveApplicationPaths } from '../../src/main/app-paths';

describe('application paths', () => {
  it('uses XDG configuration and data homes on Linux', () => {
    expect(
      resolveApplicationPaths(
        'linux',
        { XDG_CONFIG_HOME: '/xdg/config', XDG_DATA_HOME: '/xdg/data' },
        '/home/user',
      ),
    ).toEqual({
      configDir: '/xdg/config/vditor-desktop',
      configFile: '/xdg/config/vditor-desktop/config.toml',
      recoveryDir: '/xdg/data/vditor-desktop/recovery',
      chromiumDir: '/xdg/data/vditor-desktop/chromium',
    });
  });

  it('falls back to standard Linux paths when XDG paths are absent or relative', () => {
    expect(
      resolveApplicationPaths(
        'linux',
        { XDG_CONFIG_HOME: 'relative-config', XDG_DATA_HOME: 'relative-data' },
        '/home/user',
      ),
    ).toEqual({
      configDir: '/home/user/.config/vditor-desktop',
      configFile: '/home/user/.config/vditor-desktop/config.toml',
      recoveryDir: '/home/user/.local/share/vditor-desktop/recovery',
      chromiumDir: '/home/user/.local/share/vditor-desktop/chromium',
    });
  });

  it('separates roaming configuration from local Chromium data on Windows', () => {
    const roaming = 'C:\\Users\\User\\AppData\\Roaming';
    const local = 'C:\\Users\\User\\AppData\\Local';
    expect(
      resolveApplicationPaths(
        'win32',
        { APPDATA: roaming, LOCALAPPDATA: local },
        'C:\\Users\\User',
      ),
    ).toEqual({
      configDir: path.win32.join(roaming, 'vditor-desktop'),
      configFile: path.win32.join(roaming, 'vditor-desktop', 'config.toml'),
      recoveryDir: path.win32.join(local, 'vditor-desktop', 'recovery'),
      chromiumDir: path.win32.join(local, 'vditor-desktop', 'chromium'),
    });
  });

  it('uses the application identifier under macOS Application Support', () => {
    const root = `/Users/user/Library/Application Support/${APP_IDENTIFIER}`;
    expect(resolveApplicationPaths('darwin', {}, '/Users/user')).toEqual({
      configDir: `${root}/Config`,
      configFile: `${root}/Config/config.toml`,
      recoveryDir: `${root}/recovery`,
      chromiumDir: `${root}/Chromium`,
    });
  });

  it('supports isolated directories for automated tests', () => {
    expect(
      resolveApplicationPaths(
        'linux',
        {
          VDITOR_DESKTOP_CONFIG_DIR: '/tmp/test-config',
          VDITOR_DESKTOP_DATA_DIR: '/tmp/test-chromium',
        },
        '/home/user',
      ),
    ).toEqual({
      configDir: '/tmp/test-config',
      configFile: '/tmp/test-config/config.toml',
      recoveryDir: '/tmp/recovery',
      chromiumDir: '/tmp/test-chromium',
    });
  });
});
