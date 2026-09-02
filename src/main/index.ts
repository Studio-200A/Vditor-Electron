import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
} from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { resolveApplicationPaths } from './app-paths';
import { registerAppProtocol } from './protocol';
import { shouldBlockRemoteSvgImage } from './remote-svg-policy';
import { createAppMenu } from './menu';
import { extractOpenFilePaths } from './open-files';
import { allowedExternalUrl } from './external-url';
import { invalidIpcArgument, normalizeIpcError, requireTrustedMainFrame } from './ipc-guard';
import { IPC_CHANNELS } from './ipc-contract';
import { LocalResourcePolicy } from './local-resource';
import {
  parseAbsolutePath,
  parseBinary,
  parseEnum,
  parseFileName,
  parseFiniteNumber,
  parseOptionalAbsolutePath,
  parseOptionalBoolean,
  parseOptionalInteger,
  parseOptionalText,
  parseResourceRootPaths,
  parseSettingsPatch,
  parseText,
  requireArgumentCount,
} from './ipc-validation';
import { classifyNavigation } from './navigation-policy';
import { resolveRelativeMarkdownLink } from './resolve-markdown-link';
import { FileManagerService } from './services/file-manager';
import { FileWatchService } from './services/file-watch-service';
import { RecoveryStore } from './services/recovery-store';
import { SettingsStore } from './services/settings-store';
import { WindowCloseConfirmation } from './services/window-close-confirmation';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  WORKSPACE_READ_DEPTH_MAX,
  WORKSPACE_READ_DEPTH_MIN,
} from './services/app-state';

let mainWindow: BrowserWindow | null = null;
let fileManager: FileManagerService;
let settingsStore: SettingsStore;
let recoveryStore: RecoveryStore;
let fileWatchService: FileWatchService;
const windowCloseConfirmation = new WindowCloseConfirmation<BrowserWindow>();
let boundsBeforeMaximize: Electron.Rectangle | null = null;
let windowMaximizedState = false;
let windowBoundsSaveTimer: NodeJS.Timeout | null = null;
let rendererReady = false;
let pendingOpenFiles: string[] = [];
const exportWebContents = new WeakSet<Electron.WebContents>();

const applicationPaths = resolveApplicationPaths();
fs.mkdirSync(applicationPaths.chromiumDir, { recursive: true });
app.setPath('userData', applicationPaths.chromiumDir);
app.setPath('sessionData', applicationPaths.chromiumDir);
const localResourcePolicy = new LocalResourcePolicy({
  onRejected: (reason) => console.debug(`[local-file] denied: ${reason}`),
  privateRoots: [
    applicationPaths.configDir,
    applicationPaths.chromiumDir,
    applicationPaths.recoveryDir,
  ],
});

function isWindowMaximized(): boolean {
  return windowMaximizedState;
}

