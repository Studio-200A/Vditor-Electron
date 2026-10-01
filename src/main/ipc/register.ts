import type { AppSettings } from '../services/app-state';
import type { FileManagerService } from '../services/file-manager';
import type { FileWatchService } from '../services/file-watch-service';
import type { LocalResourcePolicy } from '../local-resource';
import type { PersistentStateStore } from '../services/persistent-state-store';
import type { RecoveryStore } from '../services/recovery-store';
import type { ResourceHealthService } from '../services/resource-health-service';
import type { SettingsStore } from '../services/settings-store';
import type { WindowCloseConfirmation } from '../services/window-close-confirmation';
import type { MainProcessTranslator } from './file-dialogs';
import { createSavePathChooser } from './file-dialogs';
import { registerAppShellIpcHandlers } from './app-shell';
import { registerExportPdfIpcHandlers } from './export-pdf';
import { registerFileDialogsIpcHandlers } from './file-dialogs';
import { registerFileOperationsIpcHandlers } from './file-operations';
import { registerFileWatchingIpcHandlers } from './file-watching';
import { registerPersistentStateIpcHandlers } from './persistent-state';
import { registerRecoveryIpcHandlers } from './recovery';
import { registerResourceHealthIpcHandlers } from './resource-health';
import { registerSettingsIpcHandlers } from './settings';
import { registerShellIntegrationIpcHandlers } from './shell-integration';
import { registerWindowControlsIpcHandlers } from './window-controls';
import {
  createTrustedChannelRegistration,
  type TrustedChannelRegistrationDeps,
} from './trusted-channel';

/**
 * Everything the domain IPC registrations need from the application shell.
 * index.ts constructs this from already-initialized services plus narrow
 * named callbacks; unit tests construct it from controlled dependencies.
 */
export interface IpcRegistrationDeps extends TrustedChannelRegistrationDeps {
  fileManager: FileManagerService;
  fileWatchService: FileWatchService;
  settingsStore: SettingsStore;
  persistentStateStore: PersistentStateStore;
  recoveryStore: RecoveryStore;
  resourceHealthService: ResourceHealthService;
  localResourcePolicy: LocalResourcePolicy;
  windowCloseConfirmation: WindowCloseConfirmation<Electron.BrowserWindow>;
  isWindowMaximized(): boolean;
  toggleWindowMaximized(): void;
  tr: MainProcessTranslator;
  onMenuAffectingSettingsChanged(settings: AppSettings): void;
  onMenuEligibilityChanged(eligible: boolean): void;
  onRendererReady(): void;
}

/**
 * Composition entry for all renderer-facing IPC handlers: creates the single
 * shared trusted-channel registration and wires the eleven domain modules.
 * Contains no handler implementations and no application startup side
 * effects, so the channel coverage test can import it directly.
 */
export function registerIpcHandlers(deps: IpcRegistrationDeps): void {
  const registration = createTrustedChannelRegistration(deps);
  const { handleTrusted, onTrusted } = registration;

  registerFileDialogsIpcHandlers({
    getMainWindow: deps.getMainWindow,
    tr: deps.tr,
    registration: { handleTrusted, onTrusted },
  });
  registerFileOperationsIpcHandlers({
    fileManager: deps.fileManager,
    fileWatchService: deps.fileWatchService,
    registration: { handleTrusted, onTrusted },
  });
  registerFileWatchingIpcHandlers({
    fileWatchService: deps.fileWatchService,
    localResourcePolicy: deps.localResourcePolicy,
    registration: { handleTrusted, onTrusted },
  });
  registerSettingsIpcHandlers({
    settingsStore: deps.settingsStore,
    onMenuAffectingSettingsChanged: deps.onMenuAffectingSettingsChanged,
    registration: { handleTrusted, onTrusted },
  });
  registerPersistentStateIpcHandlers({
    persistentStateStore: deps.persistentStateStore,
    registration: { handleTrusted, onTrusted },
  });
  registerRecoveryIpcHandlers({
    recoveryStore: deps.recoveryStore,
    registration: { handleTrusted, onTrusted },
  });
  registerShellIntegrationIpcHandlers({
    registration: { handleTrusted, onTrusted },
  });
  registerResourceHealthIpcHandlers({
    resourceHealthService: deps.resourceHealthService,
    settingsStore: deps.settingsStore,
    onMenuEligibilityChanged: deps.onMenuEligibilityChanged,
    registration: { handleTrusted, onTrusted },
  });
  registerExportPdfIpcHandlers({
    chooseSavePath: createSavePathChooser(deps.getMainWindow),
    fileManager: deps.fileManager,
    registration: { handleTrusted, onTrusted },
  });
  registerWindowControlsIpcHandlers({
    getMainWindow: deps.getMainWindow,
    isWindowMaximized: deps.isWindowMaximized,
    toggleWindowMaximized: deps.toggleWindowMaximized,
    registration: { handleTrusted, onTrusted },
  });
  registerAppShellIpcHandlers({
    getMainWindow: deps.getMainWindow,
    settingsStore: deps.settingsStore,
    windowCloseConfirmation: deps.windowCloseConfirmation,
    onRendererReady: deps.onRendererReady,
    registration: { handleTrusted, onTrusted },
  });
}
