import { app, session } from 'electron';
import { IPC_CHANNELS } from '../ipc-contract';
import { parseSettingsPatch, requireArgumentCount } from '../ipc-validation';
import type { AppSettings } from '../services/app-state';
import { DEFAULT_SETTINGS } from '../services/app-state';
import type { SettingsStore } from '../services/settings-store';
import type { TrustedChannelRegistration } from './trusted-channel';

export interface SettingsIpcDeps {
  settingsStore: SettingsStore;
  /** Rebuilds the platform application menu for settings that affect it. */
  onMenuAffectingSettingsChanged: (settings: AppSettings) => void;
  registration: TrustedChannelRegistration;
}

export function registerSettingsIpcHandlers(deps: SettingsIpcDeps): void {
  const { handleTrusted } = deps.registration;
  const { settingsStore, onMenuAffectingSettingsChanged } = deps;

  handleTrusted(IPC_CHANNELS.appGetSettings, (_event, ...args) => {
    requireArgumentCount(args, 0);
    return settingsStore.getAll();
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
      onMenuAffectingSettingsChanged(savedSettings);
    return savedSettings;
  });
  handleTrusted(IPC_CHANNELS.appResetSettings, (_event, ...args) => {
    requireArgumentCount(args, 0);
    const settings = settingsStore.reset();
    onMenuAffectingSettingsChanged(settings);
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
}
