export const DARK_THEMES = ['dark', 'claude-dark', 'monokai-pro-dark'] as const;
export const LIGHT_THEMES = ['classic', 'claude-light', 'monokai-pro-light'] as const;
export const ALL_THEMES = [...DARK_THEMES, ...LIGHT_THEMES] as const;
export const THEME_MODES = ['light', 'dark', 'system'] as const;

export type AppTheme = (typeof ALL_THEMES)[number];
export type ThemeMode = (typeof THEME_MODES)[number];

export function isDarkTheme(theme: string): boolean {
  return (DARK_THEMES as readonly string[]).includes(theme);
}
