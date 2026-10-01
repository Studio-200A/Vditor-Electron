import { BrowserWindow } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '../ipc-contract';
import {
  parseOptionalAbsolutePath,
  parseOptionalText,
  parseText,
  requireArgumentCount,
} from '../ipc-validation';
import type { FileManagerService } from '../services/file-manager';
import type { SavePathChooser } from './file-dialogs';
import type { TrustedChannelRegistration } from './trusted-channel';

/**
 * WebContents of hidden PDF-export windows. Kept here so the application-wide
 * navigation guards in index.ts can deny navigation and popups for them via
 * isExportWebContents without exposing the mutable set.
 */
const exportWebContents = new WeakSet<Electron.WebContents>();

export function isExportWebContents(contents: Electron.WebContents): boolean {
  return exportWebContents.has(contents);
}

export interface ExportPdfIpcDeps {
  chooseSavePath: SavePathChooser;
  fileManager: FileManagerService;
  registration: TrustedChannelRegistration;
}

export function registerExportPdfIpcHandlers(deps: ExportPdfIpcDeps): void {
  const { handleTrusted } = deps.registration;
  const { chooseSavePath, fileManager } = deps;

  handleTrusted(IPC_CHANNELS.appExportPdf, async (_event, ...args) => {
    requireArgumentCount(args, 1, 3);
    const html = parseText(args[0]);
    const defaultPath = parseOptionalText(args[1]);
    const defaultDirectory = parseOptionalAbsolutePath(args[2]);
    const output = await chooseSavePath(
      'Export PDF',
      defaultDirectory
        ? path.join(defaultDirectory, path.basename(defaultPath || 'document.pdf'))
        : defaultPath || 'document.pdf',
      [{ name: 'PDF', extensions: ['pdf'] }],
    );
    if (!output) return null;
    const exportWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    exportWebContents.add(exportWindow.webContents);
    try {
      exportWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      exportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await exportWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
      });
      await fileManager.writeBinaryFile(output, pdf);
      return output;
    } finally {
      exportWindow.destroy();
    }
  });
}
