import type { SupportedLocale, VditorDesktopLocales } from '../types/locales.js';

export const IPC_ERROR_MESSAGE_KEYS: Record<string, string> = {
  IPC_INVALID_ARGUMENT: 'message.ipcInvalidRequest',
  IPC_PERMISSION_DENIED: 'message.ipcPermissionDenied',
  IPC_ALREADY_EXISTS: 'message.ipcAlreadyExists',
  IPC_NOT_FOUND: 'message.ipcNotFound',
  IPC_INVALID_NAME: 'message.ipcInvalidName',
  IPC_SETTINGS_PERSIST_FAILED: 'message.ipcSettingsSaveFailed',
  IPC_OPERATION_FAILED: 'message.ipcOperationFailed',
};

export function resolveLocale(
  locale: string | undefined,
  navigatorLanguage: string,
  locales: VditorDesktopLocales,
): SupportedLocale {
  if (locale && locale !== 'system' && locales[locale as SupportedLocale]) {
    return locale as SupportedLocale;
  }
  const language = navigatorLanguage.replace('_', '-').toLowerCase();
  if (!language.startsWith('zh')) return 'en_US';
  return /(?:^|-)hant(?:-|$)|(?:^|-)(?:tw|hk|mo)(?:-|$)/.test(language) ? 'zh_Hant' : 'zh_Hans';
}

export function translate(
  locales: VditorDesktopLocales,
  currentLocale: SupportedLocale,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const table = locales[currentLocale] || locales.en_US || {};
  const english = locales.en_US || {};
  const fallback = Object.prototype.hasOwnProperty.call(english, key) ? english[key] : key;
  const value = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
  return String(value).replace(/\{(\w+)\}/g, (_match, name) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`,
  );
}

export function formatIpcErrorMessage(
  error: unknown,
  locales: VditorDesktopLocales,
  currentLocale: SupportedLocale,
): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = Object.keys(IPC_ERROR_MESSAGE_KEYS).find((candidate) => message.includes(candidate));
  return code ? translate(locales, currentLocale, IPC_ERROR_MESSAGE_KEYS[code]) : message;
}
