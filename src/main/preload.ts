import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS } from './ipc-contract';

const on = (channel: string, callback: (...args: any[]) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('fileAPI', {
  openFileDialog: (defaultDirectory?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileOpenDialog, defaultDirectory),
  openFolderDialog: (defaultDirectory?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileOpenFolderDialog, defaultDirectory),
  saveFileDialog: (defaultPath?: string, defaultDirectory?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileSaveDialog, defaultPath, defaultDirectory),
  exportDialog: (type: 'html' | 'pdf', defaultPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileExportDialog, type, defaultPath),
  readFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileRead, filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileWrite, filePath, content),
  writeDocument: (
    filePath: string,
    content: string,
    expectedContent?: string,
    expectedAbsent = false,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.fileWriteDocument,
      filePath,
      content,
      expectedContent,
      expectedAbsent,
    ),
  writeBinaryFile: (filePath: string, bytes: Uint8Array) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileWriteBinary, filePath, bytes),
  exists: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileExists, filePath),
  fileIdentity: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileIdentity, filePath),
  listDir: (dirPath: string, workspacePath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileListDir, dirPath, workspacePath),
  createItem: (parent: string, name: string, type: 'file' | 'directory') =>
    ipcRenderer.invoke(IPC_CHANNELS.fileCreate, parent, name, type),
  renameItem: (oldPath: string, newName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileRename, oldPath, newName),
  prepareRename: (oldPath: string, newName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.filePrepareRename, oldPath, newName),
  deleteItem: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileDelete, filePath),
  basename: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileBasename, filePath),
  dirname: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileDirname, filePath),
  relative: (from: string, to: string) => ipcRenderer.invoke(IPC_CHANNELS.fileRelative, from, to),
  rebasePath: (oldRoot: string, newRoot: string, candidatePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileRebasePath, oldRoot, newRoot, candidatePath),
  resolveMarkdownLink: (sourceFile: string, href: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileResolveMarkdownLink, sourceFile, href),
  setWorkspaceWatch: (rootPath?: string, depth?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileSetWorkspaceWatch, rootPath, depth),
  watchDocument: (filePath: string, reconcile = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileWatchDocument, filePath, reconcile),
  unwatchDocument: (filePath: string, identity?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileUnwatchDocument, filePath, identity),
  onChanged: (
    callback: (event: {
      event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'unreadable' | 'watch-error';
      path: string;
      identity?: string;
      scope: 'workspace' | 'document';
      content?: string;
      encoding?: string;
      error?: 'permission-denied' | 'read-failed' | 'resource-limit';
    }) => void,
  ) => on(IPC_CHANNELS.fileChanged, callback),
  getDroppedPath: (file: File) => webUtils.getPathForFile(file),
});

contextBridge.exposeInMainWorld('appAPI', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.appGetSettings),
  getRecoveryCandidates: () => ipcRenderer.invoke(IPC_CHANNELS.appGetRecoveryCandidates),
  restoreRecovery: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.appRestoreRecovery, id),
  saveRecovery: (snapshot: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNELS.appSaveRecovery, snapshot),
  discardRecovery: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.appDiscardRecovery, id),
  getDefaultSettings: () => ipcRenderer.invoke(IPC_CHANNELS.appGetDefaultSettings),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNELS.appSaveSettings, settings),
  resetSettings: () => ipcRenderer.invoke(IPC_CHANNELS.appResetSettings),
  getSettingsPath: () => ipcRenderer.invoke(IPC_CHANNELS.appGetSettingsPath),
  getSettingsDisplayPath: () => ipcRenderer.invoke(IPC_CHANNELS.appGetSettingsDisplayPath),
  getSystemLocale: () => ipcRenderer.invoke(IPC_CHANNELS.appGetSystemLocale),
  getSystemTheme: () => ipcRenderer.invoke(IPC_CHANNELS.appGetSystemTheme),
  isFullscreen: () => ipcRenderer.invoke(IPC_CHANNELS.appIsFullscreen),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.appIsMaximized),
  getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
  setZoomFactor: (zoom: number) => ipcRenderer.invoke(IPC_CHANNELS.appSetZoomFactor, zoom),
  readClipboard: () => ipcRenderer.invoke(IPC_CHANNELS.appReadClipboard),
  writeClipboard: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.appWriteClipboard, text),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url),
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.appShowItemInFolder, filePath),
  openDirectory: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.appOpenDirectory, dirPath),
  exportPDF: (html: string, defaultPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.appExportPdf, html, defaultPath),
  toggleFullscreen: () => ipcRenderer.send(IPC_CHANNELS.appToggleFullscreen),
  onMenuAction: (callback: (action: string, value?: string) => void) =>
    on(IPC_CHANNELS.menuAction, callback),
  onSystemThemeChanged: (callback: (theme: string) => void) =>
    on(IPC_CHANNELS.appSystemThemeChanged, callback),
  onRequestClose: (callback: () => void) => on(IPC_CHANNELS.appRequestClose, callback),
  onFullscreenChanged: (callback: (fullscreen: boolean) => void) =>
    on(IPC_CHANNELS.windowFullscreenChanged, callback),
  onMaximizedChanged: (callback: (maximized: boolean) => void) =>
    on(IPC_CHANNELS.windowMaximizedChanged, callback),
  onOpenFiles: (callback: (paths: string[]) => void) => on(IPC_CHANNELS.appOpenFiles, callback),
  rendererReady: () => ipcRenderer.send(IPC_CHANNELS.appRendererReady),
  closeConfirmed: () => ipcRenderer.send(IPC_CHANNELS.appCloseConfirmed),
  minimize: () => ipcRenderer.send(IPC_CHANNELS.windowMinimize),
  maximize: () => ipcRenderer.send(IPC_CHANNELS.windowMaximize),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.windowClose),
  toggleDevTools: () => ipcRenderer.send(IPC_CHANNELS.appToggleDevTools),
});
