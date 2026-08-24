import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
} from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { resolveApplicationPaths } from './app-paths';
import { registerAppProtocol } from './protocol';
import { createAppMenu } from './menu';
import { extractOpenFilePaths } from './open-files';
import { allowedExternalUrl } from './external-url';
import { resolveRelativeMarkdownLink } from './resolve-markdown-link';
import { FileManagerService } from './services/file-manager';
import { FileWatchService } from './services/file-watch-service';
import { RecoveryStore } from './services/recovery-store';
import { SettingsStore } from './services/settings-store';
import { AppSettings, DEFAULT_SETTINGS } from './services/app-state';

let mainWindow: BrowserWindow | null = null;
let fileManager: FileManagerService;
let settingsStore: SettingsStore;
let recoveryStore: RecoveryStore;
let fileWatchService: FileWatchService;
let closeConfirmed = false;
let boundsBeforeMaximize: Electron.Rectangle | null = null;
let windowMaximizedState = false;
let windowBoundsSaveTimer: NodeJS.Timeout | null = null;
let rendererReady = false;
let pendingOpenFiles: string[] = [];

const applicationPaths = resolveApplicationPaths();
fs.mkdirSync(applicationPaths.chromiumDir, { recursive: true });
app.setPath('userData', applicationPaths.chromiumDir);
app.setPath('sessionData', applicationPaths.chromiumDir);

function isWindowMaximized(): boolean {
  return windowMaximizedState;
}

function persistWindowMaximized(maximized: boolean): void {
  windowMaximizedState = maximized;
  settingsStore.set('windowMaximized', maximized);
}

