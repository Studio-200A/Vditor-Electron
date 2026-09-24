import { clipboard, shell } from 'electron';
import { allowedExternalUrl } from '../external-url';
import { IPC_CHANNELS } from '../ipc-contract';
import { parseAbsolutePath, parseText, requireArgumentCount } from '../ipc-validation';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface ShellIntegrationIpcDeps {
  registration: TrustedChannelRegistration;
}

async function readClipboardContents(): Promise<{ text: string; html: string }> {
  // Electron 44 exposes the clipboard through asynchronous W3C-style methods; rich HTML is
  // read from a ClipboardItem because the former readHTML() convenience method was removed.
  const text = await clipboard.readText();
  let html = '';
  for (const item of await clipboard.read()) {
    if (!item.types.includes('text/html')) continue;
    const htmlPayload = await item.getType('text/html');
    if (!('text' in htmlPayload)) continue;
    html = await htmlPayload.text();
    break;
  }
  return { text, html };
}

export function registerShellIntegrationIpcHandlers(deps: ShellIntegrationIpcDeps): void {
  const { handleTrusted } = deps.registration;

  handleTrusted(IPC_CHANNELS.appOpenExternal, (_event, ...args) => {
    requireArgumentCount(args, 1);
    const externalUrl = allowedExternalUrl(args[0]);
    if (!externalUrl) throw new Error('Unsupported URL protocol');
    return shell.openExternal(externalUrl);
  });
  handleTrusted(IPC_CHANNELS.appShowItemInFolder, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return shell.showItemInFolder(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.appOpenDirectory, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return shell.openPath(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.appReadClipboard, async (_event, ...args) => {
    requireArgumentCount(args, 0);
    return readClipboardContents();
  });
  handleTrusted(IPC_CHANNELS.appWriteClipboard, async (_event, ...args) => {
    requireArgumentCount(args, 1);
    await clipboard.writeText(parseText(args[0]));
  });
}
