export { escapeHTML, fileName, stripExtension } from './utils/strings.js';
export { detectLineEnding } from './utils/line-ending.js';
export { ALL_THEMES, DARK_THEMES, isDarkTheme, LIGHT_THEMES, THEME_MODES } from './ui/theme.js';
export {
  formatIpcErrorMessage,
  IPC_ERROR_MESSAGE_KEYS,
  resolveLocale,
  translate,
} from './ui/localization.js';
export {
  getPreferredCodeTheme,
  resolveContentTheme,
  resolveEffectiveTheme,
  resolveThemeMode,
  validateDarkTheme,
  validateLightTheme,
} from './ui/theme-controller.js';
export { NotificationsController } from './ui/notifications.js';
export type { ConfirmDialogOptions, DialogAction } from './ui/notifications.js';
export { TabController } from './documents/tab-controller.js';
export { EditorController } from './editor/editor-controller.js';
export type {
  EditorControllerOptions,
  EditorRuntimeTab,
  EditorScrollPosition,
  ToolbarHandlers,
} from './editor/editor-controller.js';
export { OutlineController } from './editor/outline-controller.js';
export type {
  OutlineControllerOptions,
  OutlineHeading,
  OutlineTab,
} from './editor/outline-controller.js';
export { FindController } from './editor/find-controller.js';
export type { FindControllerOptions, FindRuntime } from './editor/find-controller.js';
export { SplitViewController } from './editor/split-view-controller.js';
export type { SplitViewControllerOptions, SplitViewTab } from './editor/split-view-controller.js';
export {
  ImageController,
  ImageRuntimeController,
  sanitizeImageFileName,
} from './editor/image-controller.js';
export type {
  ImageControllerOptions,
  ImageFileBridge,
  ImageRuntimeControllerOptions,
  ImageRuntimeTab,
  ImageUploadTab,
} from './editor/image-controller.js';
export { ToolbarController } from './editor/toolbar-controller.js';
export type { ToolbarControllerOptions, ToolbarRuntime } from './editor/toolbar-controller.js';
export { EditorRuntimeCoordinator } from './editor/editor-runtime-coordinator.js';
export type {
  EditorRuntimeCoordinatorOptions,
  EditorRuntimeCoordinatorTab,
} from './editor/editor-runtime-coordinator.js';
export { RecoveryRuntimeController } from './editor/recovery-runtime-controller.js';
export type {
  RecoveryRuntimeControllerOptions,
  RecoveryRuntimeTab,
} from './editor/recovery-runtime-controller.js';
export { RecoveryBannerController } from './editor/recovery-banner-controller.js';
export type {
  RecoveryBannerControllerOptions,
  RecoveryBannerState,
  RecoveryBannerTab,
} from './editor/recovery-banner-controller.js';
export {
  createEditorOptions,
  effectiveToolbarItems,
  VDITOR_INITIALIZATION_SETTINGS,
} from './editor/editor-options.js';
export type {
  EditorOptionsDependencies,
  EditorOptionsSettings,
  EditorOptionsTab,
} from './editor/editor-options.js';
export type {
  TabControllerCallbacks,
  TabControllerOptions,
  TabViewModel,
} from './documents/tab-controller.js';
export { DocumentController } from './documents/document-controller.js';
export type { DocumentBindingTransition } from './documents/document-binding-transition.js';
export type {
  DocumentControllerOptions,
  DocumentFileBridge,
  OpenDocumentInput,
  OpenedDocument,
} from './documents/document-controller.js';
export { toRecoveryStoreSnapshot } from './documents/recovery-snapshot.js';
export type {
  RecoverySnapshotSource,
  RecoveryStoreSnapshot,
  RestoredRecoveryStoreSnapshot,
} from './documents/recovery-snapshot.js';
export { fromRecoveryStoreSnapshot } from './documents/recovery-snapshot.js';
export {
  fromPersistedSessionSnapshot,
  toPersistedSessionSnapshot,
} from './documents/session-snapshot.js';
export type {
  PersistedSessionSnapshot,
  PersistedSessionSource,
} from './documents/session-snapshot.js';
export { PERSISTED_SESSION_SNAPSHOT_VERSION } from './documents/session-snapshot.js';
export { AppStore } from './state/store.js';
export type {
  AppState,
  DocumentState,
  DocumentTab,
  EditorRuntime,
  ExternalConflict,
  ExternalFileState,
  RecoveryState,
  EditMode,
} from './state/types.js';
export {
  toSessionSnapshot,
  toRecoverySnapshot,
  restoreDocumentState,
  restoreRecoveryState,
  SESSION_SNAPSHOT_VERSION,
  RECOVERY_SNAPSHOT_VERSION,
} from './state/snapshots.js';
export type { SessionDocumentSnapshot, RecoveryDocumentSnapshot } from './state/snapshots.js';
export { WorkspaceController } from './workspace/workspace-controller.js';
export type {
  WorkspaceControllerOptions,
  WorkspaceSettings,
} from './workspace/workspace-controller.js';
export { ExplorerController } from './workspace/explorer-controller.js';
export type {
  ExplorerControllerOptions,
  ExplorerEntry,
  ExplorerSettings,
} from './workspace/explorer-controller.js';
export { SettingsController, classifySettingsChange } from './settings/settings-controller.js';
export type {
  SettingsChange,
  SettingsControllerOptions,
  SettingsImpact,
} from './settings/settings-controller.js';
export { SettingsWindow } from './settings/settings-window.js';
export type { SettingsWindowOptions } from './settings/settings-window.js';
export { LocalizationController } from './ui/localization-controller.js';
export type { LocalizationControllerOptions } from './ui/localization-controller.js';
export { ContextMenuController } from './ui/context-menu-controller.js';
export type { ContextMenuItem } from './ui/context-menu-controller.js';
export { MenuController } from './ui/menu-controller.js';
export type { MenuControllerOptions, MenuItem } from './ui/menu-controller.js';
export { WindowController } from './ui/window-controller.js';
export type { WindowControllerOptions } from './ui/window-controller.js';
export { ExportController } from './export/export-controller.js';
export type { ExportControllerOptions, ExportDocument } from './export/export-controller.js';
