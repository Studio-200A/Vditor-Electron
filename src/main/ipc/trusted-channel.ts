import { normalizeIpcError, requireTrustedMainFrame } from '../ipc-guard';

export type TrustedInvokeHandler = (
  event: Electron.IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;
export type TrustedMessageHandler = (event: Electron.IpcMainEvent, ...args: unknown[]) => void;

/**
 * Narrow, Electron-free registration capability so callers decide where
 * handlers are registered (index.ts passes ipcMain; unit tests capture
 * registrations without importing Electron).
 */
export interface TrustedChannelRegistrationDeps {
  registerInvoke(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
  registerMessage(
    channel: string,
    listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void,
  ): void;
  getMainWindow(): Electron.BrowserWindow | null;
}

export interface TrustedChannelRegistration {
  handleTrusted(channel: string, handler: TrustedInvokeHandler): void;
  onTrusted(channel: string, handler: TrustedMessageHandler): void;
}

export function createTrustedChannelRegistration(
  deps: TrustedChannelRegistrationDeps,
): TrustedChannelRegistration {
  function reportIpcFailure(channel: string, error: unknown): Error {
    const normalized = normalizeIpcError(error);
    if (!(
      normalized instanceof Error &&
      'code' in normalized &&
      (normalized.code === 'IPC_UNTRUSTED_RENDERER' || normalized.code === 'IPC_INVALID_ARGUMENT')
    ))
      console.error(`IPC ${channel} failed:`, error);
    return normalized;
  }

  function handleTrusted(channel: string, handler: TrustedInvokeHandler): void {
    deps.registerInvoke(channel, async (event, ...args) => {
      // The trust check deliberately runs outside try/catch: an untrusted
      // caller must receive the raw IPC_UNTRUSTED_RENDERER rejection, not a
      // normalized error, and the handler must not run at all.
      requireTrustedMainFrame(event, deps.getMainWindow()?.webContents);
      try {
        return await handler(event, ...args);
      } catch (error) {
        throw reportIpcFailure(channel, error);
      }
    });
  }

  function onTrusted(channel: string, handler: TrustedMessageHandler): void {
    deps.registerMessage(channel, (event, ...args) => {
      // Messages have no return channel; a rejected trust check is reported
      // through the shared failure path without crashing the main process.
      try {
        requireTrustedMainFrame(event, deps.getMainWindow()?.webContents);
        handler(event, ...args);
      } catch (error) {
        reportIpcFailure(channel, error);
      }
    });
  }

  return { handleTrusted, onTrusted };
}
