/**
 * Frozen IPC channel registration map recorded at the 0.2.6 modularization
 * baseline (docs/19-0.2.6-IPC-MODULARIZATION-PLAN.md, stage 0).
 *
 * Derived from the pre-migration `src/main/ipc-contract.ts` and the
 * `handleTrusted`/`onTrusted` registrations in `src/main/index.ts`, NOT from
 * post-migration registration results. Channel names are explicit string
 * literals so a contract rename cannot silently update the expectation.
 * The stage-5 channel coverage test consumes this map as its expectation.
 */

export type IpcChannelDomain =
  | 'file-dialogs'
  | 'file-operations'
  | 'file-watching'
  | 'settings'
  | 'persistent-state'
  | 'recovery'
  | 'shell-integration'
  | 'resource-health'
  | 'export-pdf'
  | 'window-controls'
  | 'app-shell';

export type IpcChannelDirection = 'invoke' | 'send';

export interface FrozenChannelRegistration {
  channel: string;
  domain: IpcChannelDomain;
  direction: IpcChannelDirection;
}

/** Channels emitted by the main process only; never registered from handlers. */
export const FROZEN_EVENT_CHANNELS: readonly string[] = [
  'file:changed',
  'app:openFiles',
  'app:systemThemeChanged',
  'app:requestClose',
  'window:fullscreenChanged',
  'window:maximizedChanged',
  'menu:action',
];

export const FROZEN_CHANNEL_REGISTRATIONS: readonly FrozenChannelRegistration[] = [
  // file-dialogs
  { channel: 'file:openDialog', domain: 'file-dialogs', direction: 'invoke' },
  { channel: 'file:openFolderDialog', domain: 'file-dialogs', direction: 'invoke' },
  { channel: 'file:saveDialog', domain: 'file-dialogs', direction: 'invoke' },
  { channel: 'file:exportDialog', domain: 'file-dialogs', direction: 'invoke' },
  // file-operations
  { channel: 'file:read', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:write', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:writeDocument', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:writeBinary', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:exists', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:identity', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:listDir', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:create', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:rename', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:prepareRename', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:delete', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:basename', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:dirname', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:relative', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:rebasePath', domain: 'file-operations', direction: 'invoke' },
  { channel: 'file:resolveMarkdownLink', domain: 'file-operations', direction: 'invoke' },
  // file-watching
  { channel: 'file:setWorkspaceWatch', domain: 'file-watching', direction: 'invoke' },
  { channel: 'file:watchDocument', domain: 'file-watching', direction: 'invoke' },
  { channel: 'file:unwatchDocument', domain: 'file-watching', direction: 'invoke' },
  { channel: 'file:resolveRenamedDocument', domain: 'file-watching', direction: 'invoke' },
  { channel: 'file:setResourceRoots', domain: 'file-watching', direction: 'invoke' },
  // settings
  { channel: 'app:getSettings', domain: 'settings', direction: 'invoke' },
  { channel: 'app:getDefaultSettings', domain: 'settings', direction: 'invoke' },
  { channel: 'app:saveSettings', domain: 'settings', direction: 'invoke' },
  { channel: 'app:resetSettings', domain: 'settings', direction: 'invoke' },
  { channel: 'app:getSettingsPath', domain: 'settings', direction: 'invoke' },
  { channel: 'app:getSettingsDisplayPath', domain: 'settings', direction: 'invoke' },
  // persistent-state
  { channel: 'app:getPersistentState', domain: 'persistent-state', direction: 'invoke' },
  { channel: 'app:savePersistentState', domain: 'persistent-state', direction: 'invoke' },
  { channel: 'app:clearPersistentState', domain: 'persistent-state', direction: 'invoke' },
  // recovery
  { channel: 'app:getRecoveryCandidates', domain: 'recovery', direction: 'invoke' },
  { channel: 'app:restoreRecovery', domain: 'recovery', direction: 'invoke' },
  { channel: 'app:saveRecovery', domain: 'recovery', direction: 'invoke' },
  { channel: 'app:discardRecovery', domain: 'recovery', direction: 'invoke' },
  // shell-integration
  { channel: 'app:openExternal', domain: 'shell-integration', direction: 'invoke' },
  { channel: 'app:showItemInFolder', domain: 'shell-integration', direction: 'invoke' },
  { channel: 'app:openDirectory', domain: 'shell-integration', direction: 'invoke' },
  { channel: 'app:readClipboard', domain: 'shell-integration', direction: 'invoke' },
  { channel: 'app:writeClipboard', domain: 'shell-integration', direction: 'invoke' },
  // resource-health
  { channel: 'app:resourceHealthEligible', domain: 'resource-health', direction: 'invoke' },
  { channel: 'app:setResourceHealthEligible', domain: 'resource-health', direction: 'invoke' },
  { channel: 'app:resourceHealthScan', domain: 'resource-health', direction: 'invoke' },
  { channel: 'app:resourceHealthReveal', domain: 'resource-health', direction: 'invoke' },
  { channel: 'app:resourceHealthPreview', domain: 'resource-health', direction: 'invoke' },
  { channel: 'app:resourceHealthTrash', domain: 'resource-health', direction: 'invoke' },
  { channel: 'app:resourceHealthDiscard', domain: 'resource-health', direction: 'send' },
  // export-pdf
  { channel: 'app:exportPDF', domain: 'export-pdf', direction: 'invoke' },
  // window-controls
  { channel: 'app:isFullscreen', domain: 'window-controls', direction: 'invoke' },
  { channel: 'app:isMaximized', domain: 'window-controls', direction: 'invoke' },
  { channel: 'app:setZoomFactor', domain: 'window-controls', direction: 'invoke' },
  { channel: 'app:toggleFullscreen', domain: 'window-controls', direction: 'send' },
  { channel: 'window:minimize', domain: 'window-controls', direction: 'send' },
  { channel: 'window:maximize', domain: 'window-controls', direction: 'send' },
  { channel: 'window:close', domain: 'window-controls', direction: 'send' },
  // app-shell
  { channel: 'app:getSystemLocale', domain: 'app-shell', direction: 'invoke' },
  { channel: 'app:getSystemTheme', domain: 'app-shell', direction: 'invoke' },
  { channel: 'app:getInfo', domain: 'app-shell', direction: 'invoke' },
  { channel: 'app:rendererReady', domain: 'app-shell', direction: 'send' },
  { channel: 'app:toggleDevTools', domain: 'app-shell', direction: 'send' },
  { channel: 'app:closeConfirmed', domain: 'app-shell', direction: 'send' },
];
