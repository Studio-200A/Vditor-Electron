import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import * as path from 'path';
import { watch, FSWatcher } from 'chokidar';
import { registerAppProtocol } from './protocol';
import { createAppMenu } from './menu';
import { FileManagerService } from './services/file-manager';
import { SettingsStore } from './services/settings-store';
import { AppSettings, DEFAULT_SETTINGS } from './services/app-state';

let mainWindow: BrowserWindow | null = null;
let fileManager: FileManagerService;
let settingsStore: SettingsStore;
let watcher: FSWatcher | null = null;
let closeConfirmed = false;

function getEffectiveLocale(settings = settingsStore.getAll()): 'en_US' | 'zh_CN' {
  if (settings.locale === 'zh_CN' || settings.locale === 'en_US') return settings.locale;
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh_CN' : 'en_US';
}

function tr(english: string, chinese: string): string {
  return getEffectiveLocale() === 'zh_CN' ? chinese : english;
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function createWindow(): void {
  const settings = settingsStore.getAll();
  const options: Electron.BrowserWindowConstructorOptions = {
    width: settings.windowBounds.width,
    height: settings.windowBounds.height,
    minWidth: 760,
    minHeight: 520,
    title: 'Vditor Desktop',
    backgroundColor: settings.theme === 'dark' ? '#181818' : '#ffffff',
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  if (settings.windowBounds.x !== undefined && settings.windowBounds.y !== undefined) {
    options.x = settings.windowBounds.x;
    options.y = settings.windowBounds.y;
  }
  mainWindow = new BrowserWindow(options);
  if (settings.windowMaximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('enter-full-screen', () => send('window:fullscreenChanged', true));
  mainWindow.on('leave-full-screen', () => send('window:fullscreenChanged', false));
  void mainWindow.loadURL('app://app/index.html');
  mainWindow.on('close', (event) => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    settingsStore.set('windowBounds', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
    settingsStore.set('windowMaximized', mainWindow.isMaximized());
    if (!closeConfirmed) {
      event.preventDefault();
      send('app:requestClose');
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function chooseSavePath(
  title: string,
  defaultPath: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const result = await dialog.showSaveDialog(mainWindow!, { title, defaultPath, filters });
  return result.canceled || !result.filePath ? null : result.filePath;
}

function registerIpcHandlers(): void {
  ipcMain.handle('file:openDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: tr('Open Markdown Files', '打开 Markdown 文件'),
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('file:openFolderDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: tr('Open Folder', '打开文件夹'),
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file:saveDialog', (_event, defaultPath?: string) =>
    chooseSavePath(tr('Save Markdown File', '保存 Markdown 文件'), defaultPath || 'untitled.md', [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ]),
  );
  ipcMain.handle('file:exportDialog', (_event, type: 'html' | 'pdf', defaultPath?: string) =>
    chooseSavePath(`Export ${type.toUpperCase()}`, defaultPath || `document.${type}`, [
      { name: type.toUpperCase(), extensions: [type] },
    ]),
  );
  ipcMain.handle('file:read', (_event, filePath: string) => fileManager.readFile(filePath));
  ipcMain.handle('file:write', (_event, filePath: string, content: string) =>
    fileManager.writeFile(filePath, content),
  );
  ipcMain.handle('file:writeBinary', (_event, filePath: string, bytes: Uint8Array) =>
    fileManager.writeBinaryFile(filePath, bytes),
  );
  ipcMain.handle('file:exists', (_event, filePath: string) => fileManager.exists(filePath));
  ipcMain.handle('file:listDir', (_event, dirPath: string) => fileManager.listDir(dirPath));
  ipcMain.handle(
    'file:create',
    (_event, parent: string, name: string, type: 'file' | 'directory') =>
      fileManager.createItem(parent, name, type),
  );
  ipcMain.handle('file:rename', (_event, oldPath: string, newName: string) =>
    fileManager.renameItem(oldPath, newName),
  );
  ipcMain.handle('file:move', (_event, source: string, destination: string) =>
    fileManager.moveItem(source, destination),
  );
  ipcMain.handle('file:delete', async (_event, filePath: string) =>
    shell.trashItem(path.resolve(filePath)),
  );
  ipcMain.handle('file:basename', (_event, filePath: string) => path.basename(filePath));
  ipcMain.handle('file:dirname', (_event, filePath: string) => path.dirname(filePath));
  ipcMain.handle('file:relative', (_event, from: string, to: string) =>
    path.relative(from, to).split(path.sep).join('/'),
  );
  ipcMain.handle('file:watch', async (_event, rootPath?: string) => {
    if (watcher) await watcher.close();
    watcher = null;
    if (!rootPath) return true;
    watcher = watch(rootPath, { ignoreInitial: true, depth: 20 });
    watcher.on('all', (eventName, changedPath) =>
      send('file:changed', { event: eventName, path: changedPath }),
    );
    return true;
  });

  ipcMain.handle('app:getSettings', () => settingsStore.getAll());
  ipcMain.handle('app:getDefaultSettings', () => structuredClone(DEFAULT_SETTINGS));
  ipcMain.handle('app:saveSettings', (_event, settings: Partial<AppSettings>) => {
    const savedSettings = settingsStore.update(settings);
    if (Object.hasOwn(settings, 'locale') && process.platform === 'darwin')
      Menu.setApplicationMenu(createAppMenu(getEffectiveLocale()));
    return savedSettings;
  });
  ipcMain.handle('app:resetSettings', () => {
    const settings = settingsStore.reset();
    if (process.platform === 'darwin')
      Menu.setApplicationMenu(createAppMenu(getEffectiveLocale(settings)));
    return settings;
  });
  ipcMain.handle('app:getSettingsPath', () => settingsStore.getPath());
  ipcMain.handle('app:getSettingsDisplayPath', () => {
    const settingsPath = settingsStore.getPath();
    const homePath = app.getPath('home');
    return settingsPath.startsWith(homePath)
      ? `~${settingsPath.slice(homePath.length)}`
      : settingsPath;
  });
  ipcMain.handle('app:getSystemLocale', () => app.getLocale());
  ipcMain.handle('app:getSystemTheme', () =>
    nativeTheme.shouldUseDarkColors ? 'dark' : 'classic',
  );
  ipcMain.handle('app:isFullscreen', () => mainWindow?.isFullScreen() || false);
  ipcMain.handle('app:getInfo', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    vditor: '3.11.3',
  }));
  ipcMain.handle('app:setZoomFactor', (_event, zoom: number) => {
    const factor = Math.min(2, Math.max(0.75, Number(zoom) / 100));
    mainWindow?.webContents.setZoomFactor(factor);
    return factor;
  });
  ipcMain.handle('app:openExternal', (_event, url: string) => {
    const parsed = new URL(url);
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol))
      throw new Error('Unsupported URL protocol');
    return shell.openExternal(url);
  });
  ipcMain.handle('app:showItemInFolder', (_event, filePath: string) =>
    shell.showItemInFolder(path.resolve(filePath)),
  );
  ipcMain.handle(
    'app:confirm',
    async (_event, options: { title?: string; message: string; detail?: string }) => {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        title: options.title || 'Vditor Desktop',
        message: options.message,
        detail: options.detail,
        buttons: [tr('Cancel', '取消'), tr('Continue', '继续')],
        defaultId: 1,
        cancelId: 0,
      });
      return result.response === 1;
    },
  );
  ipcMain.handle('app:exportPDF', async (_event, html: string, defaultPath?: string) => {
    const output = await chooseSavePath('Export PDF', defaultPath || 'document.pdf', [
      { name: 'PDF', extensions: ['pdf'] },
    ]);
    if (!output) return null;
    const exportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
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
  ipcMain.on('app:toggleFullscreen', () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()));
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.on('app:closeConfirmed', () => {
    closeConfirmed = true;
    mainWindow?.close();
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  settingsStore = new SettingsStore(process.env.VDITOR_DESKTOP_CONFIG_DIR);
  fileManager = new FileManagerService();
  registerIpcHandlers();
  Menu.setApplicationMenu(
    process.platform === 'darwin' ? createAppMenu(getEffectiveLocale()) : null,
  );
  nativeTheme.on('updated', () =>
    send('app:systemThemeChanged', nativeTheme.shouldUseDarkColors ? 'dark' : 'classic'),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void watcher?.close();
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (new URL(navigationUrl).protocol !== 'app:') {
      event.preventDefault();
      void shell.openExternal(navigationUrl);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});