function registerRemoteSvgImagePolicy(): void {
  const shouldBlock = (
    details: Pick<
      Electron.OnHeadersReceivedListenerDetails,
      'url' | 'resourceType' | 'responseHeaders' | 'webContentsId'
    >,
  ) =>
    details.webContentsId === mainWindow?.webContents.id &&
    shouldBlockRemoteSvgImage(
      details.url,
      details.resourceType,
      settingsStore.get('allowSvgImages'),
      details.responseHeaders,
    );

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: shouldBlock(details) });
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ cancel: shouldBlock(details) });
  });
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
  send(IPC_CHANNELS.appOpenFiles, paths);
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
      ? settings.darkTheme
      : settings.lightTheme
    : settings.theme;
  if (theme === 'monokai-pro-dark') return '#2d2a2e';
  if (theme === 'monokai-pro-light') return '#faf4f2';
  if (theme === 'claude-dark') return '#141413';
  if (theme === 'claude-light') return '#faf9f5';
  return theme === 'dark' ? '#17181a' : '#f7f7f8';
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
      // The current preload is compiled as CommonJS and imports the shared IPC contract.
      // Electron sandboxed preloads cannot load that local module; keep the narrow bridge working
      // until a separately scoped bundled-preload migration can prove equivalent behavior.
      sandbox: false,
    },
  };
  options.x = normalBounds.x;
  options.y = normalBounds.y;
  mainWindow = new BrowserWindow(options);
  const createdWindow = mainWindow;
  rendererReady = false;
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key !== 'F12') return;
    event.preventDefault();
    if (settingsStore.get('devToolsEnabled')) createdWindow.webContents.toggleDevTools();
  });
  windowMaximizedState = settings.windowMaximized;
  boundsBeforeMaximize = { ...normalBounds };
  if (settings.windowMaximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('enter-full-screen', () => send(IPC_CHANNELS.windowFullscreenChanged, true));
  mainWindow.on('leave-full-screen', () => send(IPC_CHANNELS.windowFullscreenChanged, false));
  mainWindow.on('maximize', () => {
    persistWindowMaximized(true);
    send(IPC_CHANNELS.windowMaximizedChanged, true);
  });
  mainWindow.on('unmaximize', () => {
    persistWindowMaximized(false);
    send(IPC_CHANNELS.windowMaximizedChanged, false);
    scheduleNormalWindowBoundsSave();
  });
  mainWindow.on('move', scheduleNormalWindowBoundsSave);
  mainWindow.on('resize', scheduleNormalWindowBoundsSave);
  void mainWindow.loadURL('app://app/index.html');
  mainWindow.on('close', (event) => {
    if (!mainWindow) return;
    if (!windowMaximizedState) persistNormalWindowBounds();
    settingsStore.set('windowMaximized', windowMaximizedState);
    if (!windowCloseConfirmation.isConfirmed(mainWindow)) {
      event.preventDefault();
      send(IPC_CHANNELS.appRequestClose);
    }
  });
  mainWindow.on('closed', () => {
    windowCloseConfirmation.clear(createdWindow);
    if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = null;
    mainWindow = null;
    rendererReady = false;
    boundsBeforeMaximize = null;
    windowMaximizedState = false;
    localResourcePolicy.clear();
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

type TrustedInvokeHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type TrustedMessageHandler = (event: Electron.IpcMainEvent, ...args: unknown[]) => void;

function handleTrusted(channel: string, handler: TrustedInvokeHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    requireTrustedMainFrame(event, mainWindow?.webContents);
    try {
      return await handler(event, ...args);
    } catch (error) {
      throw reportIpcFailure(channel, error);
    }
  });
}

function onTrusted(channel: string, handler: TrustedMessageHandler): void {
  ipcMain.on(channel, (event, ...args) => {
    try {
      requireTrustedMainFrame(event, mainWindow?.webContents);
      handler(event, ...args);
    } catch (error) {
      reportIpcFailure(channel, error);
    }
  });
}

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

function registerIpcHandlers(): void {
  handleTrusted(IPC_CHANNELS.fileOpenDialog, async (_event, ...args) => {
    requireArgumentCount(args, 0, 1);
    const defaultDirectory = parseOptionalAbsolutePath(args[0]);
    const result = await dialog.showOpenDialog(mainWindow!, {
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
    const result = await dialog.showOpenDialog(mainWindow!, {
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
      defaultDirectory
        ? path.join(defaultDirectory, defaultPath || 'untitled.md')
        : defaultPath || 'untitled.md',
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
  handleTrusted(IPC_CHANNELS.fileRead, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return fileManager.readFile(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileWrite, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return fileManager.writeFile(parseAbsolutePath(args[0]), parseText(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileWriteDocument, async (_event, ...args) => {
    requireArgumentCount(args, 2, 4);
    const filePath = parseAbsolutePath(args[0]);
    const content = parseText(args[1]);
    const expectedContent = parseOptionalText(args[2]);
    const expectedAbsent = parseOptionalBoolean(args[3], false);
    if (expectedContent !== undefined && expectedAbsent) invalidIpcArgument();
    const result = await fileManager.writeDocument(
      filePath,
      content,
      expectedContent,
      expectedAbsent,
    );
    if (!('error' in result)) fileWatchService.markOwnDocumentWrite(filePath);
    return result;
  });
  handleTrusted(IPC_CHANNELS.fileWriteBinary, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return fileManager.writeBinaryFile(parseAbsolutePath(args[0]), parseBinary(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileExists, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return fileManager.exists(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileIdentity, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return fileManager.fileIdentity(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileListDir, (_event, ...args) => {
    requireArgumentCount(args, 1, 2);
    return fileManager.listDir(parseAbsolutePath(args[0]), parseOptionalAbsolutePath(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileCreate, (_event, ...args) => {
    requireArgumentCount(args, 3);
    return fileManager.createItem(
      parseAbsolutePath(args[0]),
      parseFileName(args[1]),
      parseEnum(args[2], ['file', 'directory']),
    );
  });
  handleTrusted(IPC_CHANNELS.fileRename, async (_event, ...args) => {
    requireArgumentCount(args, 2);
    const oldPath = parseAbsolutePath(args[0]);
    const newName = parseFileName(args[1]);
    const destination = await fileManager.prepareRename(oldPath, newName);
    fileWatchService.markOwnWorkspaceRename(oldPath, destination);
    try {
      return await fileManager.renameItem(oldPath, newName);
    } catch (error) {
      fileWatchService.clearOwnWorkspaceRename(oldPath, destination);
      throw error;
    }
  });
  handleTrusted(IPC_CHANNELS.filePrepareRename, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return fileManager.prepareRename(parseAbsolutePath(args[0]), parseFileName(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileDelete, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return shell.trashItem(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileBasename, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return path.basename(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileDirname, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return path.dirname(parseAbsolutePath(args[0]));
  });
  handleTrusted(IPC_CHANNELS.fileRelative, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return path
      .relative(parseAbsolutePath(args[0]), parseAbsolutePath(args[1]))
      .split(path.sep)
      .join('/');
  });
  handleTrusted(IPC_CHANNELS.fileRebasePath, (_event, ...args) => {
    requireArgumentCount(args, 3);
    return fileManager.rebasePath(
      parseAbsolutePath(args[0]),
      parseAbsolutePath(args[1]),
      parseAbsolutePath(args[2]),
    );
  });
  handleTrusted(IPC_CHANNELS.fileResolveMarkdownLink, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resolveRelativeMarkdownLink(parseAbsolutePath(args[0]), parseText(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileSetWorkspaceWatch, (_event, ...args) => {
    requireArgumentCount(args, 0, 2);
    return fileWatchService.setWorkspace(
      parseOptionalAbsolutePath(args[0]),
      parseOptionalInteger(args[1], WORKSPACE_READ_DEPTH_MIN, WORKSPACE_READ_DEPTH_MAX),
    );
  });
  handleTrusted(IPC_CHANNELS.fileWatchDocument, (_event, ...args) => {
    requireArgumentCount(args, 1, 2);
    return fileWatchService.watchDocument(
      parseAbsolutePath(args[0]),
      parseOptionalBoolean(args[1], false),
    );
  });
  handleTrusted(IPC_CHANNELS.fileUnwatchDocument, (_event, ...args) => {
    requireArgumentCount(args, 1, 2);
    return fileWatchService.unwatchDocument(parseAbsolutePath(args[0]), parseOptionalText(args[1]));
  });
  handleTrusted(IPC_CHANNELS.fileSetResourceRoots, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return localResourcePolicy.setRoots(parseResourceRootPaths(args[0]));
  });

  handleTrusted(IPC_CHANNELS.appGetSettings, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return settingsStore.getAll();
  });
  handleTrusted(IPC_CHANNELS.appGetRecoveryCandidates, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return recoveryStore.listCandidates();
  });
  handleTrusted(IPC_CHANNELS.appRestoreRecovery, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return recoveryStore.restore(parseText(args[0], 128));
  });
  handleTrusted(IPC_CHANNELS.appSaveRecovery, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return recoveryStore.save(args[0]);
  });
  handleTrusted(IPC_CHANNELS.appDiscardRecovery, (_event, ...args) => {
    requireArgumentCount(args, 1);
    return recoveryStore.discard(parseText(args[0], 128));
  });
  onTrusted(IPC_CHANNELS.appRendererReady, (_event, ...args) => {
    requireArgumentCount(args, 0);
    rendererReady = true;
    flushPendingOpenFiles();
  });
  handleTrusted(IPC_CHANNELS.appGetDefaultSettings, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return structuredClone(DEFAULT_SETTINGS);
  });
  handleTrusted(IPC_CHANNELS.appSaveSettings, async (_event, ...args) => {
    requireArgumentCount(args, 1);
    const settings = parseSettingsPatch(args[0]);
    const savedSettings = settingsStore.updateOrThrow(settings);
    if (Object.hasOwn(settings, 'allowSvgImages') && !savedSettings.allowSvgImages) {
      // A previously decoded remote SVG may otherwise be reused without a new webRequest
      // callback after the user revokes rendering permission. This setting changes rarely,
      // so clearing the shared HTTP cache is preferable to leaving a stale permission window.
      try {
        await session.defaultSession.clearCache();
      } catch (error) {
        console.warn('[svg] Unable to clear the image cache after rendering was disabled.', error);
      }
    }
    if (
      Object.hasOwn(settings, 'locale') ||
      Object.hasOwn(settings, 'editMode') ||
      Object.hasOwn(settings, 'devToolsEnabled')
    )
      updateApplicationMenu(savedSettings);
    return savedSettings;
  });
  handleTrusted(IPC_CHANNELS.appResetSettings, (_event, ...args) => {
    requireArgumentCount(args, 0);
    const settings = settingsStore.reset();
    updateApplicationMenu(settings);
    return settings;
  });
  handleTrusted(IPC_CHANNELS.appGetSettingsPath, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return settingsStore.getPath();
  });
  handleTrusted(IPC_CHANNELS.appGetSettingsDisplayPath, (_event, ...args) => {
    requireArgumentCount(args, 0);
    const settingsPath = settingsStore.getPath();
    const homePath = app.getPath('home');
    return settingsPath.startsWith(homePath)
      ? `~${settingsPath.slice(homePath.length)}`
      : settingsPath;
  });
  handleTrusted(IPC_CHANNELS.appGetSystemLocale, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return app.getLocale();
  });
  handleTrusted(IPC_CHANNELS.appGetSystemTheme, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'classic';
  });
  handleTrusted(IPC_CHANNELS.appIsFullscreen, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return mainWindow?.isFullScreen() || false;
  });
  handleTrusted(IPC_CHANNELS.appIsMaximized, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return isWindowMaximized();
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
  handleTrusted(IPC_CHANNELS.appSetZoomFactor, (_event, ...args) => {
    requireArgumentCount(args, 1);
    const factor = parseFiniteNumber(args[0], 75, 200) / 100;
    mainWindow?.webContents.setZoomFactor(factor);
    return factor;
  });
  handleTrusted(IPC_CHANNELS.appReadClipboard, async (_event, ...args) => {
    requireArgumentCount(args, 0);
    return readClipboardContents();
  });
  handleTrusted(IPC_CHANNELS.appWriteClipboard, async (_event, ...args) => {
    requireArgumentCount(args, 1);
    await clipboard.writeText(parseText(args[0]));
  });
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
  onTrusted(IPC_CHANNELS.appToggleFullscreen, (_event, ...args) => {
    requireArgumentCount(args, 0);
    mainWindow?.setFullScreen(!mainWindow.isFullScreen());
  });
  onTrusted(IPC_CHANNELS.windowMinimize, (_event, ...args) => {
    requireArgumentCount(args, 0);
    mainWindow?.minimize();
  });
  onTrusted(IPC_CHANNELS.windowMaximize, (_event, ...args) => {
    requireArgumentCount(args, 0);
    toggleWindowMaximized();
  });
  onTrusted(IPC_CHANNELS.windowClose, (_event, ...args) => {
    requireArgumentCount(args, 0);
    mainWindow?.close();
  });
  onTrusted(IPC_CHANNELS.appToggleDevTools, (_event, ...args) => {
    requireArgumentCount(args, 0);
    if (!mainWindow || !settingsStore.get('devToolsEnabled')) return;
    mainWindow.webContents.toggleDevTools();
  });
  onTrusted(IPC_CHANNELS.appCloseConfirmed, (_event, ...args) => {
    requireArgumentCount(args, 0);
    if (mainWindow) windowCloseConfirmation.confirm(mainWindow);
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
    registerAppProtocol(localResourcePolicy, () => settingsStore.get('allowSvgImages'));
    settingsStore = new SettingsStore(applicationPaths.configDir);
    registerRemoteSvgImagePolicy();
    recoveryStore = new RecoveryStore(applicationPaths.recoveryDir);
    fileManager = new FileManagerService();
    fileWatchService = new FileWatchService(
      (filePath) => fileManager.readFile(filePath),
      (event) => send(IPC_CHANNELS.fileChanged, event),
    );
    registerIpcHandlers();
    updateApplicationMenu();
    nativeTheme.on('updated', () =>
      send(
        IPC_CHANNELS.appSystemThemeChanged,
        nativeTheme.shouldUseDarkColors ? 'dark' : 'classic',
      ),
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
  localResourcePolicy.clear();
  void fileWatchService?.dispose();
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    if (exportWebContents.has(contents)) {
      event.preventDefault();
      return;
    }
    // Only the canonical renderer page may be a top-level app: navigation;
    // bundled assets remain valid as subresources, not navigable documents.
    const decision = classifyNavigation(navigationUrl);
    if (decision.kind === 'internal') return;
    event.preventDefault();
    if (decision.kind === 'external') void shell.openExternal(decision.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (exportWebContents.has(contents)) return { action: 'deny' };
    const decision = classifyNavigation(url);
    if (decision.kind === 'external') void shell.openExternal(decision.url);
    return { action: 'deny' };
  });
});
