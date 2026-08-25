import { contextBridge, ipcRenderer, webUtils } from 'electron';

const on = (channel: string, callback: (...args: any[]) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('fileAPI', {
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  openFolderDialog: () => ipcRenderer.invoke('file:openFolderDialog'),
  saveFileDialog: (defaultPath?: string, defaultDirectory?: string) =>
    ipcRenderer.invoke('file:saveDialog', defaultPath, defaultDirectory),
  exportDialog: (type: 'html' | 'pdf', defaultPath?: string) =>
    ipcRenderer.invoke('file:exportDialog', type, defaultPath),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('file:write', filePath, content),
  writeDocument: (filePath: string, content: string) =>
    ipcRenderer.invoke('file:writeDocument', filePath, content),
  writeBinaryFile: (filePath: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('file:writeBinary', filePath, bytes),
  exists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  listDir: (dirPath: string) => ipcRenderer.invoke('file:listDir', dirPath),
  createItem: (parent: string, name: string, type: 'file' | 'directory') =>
    ipcRenderer.invoke('file:create', parent, name, type),
  renameItem: (oldPath: string, newName: string) =>
    ipcRenderer.invoke('file:rename', oldPath, newName),
  deleteItem: (filePath: string) => ipcRenderer.invoke('file:delete', filePath),
  basename: (filePath: string) => ipcRenderer.invoke('file:basename', filePath),
  dirname: (filePath: string) => ipcRenderer.invoke('file:dirname', filePath),
  relative: (from: string, to: string) => ipcRenderer.invoke('file:relative', from, to),
  resolveMarkdownLink: (sourceFile: string, href: string) =>
    ipcRenderer.invoke('file:resolveMarkdownLink', sourceFile, href),
  setWorkspaceWatch: (rootPath?: string) => ipcRenderer.invoke('file:setWorkspaceWatch', rootPath),
  watchDocument: (filePath: string) => ipcRenderer.invoke('file:watchDocument', filePath),
  unwatchDocument: (filePath: string) => ipcRenderer.invoke('file:unwatchDocument', filePath),
  onChanged: (
    callback: (event: {
      event: 'add' | 'change' | 'unlink' | 'unreadable';
      path: string;
      scope: 'workspace' | 'document';
      content?: string;
      encoding?: string;
      error?: 'permission-denied' | 'read-failed';
    }) => void,
  ) => on('file:changed', callback),
  getDroppedPath: (file: File) => webUtils.getPathForFile(file),
});

contextBridge.exposeInMainWorld('appAPI', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  getRecoveryCandidates: () => ipcRenderer.invoke('app:getRecoveryCandidates'),
  restoreRecovery: (id: string) => ipcRenderer.invoke('app:restoreRecovery', id),
  saveRecovery: (snapshot: Record<string, unknown>) =>
    ipcRenderer.invoke('app:saveRecovery', snapshot),
  discardRecovery: (id: string) => ipcRenderer.invoke('app:discardRecovery', id),
  getDefaultSettings: () => ipcRenderer.invoke('app:getDefaultSettings'),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('app:saveSettings', settings),
  resetSettings: () => ipcRenderer.invoke('app:resetSettings'),
  getSettingsPath: () => ipcRenderer.invoke('app:getSettingsPath'),
  getSettingsDisplayPath: () => ipcRenderer.invoke('app:getSettingsDisplayPath'),
  getSystemLocale: () => ipcRenderer.invoke('app:getSystemLocale'),
  getSystemTheme: () => ipcRenderer.invoke('app:getSystemTheme'),
  isFullscreen: () => ipcRenderer.invoke('app:isFullscreen'),
  isMaximized: () => ipcRenderer.invoke('app:isMaximized'),
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  setZoomFactor: (zoom: number) => ipcRenderer.invoke('app:setZoomFactor', zoom),
  readClipboard: () => ipcRenderer.invoke('app:readClipboard'),
  writeClipboard: (text: string) => ipcRenderer.invoke('app:writeClipboard', text),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('app:showItemInFolder', filePath),
  openDirectory: (dirPath: string) => ipcRenderer.invoke('app:openDirectory', dirPath),
  exportPDF: (html: string, defaultPath?: string) =>
    ipcRenderer.invoke('app:exportPDF', html, defaultPath),
  toggleFullscreen: () => ipcRenderer.send('app:toggleFullscreen'),
  onMenuAction: (callback: (action: string, value?: string) => void) => on('menu:action', callback),
  onSystemThemeChanged: (callback: (theme: string) => void) =>
    on('app:systemThemeChanged', callback),
  onRequestClose: (callback: () => void) => on('app:requestClose', callback),
  onFullscreenChanged: (callback: (fullscreen: boolean) => void) =>
    on('window:fullscreenChanged', callback),
  onMaximizedChanged: (callback: (maximized: boolean) => void) =>
    on('window:maximizedChanged', callback),
  onOpenFiles: (callback: (paths: string[]) => void) => on('app:openFiles', callback),
  rendererReady: () => ipcRenderer.send('app:rendererReady'),
  closeConfirmed: () => ipcRenderer.send('app:closeConfirmed'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  toggleDevTools: () => ipcRenderer.send('app:toggleDevTools'),
});
