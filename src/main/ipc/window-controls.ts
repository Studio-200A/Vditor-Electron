import { IPC_CHANNELS } from '../ipc-contract';
import { parseFiniteNumber, requireArgumentCount } from '../ipc-validation';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface WindowControlsIpcDeps {
  getMainWindow(): Electron.BrowserWindow | null;
  isWindowMaximized(): boolean;
  toggleWindowMaximized(): void;
  registration: TrustedChannelRegistration;
}

export function registerWindowControlsIpcHandlers(deps: WindowControlsIpcDeps): void {
  const { handleTrusted, onTrusted } = deps.registration;
  const { getMainWindow, isWindowMaximized, toggleWindowMaximized } = deps;

  handleTrusted(IPC_CHANNELS.appIsFullscreen, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return getMainWindow()?.isFullScreen() || false;
  });
  handleTrusted(IPC_CHANNELS.appIsMaximized, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return isWindowMaximized();
  });
  handleTrusted(IPC_CHANNELS.appSetZoomFactor, (_event, ...args) => {
    requireArgumentCount(args, 1);
    const factor = parseFiniteNumber(args[0], 75, 200) / 100;
    getMainWindow()?.webContents.setZoomFactor(factor);
    return factor;
  });
  onTrusted(IPC_CHANNELS.appToggleFullscreen, (_event, ...args) => {
    requireArgumentCount(args, 0);
    const mainWindow = getMainWindow();
    mainWindow?.setFullScreen(!mainWindow.isFullScreen());
  });
  onTrusted(IPC_CHANNELS.windowMinimize, (_event, ...args) => {
    requireArgumentCount(args, 0);
    getMainWindow()?.minimize();
  });
  onTrusted(IPC_CHANNELS.windowMaximize, (_event, ...args) => {
    requireArgumentCount(args, 0);
    toggleWindowMaximized();
  });
  onTrusted(IPC_CHANNELS.windowClose, (_event, ...args) => {
    requireArgumentCount(args, 0);
    getMainWindow()?.close();
  });
}