function persistNormalWindowBounds(): void {
  if (!mainWindow || windowMaximizedState || mainWindow.isMaximized() || mainWindow.isFullScreen())
    return;
  const bounds = mainWindow.getBounds();
  if (isMaximizedLikeBounds(bounds)) return;
  boundsBeforeMaximize = { ...bounds };
  settingsStore.set('windowBounds', {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

function scheduleNormalWindowBoundsSave(): void {
  if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
  windowBoundsSaveTimer = setTimeout(() => {
    windowBoundsSaveTimer = null;
    persistNormalWindowBounds();
  }, 400);
}

function isMaximizedLikeBounds(bounds: Electron.Rectangle): boolean {
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const aligned = Math.abs(bounds.x - workArea.x) <= 32 && Math.abs(bounds.y - workArea.y) <= 32;
  return aligned && bounds.width >= workArea.width * 0.9 && bounds.height >= workArea.height * 0.9;
}

function initialWindowBounds(settings: AppSettings): Electron.Rectangle {
  const saved = settings.windowBounds;
  const display =
    saved.x !== undefined && saved.y !== undefined
      ? screen.getDisplayMatching({
          x: saved.x,
          y: saved.y,
          width: saved.width,
          height: saved.height,
        })
      : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const candidate = {
    x: saved.x ?? workArea.x + Math.round((workArea.width - saved.width) / 2),
    y: saved.y ?? workArea.y + Math.round((workArea.height - saved.height) / 2),
    width: saved.width,
    height: saved.height,
  };
  if (!isMaximizedLikeBounds(candidate)) return candidate;
  const width = Math.min(DEFAULT_SETTINGS.windowBounds.width, Math.max(760, workArea.width - 80));
  const height = Math.min(
    DEFAULT_SETTINGS.windowBounds.height,
    Math.max(520, workArea.height - 80),
  );
  const repaired = {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
  settingsStore.set('windowBounds', repaired);
  return repaired;
}

function toggleWindowMaximized(): void {
  if (!mainWindow) return;
  if (windowMaximizedState || mainWindow.isMaximized()) {
    const target = boundsBeforeMaximize
      ? { ...boundsBeforeMaximize }
      : mainWindow.getNormalBounds();
    persistWindowMaximized(false);
    mainWindow.once('unmaximize', () => {
      const restoreBounds = () => {
        if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
          const current = mainWindow.getBounds();
          if (
            current.x !== target.x ||
            current.y !== target.y ||
            current.width !== target.width ||
            current.height !== target.height
          ) {
            mainWindow.setBounds(target);
            mainWindow.setPosition(target.x, target.y);
          }
        }
      };
      // Some Linux window managers apply their own (0, 0) position after the
      // unmaximize event. Re-check while and after the native transition settles.
      [100, 350, 800, 1400].forEach((delay) => setTimeout(restoreBounds, delay));
    });
    mainWindow.unmaximize();
  } else {
    boundsBeforeMaximize = mainWindow.getBounds();
    settingsStore.set('windowBounds', { ...boundsBeforeMaximize });
    persistWindowMaximized(true);
    mainWindow.maximize();
  }
}

type AppLocale = 'en_US' | 'zh_Hans' | 'zh_Hant';

function resolveSystemLocale(language: string): AppLocale {
  const normalized = language.replace('_', '-').toLowerCase();
  if (!normalized.startsWith('zh')) return 'en_US';
  return /(?:^|-)hant(?:-|$)|(?:^|-)(?:tw|hk|mo)(?:-|$)/.test(normalized) ? 'zh_Hant' : 'zh_Hans';
}

function getEffectiveLocale(settings = settingsStore.getAll()): AppLocale {
  if (['en_US', 'zh_Hans', 'zh_Hant'].includes(settings.locale)) {
    return settings.locale as AppLocale;
  }
  return resolveSystemLocale(app.getLocale());
}

function tr(english: string, simplifiedChinese: string, traditionalChinese: string): string {
  const locale = getEffectiveLocale();
  if (locale === 'zh_Hans') return simplifiedChinese;
  if (locale === 'zh_Hant') return traditionalChinese;
  return english;
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function flushPendingOpenFiles(): void {
  if (!rendererReady || !pendingOpenFiles.length || !mainWindow || mainWindow.isDestroyed()) return;
  const paths = pendingOpenFiles;
  pendingOpenFiles = [];
  send('app:openFiles', paths);
}

function queueOpenFiles(paths: readonly string[]): void {
  pendingOpenFiles = [...new Set([...pendingOpenFiles, ...paths])];
  flushPendingOpenFiles();
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function initialWindowBackground(settings: AppSettings): string {
  const theme = settings.systemTheme
    ? nativeTheme.shouldUseDarkColors
      ? settings.lastDarkTheme
      : 'classic'
    : settings.theme;
  if (theme === 'monokai-pro-dark') return '#2d2a2e';
  return theme === 'dark' ? '#17181a' : '#f7f7f8';
}

function isDevToolsShortcut(input: Electron.Input): boolean {
  if (input.key.toLowerCase() !== 'i') return false;
  return (input.control || input.meta) && input.shift;
}

function updateApplicationMenu(settings = settingsStore.getAll()): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(createAppMenu(getEffectiveLocale(settings), settings.editMode));
}

function createWindow(): void {
  const settings = settingsStore.getAll();
  const normalBounds = initialWindowBounds(settings);
  const options: Electron.BrowserWindowConstructorOptions = {
    width: normalBounds.width,
    height: normalBounds.height,
    minWidth: 760,
    minHeight: 520,
    title: 'Vditor Desktop',
    backgroundColor: process.platform === 'linux' ? initialWindowBackground(settings) : '#00000000',
    transparent: process.platform === 'win32',
    hasShadow: true,
    roundedCorners: true,
    resizable: true,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 9 } : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  options.x = normalBounds.x;
  options.y = normalBounds.y;
  mainWindow = new BrowserWindow(options);
  rendererReady = false;
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (!settingsStore.get('devToolsEnabled') && isDevToolsShortcut(input)))
      event.preventDefault();
  });
  windowMaximizedState = settings.windowMaximized;
  boundsBeforeMaximize = { ...normalBounds };
  if (settings.windowMaximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('enter-full-screen', () => send('window:fullscreenChanged', true));
  mainWindow.on('leave-full-screen', () => send('window:fullscreenChanged', false));
  mainWindow.on('maximize', () => {
    persistWindowMaximized(true);
    send('window:maximizedChanged', true);
  });
  mainWindow.on('unmaximize', () => {
    persistWindowMaximized(false);
    send('window:maximizedChanged', false);
    scheduleNormalWindowBoundsSave();
  });
  mainWindow.on('move', scheduleNormalWindowBoundsSave);
  mainWindow.on('resize', scheduleNormalWindowBoundsSave);
  void mainWindow.loadURL('app://app/index.html');
  mainWindow.on('close', (event) => {
    if (!mainWindow) return;
    if (!windowMaximizedState) persistNormalWindowBounds();
    settingsStore.set('windowMaximized', windowMaximizedState);
    if (!closeConfirmed) {
      event.preventDefault();
      send('app:requestClose');
    }
  });
  mainWindow.on('closed', () => {
    if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = null;
    mainWindow = null;
    rendererReady = false;
    boundsBeforeMaximize = null;
    windowMaximizedState = false;
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
      title: tr('Open Markdown Files', '打开 Markdown 文件', '開啟 Markdown 檔案'),
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
      title: tr('Open Folder', '打开文件夹', '開啟資料夾'),
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file:saveDialog', (_event, defaultPath?: string, defaultDirectory?: string) =>
    chooseSavePath(
      tr('Save Markdown File', '保存 Markdown 文件', '儲存 Markdown 檔案'),
      defaultDirectory
        ? path.join(defaultDirectory, defaultPath || 'untitled.md')
        : defaultPath || 'untitled.md',
      [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    ),
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
  ipcMain.handle('file:writeDocument', (_event, filePath: string, content: string) => {
    fileWatchService.markOwnDocumentWrite(filePath);
    return fileManager.writeDocument(filePath, content);
  });
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
  ipcMain.handle('file:delete', async (_event, filePath: string) =>
    shell.trashItem(path.resolve(filePath)),
  );
  ipcMain.handle('file:basename', (_event, filePath: string) => path.basename(filePath));
  ipcMain.handle('file:dirname', (_event, filePath: string) => path.dirname(filePath));
  ipcMain.handle('file:relative', (_event, from: string, to: string) =>
    path.relative(from, to).split(path.sep).join('/'),
  );
  ipcMain.handle('file:resolveMarkdownLink', (_event, sourceFile: unknown, href: unknown) =>
    resolveRelativeMarkdownLink(sourceFile, href),
  );
  ipcMain.handle('file:setWorkspaceWatch', (_event, rootPath?: string) =>
    fileWatchService.setWorkspace(rootPath),
  );
  ipcMain.handle('file:watchDocument', (_event, filePath: string) =>
    fileWatchService.watchDocument(filePath),
  );
  ipcMain.handle('file:unwatchDocument', (_event, filePath: string) =>
    fileWatchService.unwatchDocument(filePath),
  );

  ipcMain.handle('app:getSettings', () => settingsStore.getAll());
  ipcMain.handle('app:getRecoveryCandidates', () => recoveryStore.listCandidates());
  ipcMain.handle('app:restoreRecovery', (_event, id: string) => recoveryStore.restore(id));
  ipcMain.handle('app:saveRecovery', (_event, snapshot) => recoveryStore.save(snapshot));
  ipcMain.handle('app:discardRecovery', (_event, id: string) => recoveryStore.discard(id));
  ipcMain.on('app:rendererReady', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    rendererReady = true;
    flushPendingOpenFiles();
  });
  ipcMain.handle('app:getDefaultSettings', () => structuredClone(DEFAULT_SETTINGS));
  ipcMain.handle('app:saveSettings', (_event, settings: Partial<AppSettings>) => {
    const savedSettings = settingsStore.update(settings);
    if (
      Object.hasOwn(settings, 'locale') ||
      Object.hasOwn(settings, 'editMode') ||
      Object.hasOwn(settings, 'devToolsEnabled')
    )
      updateApplicationMenu(savedSettings);
    return savedSettings;
  });
  ipcMain.handle('app:resetSettings', () => {
    const settings = settingsStore.reset();
    updateApplicationMenu(settings);
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
  ipcMain.handle('app:isMaximized', () => isWindowMaximized());
  ipcMain.handle('app:getInfo', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    vditor: '3.11.3',
  }));
  ipcMain.handle('app:setZoomFactor', (_event, zoom: number) => {
    const factor = Math.min(2, Math.max(0.75, Number(zoom) / 100));
    mainWindow?.webContents.setZoomFactor(factor);
    return factor;
  });
  ipcMain.handle('app:readClipboard', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents)
      throw new Error('Clipboard access is limited to the application window');
    return { text: clipboard.readText(), html: clipboard.readHTML() };
  });
  ipcMain.handle('app:openExternal', (_event, url: unknown) => {
    const externalUrl = allowedExternalUrl(url);
    if (!externalUrl) throw new Error('Unsupported URL protocol');
    return shell.openExternal(externalUrl);
  });
  ipcMain.handle('app:showItemInFolder', (_event, filePath: string) =>
    shell.showItemInFolder(path.resolve(filePath)),
  );
  ipcMain.handle('app:openDirectory', (_event, dirPath: string) =>
    shell.openPath(path.resolve(dirPath)),
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
    toggleWindowMaximized();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.on('app:toggleDevTools', (event) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      !settingsStore.get('devToolsEnabled')
    )
      return;
    mainWindow.webContents.toggleDevTools();
  });
  ipcMain.on('app:closeConfirmed', () => {
    closeConfirmed = true;
    mainWindow?.close();
  });
}

const ownsSingleInstanceLock = app.requestSingleInstanceLock();

if (!ownsSingleInstanceLock) {
  app.quit();
} else {
  queueOpenFiles(extractOpenFilePaths(process.argv));
  app.on('second-instance', (_event, argv, workingDirectory) => {
    queueOpenFiles(extractOpenFilePaths(argv, workingDirectory));
    revealMainWindow();
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    queueOpenFiles(extractOpenFilePaths([filePath]));
    revealMainWindow();
  });

  void app.whenReady().then(() => {
    registerAppProtocol();
    settingsStore = new SettingsStore(applicationPaths.configDir);
    recoveryStore = new RecoveryStore(applicationPaths.recoveryDir);
    fileManager = new FileManagerService();
    fileWatchService = new FileWatchService(
      (filePath) => fileManager.readFile(filePath),
      (event) => send('file:changed', event),
    );
    registerIpcHandlers();
    updateApplicationMenu();
    nativeTheme.on('updated', () =>
      send('app:systemThemeChanged', nativeTheme.shouldUseDarkColors ? 'dark' : 'classic'),
    );
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void fileWatchService?.dispose();
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (new URL(navigationUrl).protocol === 'app:') return;
    event.preventDefault();
    const externalUrl = allowedExternalUrl(navigationUrl);
    if (externalUrl) void shell.openExternal(externalUrl);
  });
  contents.setWindowOpenHandler(({ url }) => {
    const externalUrl = allowedExternalUrl(url);
    if (externalUrl) void shell.openExternal(externalUrl);
    return { action: 'deny' };
  });
});
