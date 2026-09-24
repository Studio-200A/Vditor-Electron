import {
  app,
  BrowserWindow,
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
import { invalidIpcArgument } from './ipc-guard';
import { IPC_CHANNELS } from './ipc-contract';
import { formatLocalResourceBase, LocalResourcePolicy } from './local-resource';
import {
  parseAbsolutePath,
  parseBoolean,
  parseFiniteNumber,
  parseOptionalAbsolutePath,
  parseOptionalText,
  parseResourceHealthCandidateIds,
  parseText,
  requireArgumentCount,
} from './ipc-validation';
import { classifyNavigation } from './navigation-policy';
import { createTrustedChannelRegistration } from './ipc/trusted-channel';
import { registerRecoveryIpcHandlers } from './ipc/recovery';
import { registerShellIntegrationIpcHandlers } from './ipc/shell-integration';
import { registerSettingsIpcHandlers } from './ipc/settings';
import { registerFileWatchingIpcHandlers } from './ipc/file-watching';
import { registerFileOperationsIpcHandlers } from './ipc/file-operations';
import { registerFileDialogsIpcHandlers, createSavePathChooser } from './ipc/file-dialogs';
import { registerPersistentStateIpcHandlers } from './ipc/persistent-state';
import { FileManagerService } from './services/file-manager';
import { FileWatchService } from './services/file-watch-service';
import { RecoveryStore } from './services/recovery-store';
import { SettingsStore } from './services/settings-store';
import { PersistentStateStore } from './services/persistent-state-store';
import { ResourceHealthService } from './services/resource-health-service';
import { WindowCloseConfirmation } from './services/window-close-confirmation';
import {
  AppSettings,
  DEFAULT_SETTINGS,
} from './services/app-state';

let mainWindow: BrowserWindow | null = null;
let fileManager: FileManagerService;
let settingsStore: SettingsStore;
let persistentStateStore: PersistentStateStore;
let recoveryStore: RecoveryStore;
let fileWatchService: FileWatchService;
const resourceHealthService = new ResourceHealthService();
let resourceHealthMenuEligible = false;
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

function saveWindowState(state: Parameters<PersistentStateStore['updateOrThrow']>[0]): void {
  void persistentStateStore.updateOrThrow(state).catch((error: unknown) => {
    console.error('Failed to persist window state:', error);
  });
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
  saveWindowState({ windowMaximized: maximized });
}

function persistNormalWindowBounds(): void {
  if (!mainWindow || windowMaximizedState || mainWindow.isMaximized() || mainWindow.isFullScreen())
    return;
  const bounds = mainWindow.getBounds();
  if (isMaximizedLikeBounds(bounds)) return;
  boundsBeforeMaximize = { ...bounds };
  saveWindowState({
    windowBounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
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

function initialWindowBounds(
  state: import('./services/app-state').PersistentAppState,
): Electron.Rectangle {
  const saved = state.windowBounds;
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
  saveWindowState({ windowBounds: repaired });
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
    saveWindowState({ windowBounds: { ...boundsBeforeMaximize } });
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
  if (theme === 'nord-dark') return '#2e3440';
  if (theme === 'elegant') return '#f0edea';
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
  Menu.setApplicationMenu(
    createAppMenu(getEffectiveLocale(settings), settings.editMode, resourceHealthMenuEligible),
  );
}

function createWindow(): void {
  const settings = settingsStore.getAll();
  const persistentState = persistentStateStore.getAll();
  const normalBounds = initialWindowBounds(persistentState);
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
  windowMaximizedState = persistentState.windowMaximized;
  boundsBeforeMaximize = { ...normalBounds };
  if (persistentState.windowMaximized) mainWindow.maximize();
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
    saveWindowState({ windowMaximized: windowMaximizedState });
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

const chooseSavePath = createSavePathChooser(() => mainWindow);

function registerIpcHandlers(): void {
  const { handleTrusted, onTrusted } = createTrustedChannelRegistration({
    registerInvoke: (channel, listener) => ipcMain.handle(channel, listener),
    registerMessage: (channel, listener) => ipcMain.on(channel, listener),
    getMainWindow: () => mainWindow,
  });
  registerFileDialogsIpcHandlers({
    getMainWindow: () => mainWindow,
    tr,
    registration: { handleTrusted, onTrusted },
  });

  const recoveryRegistration = {
    recoveryStore,
    registration: { handleTrusted, onTrusted },
  };
  registerRecoveryIpcHandlers(recoveryRegistration);
  registerSettingsIpcHandlers({
    settingsStore,
    onMenuAffectingSettingsChanged: (settings) => updateApplicationMenu(settings),
    registration: { handleTrusted, onTrusted },
  });
  registerPersistentStateIpcHandlers({
    persistentStateStore,
    registration: { handleTrusted, onTrusted },
  });
  registerShellIntegrationIpcHandlers({
    registration: { handleTrusted, onTrusted },
  });
  registerFileWatchingIpcHandlers({
    fileWatchService,
    localResourcePolicy,
    registration: { handleTrusted, onTrusted },
  });
  registerFileOperationsIpcHandlers({
    fileManager,
    fileWatchService,
    registration: { handleTrusted, onTrusted },
  });
  onTrusted(IPC_CHANNELS.appRendererReady, (_event, ...args) => {
    requireArgumentCount(args, 0);
    rendererReady = true;
    flushPendingOpenFiles();
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
  handleTrusted(IPC_CHANNELS.appResourceHealthEligible, async (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resourceHealthService.isEligible({
      documentPath: parseAbsolutePath(args[0]),
      workspacePath: parseAbsolutePath(args[1]),
    });
  });
  handleTrusted(IPC_CHANNELS.appSetResourceHealthEligible, (_event, ...args) => {
    requireArgumentCount(args, 1);
    const eligible = parseBoolean(args[0]);
    if (resourceHealthMenuEligible !== eligible) {
      resourceHealthMenuEligible = eligible;
      updateApplicationMenu();
    }
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthScan, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resourceHealthService.scan({
      documentPath: parseAbsolutePath(args[0]),
      workspacePath: parseAbsolutePath(args[1]),
      pasteImagesDir: settingsStore.get('pasteImagesDir'),
      allowSvgImages: settingsStore.get('allowSvgImages'),
    });
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthReveal, (_event, ...args) => {
    requireArgumentCount(args, 2);
    const candidatePath = resourceHealthService.resolveCandidate(
      parseText(args[0], 128),
      parseText(args[1], 128),
    );
    if (!candidatePath) invalidIpcArgument();
    shell.showItemInFolder(candidatePath);
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthPreview, (_event, ...args) => {
    requireArgumentCount(args, 2);
    const candidatePath = resourceHealthService.resolvePreviewCandidate(
      parseText(args[0], 128),
      parseText(args[1], 128),
    );
    if (!candidatePath) return null;
    return `${formatLocalResourceBase(path.dirname(candidatePath))}${encodeURIComponent(path.basename(candidatePath))}`;
  });
  handleTrusted(IPC_CHANNELS.appResourceHealthTrash, (_event, ...args) => {
    requireArgumentCount(args, 2);
    return resourceHealthService.trashCandidates(
      parseText(args[0], 128),
      parseResourceHealthCandidateIds(args[1]),
      (candidatePath) => shell.trashItem(candidatePath),
    );
  });
  onTrusted(IPC_CHANNELS.appResourceHealthDiscard, (_event, ...args) => {
    requireArgumentCount(args, 0);
    resourceHealthService.clear();
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
    persistentStateStore = new PersistentStateStore(
      applicationPaths.configDir,
      settingsStore.getLegacyPersistentState(),
    );
    if (
      persistentStateStore.migratedFromToml &&
      !settingsStore.removeLegacyPersistentStateFromDisk()
    )
      console.error('Failed to remove migrated application state from config.toml.');
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
  resourceHealthService.clear();
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
