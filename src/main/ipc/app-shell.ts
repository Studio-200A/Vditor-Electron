import { app, nativeTheme } from 'electron';
import { IPC_CHANNELS } from '../ipc-contract';
import { requireArgumentCount } from '../ipc-validation';
import type { SettingsStore } from '../services/settings-store';
import type { WindowCloseConfirmation } from '../services/window-close-confirmation';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface AppShellIpcDeps {
  getMainWindow(): Electron.BrowserWindow | null;
  settingsStore: SettingsStore;
  windowCloseConfirmation: WindowCloseConfirmation<Electron.BrowserWindow>;
  /** Marks the renderer ready and flushes queued open-file requests. */
  onRendererReady(): void;
  registration: TrustedChannelRegistration;
}

export function registerAppShellIpcHandlers(deps: AppShellIpcDeps): void {
  const { handleTrusted, onTrusted } = deps.registration;
  const { getMainWindow, settingsStore, windowCloseConfirmation, onRendererReady } = deps;

  handleTrusted(IPC_CHANNELS.appGetSystemLocale, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return app.getLocale();
  });
  handleTrusted(IPC_CHANNELS.appGetSystemTheme, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'classic';
  });
  handleTrusted(IPC_CHANNELS.appGetInfo, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return {
      app: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      vditor: '3.11.3',
    };
  });
  onTrusted(IPC_CHANNELS.appRendererReady, (_event, ...args) => {
    requireArgumentCount(args, 0);
    onRendererReady();
  });
  onTrusted(IPC_CHANNELS.appToggleDevTools, (_event, ...args) => {
    requireArgumentCount(args, 0);
    const mainWindow = getMainWindow();
    if (!mainWindow || !settingsStore.get('devToolsEnabled')) return;
    mainWindow.webContents.toggleDevTools();
  });
  onTrusted(IPC_CHANNELS.appCloseConfirmed, (_event, ...args) => {
    requireArgumentCount(args, 0);
    const mainWindow = getMainWindow();
    if (mainWindow) windowCloseConfirmation.confirm(mainWindow);
    mainWindow?.close();
  });
}
