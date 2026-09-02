import { DARK_THEMES, LIGHT_THEMES, isDarkTheme } from './theme.js';
import type { AppTheme, ThemeMode } from './theme.js';

export interface ThemeSettings {
  theme: string;
  systemTheme: boolean;
  darkTheme: string;
  lightTheme: string;
  codeTheme: string;
  darkCodeTheme: string;
  lightCodeTheme: string;
  contentTheme: string;
}

export interface ThemeControllerDeps {
  getSettings: () => ThemeSettings;
  getSystemTheme: () => Promise<string>;
  applyThemeToDocument: (theme: string, dark: boolean) => void;
  applyContentTheme: (contentTheme: string) => void;
  applyCodeTheme: (dark: boolean, codeTheme: string) => void;
  saveSettings: (patch: Partial<ThemeSettings>) => Promise<ThemeSettings>;
}

export function resolveEffectiveTheme(settings: ThemeSettings, systemTheme: string): AppTheme {
  if (settings.systemTheme) {
    return systemTheme === 'dark'
      ? (settings.darkTheme as AppTheme)
      : (settings.lightTheme as AppTheme);
  }
  return settings.theme as AppTheme;
}

export function resolveThemeMode(settings: ThemeSettings): ThemeMode {
  if (settings.systemTheme) return 'system';
  return isDarkTheme(settings.theme) ? 'dark' : 'light';
}

export function validateDarkTheme(theme: string): AppTheme {
  return (DARK_THEMES as readonly string[]).includes(theme) ? (theme as AppTheme) : 'dark';
}

export function validateLightTheme(theme: string): AppTheme {
  return (LIGHT_THEMES as readonly string[]).includes(theme) ? (theme as AppTheme) : 'classic';
}

export function getPreferredCodeTheme(settings: ThemeSettings, dark: boolean): string {
  return dark ? settings.darkCodeTheme : settings.lightCodeTheme;
}

export function resolveContentTheme(settings: ThemeSettings, dark: boolean): string {
  const linkedContentTheme = ['light', 'dark'].includes(settings.contentTheme);
  if (linkedContentTheme) {
    return dark ? 'dark' : 'light';
  }
  return settings.contentTheme;
}
