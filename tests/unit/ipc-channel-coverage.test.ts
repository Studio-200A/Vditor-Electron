import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The domain IPC modules import Electron APIs (dialog, clipboard, shell,
// session, app, nativeTheme, BrowserWindow) that are never called during
// registration; stub them so the composition entry can be imported without a
// real Electron runtime.
vi.mock('electron', () => ({
  app: { getLocale: vi.fn(), getVersion: vi.fn(), getPath: vi.fn() },
  BrowserWindow: class {},
  clipboard: { readText: vi.fn(), read: vi.fn(), writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  session: { defaultSession: { clearCache: vi.fn() } },
  shell: {
    trashItem: vi.fn(),
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

import { IPC_CHANNELS } from '../../src/main/ipc-contract';
import { registerIpcHandlers } from '../../src/main/ipc/register';
import { FileManagerService } from '../../src/main/services/file-manager';
import { FileWatchService } from '../../src/main/services/file-watch-service';
import { RecoveryStore } from '../../src/main/services/recovery-store';
import { SettingsStore } from '../../src/main/services/settings-store';
import { PersistentStateStore } from '../../src/main/services/persistent-state-store';
import { ResourceHealthService } from '../../src/main/services/resource-health-service';
import { WindowCloseConfirmation } from '../../src/main/services/window-close-confirmation';
import { DEFAULT_PERSISTENT_APP_STATE } from '../../src/main/services/app-state';
import { LocalResourcePolicy } from '../../src/main/local-resource';
import { FROZEN_CHANNEL_REGISTRATIONS, FROZEN_EVENT_CHANNELS } from './ipc-channel-map.fixture';

/**
 * Stage-5 registration coverage: the composition entry in ipc/register.ts must
 * register exactly the 56 invoke and 8 send channels frozen at the stage-0
 * baseline — no more, no fewer, no direction swaps — while never touching the
 * seven main-to-renderer event channels. Expectations come from the frozen
 * map, not from the registration results.
 */
describe('IPC channel registration coverage', () => {
  const invokeRegistrations: string[] = [];
  const sendRegistrations: string[] = [];
  let tempDirs: string[] = [];

  const addTempDir = (): string => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'vditor-ipc-coverage-'));
    tempDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    invokeRegistrations.length = 0;
    sendRegistrations.length = 0;
    tempDirs = [];
  });

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  const controlledDeps = () => ({
    registerInvoke: (channel: string) => {
      invokeRegistrations.push(channel);
    },
    registerMessage: (channel: string) => {
      sendRegistrations.push(channel);
    },
    getMainWindow: () => null,
    fileManager: new FileManagerService(),
    fileWatchService: new FileWatchService(
      () => Promise.resolve({ content: '', encoding: 'utf-8' as const }),
      () => undefined,
    ),
    settingsStore: new SettingsStore(addTempDir()),
    persistentStateStore: new PersistentStateStore(addTempDir(), DEFAULT_PERSISTENT_APP_STATE),
    recoveryStore: new RecoveryStore(addTempDir()),
    resourceHealthService: new ResourceHealthService(),
    localResourcePolicy: new LocalResourcePolicy({ privateRoots: [addTempDir()] }),
    windowCloseConfirmation: new WindowCloseConfirmation<object>(),
    isWindowMaximized: () => false,
    toggleWindowMaximized: () => undefined,
    tr: (english: string) => english,
    onMenuAffectingSettingsChanged: () => undefined,
    onMenuEligibilityChanged: () => undefined,
    onRendererReady: () => undefined,
  });

  it('registers every frozen invoke channel exactly once', () => {
    registerIpcHandlers(controlledDeps());

    const expected = FROZEN_CHANNEL_REGISTRATIONS.filter(
      (entry) => entry.direction === 'invoke',
    ).map((entry) => entry.channel);
    expect(invokeRegistrations).toHaveLength(expected.length);
    expect(new Set(invokeRegistrations)).toEqual(new Set(expected));
  });

  it('registers every frozen send channel exactly once', () => {
    registerIpcHandlers(controlledDeps());

    const expected = FROZEN_CHANNEL_REGISTRATIONS.filter((entry) => entry.direction === 'send').map(
      (entry) => entry.channel,
    );
    expect(sendRegistrations).toHaveLength(expected.length);
    expect(new Set(sendRegistrations)).toEqual(new Set(expected));
  });

  it('registers no duplicate or cross-direction channel', () => {
    registerIpcHandlers(controlledDeps());

    expect(new Set(invokeRegistrations).size).toBe(invokeRegistrations.length);
    expect(new Set(sendRegistrations).size).toBe(sendRegistrations.length);
    const overlap = invokeRegistrations.filter((channel) => sendRegistrations.includes(channel));
    expect(overlap).toEqual([]);
  });

  it('never registers main-to-renderer event channels', () => {
    registerIpcHandlers(controlledDeps());

    const registered = [...invokeRegistrations, ...sendRegistrations];
    for (const channel of FROZEN_EVENT_CHANNELS) {
      expect(registered).not.toContain(channel);
    }
  });

  it('registers only channels declared by the IPC contract', () => {
    registerIpcHandlers(controlledDeps());

    const declared = new Set(Object.values(IPC_CHANNELS));
    const registered = [...invokeRegistrations, ...sendRegistrations];
    const unknown = registered.filter((channel) => !declared.has(channel));
    expect(unknown).toEqual([]);
    expect(registered).toHaveLength(64);
  });
});
