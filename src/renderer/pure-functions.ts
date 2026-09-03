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
export type {
  TabControllerCallbacks,
  TabControllerOptions,
  TabViewModel,
} from './documents/tab-controller.js';
export { DocumentController } from './documents/document-controller.js';
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
