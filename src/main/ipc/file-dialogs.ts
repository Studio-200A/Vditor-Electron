import { dialog } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '../ipc-contract';
import {
  parseEnum,
  parseOptionalAbsolutePath,
  parseOptionalText,
  requireArgumentCount,
} from '../ipc-validation';
import { resolveSaveDialogDefaultPath } from '../save-dialog-path';
import type { TrustedChannelRegistration } from './trusted-channel';

export type MainProcessTranslator = (
  english: string,
  simplifiedChinese: string,
  traditionalChinese: string,
) => string;

export type SavePathChooser = (
  title: string,
  defaultPath: string,
  filters: Electron.FileFilter[],
) => Promise<string | null>;

/**
 * Shared save-dialog capability for file dialogs and PDF export. Created from
 * a lazy window getter so no module-level mutable window reference exists.
 */
export function createSavePathChooser(
  getMainWindow: () => Electron.BrowserWindow | null,
): SavePathChooser {
  return async (title, defaultPath, filters) => {
    const result = await dialog.showSaveDialog(getMainWindow()!, { title, defaultPath, filters });
    return result.canceled || !result.filePath ? null : result.filePath;
  };
}

export interface FileDialogsIpcDeps {
  getMainWindow(): Electron.BrowserWindow | null;
  tr: MainProcessTranslator;
  registration: TrustedChannelRegistration;
}

export function registerFileDialogsIpcHandlers(deps: FileDialogsIpcDeps): void {
  const { handleTrusted } = deps.registration;
  const { getMainWindow, tr } = deps;
  const chooseSavePath = createSavePathChooser(getMainWindow);

  handleTrusted(IPC_CHANNELS.fileOpenDialog, async (_event, ...args) => {
    requireArgumentCount(args, 0, 1);
    const defaultDirectory = parseOptionalAbsolutePath(args[0]);
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: tr('Open Markdown Files', '打开 Markdown 文件', '開啟 Markdown 檔案'),
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
      defaultPath: defaultDirectory,
    });
    return result.canceled ? [] : result.filePaths;
  });
  handleTrusted(IPC_CHANNELS.fileOpenFolderDialog, async (_event, ...args) => {
    requireArgumentCount(args, 0, 1);
    const defaultDirectory = parseOptionalAbsolutePath(args[0]);
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: tr('Open Folder', '打开文件夹', '開啟資料夾'),
      properties: ['openDirectory'],
      defaultPath: defaultDirectory,
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handleTrusted(IPC_CHANNELS.fileSaveDialog, (_event, ...args) => {
    requireArgumentCount(args, 0, 2);
    const defaultPath = parseOptionalText(args[0]);
    const defaultDirectory = parseOptionalAbsolutePath(args[1]);
    return chooseSavePath(
      tr('Save Markdown File', '保存 Markdown 文件', '儲存 Markdown 檔案'),
      resolveSaveDialogDefaultPath(defaultPath, defaultDirectory),
      [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    );
  });
  handleTrusted(IPC_CHANNELS.fileExportDialog, (_event, ...args) => {
    requireArgumentCount(args, 1, 3);
    const type = parseEnum(args[0], ['html', 'pdf']);
    const defaultPath = parseOptionalText(args[1]);
    const defaultDirectory = parseOptionalAbsolutePath(args[2]);
    return chooseSavePath(
      `Export ${type.toUpperCase()}`,
      defaultDirectory
        ? path.join(defaultDirectory, path.basename(defaultPath || `document.${type}`))
        : defaultPath || `document.${type}`,
      [{ name: type.toUpperCase(), extensions: [type] }],
    );
  });
}
