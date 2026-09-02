import { describe, expect, it } from 'vitest';
import {
  getPreferredCodeTheme,
  resolveContentTheme,
  resolveEffectiveTheme,
  resolveThemeMode,
  validateDarkTheme,
  validateLightTheme,
} from '../../../src/renderer/ui/theme-controller';
import type { ThemeSettings } from '../../../src/renderer/ui/theme-controller';

function createSettings(overrides: Partial<ThemeSettings> = {}): ThemeSettings {
  return {
    theme: 'classic',
    systemTheme: false,
    darkTheme: 'dark',
    lightTheme: 'classic',
    codeTheme: 'github',
    darkCodeTheme: 'github-dark',
    lightCodeTheme: 'github',
    contentTheme: 'light',
    ...overrides,
  };
}

describe('resolveEffectiveTheme', () => {
  it('returns the configured theme when system theme is disabled', () => {
    const settings = createSettings({ theme: 'claude-dark', systemTheme: false });
    expect(resolveEffectiveTheme(settings, 'dark')).toBe('claude-dark');
  });

  it('returns the dark preference when system theme is dark', () => {
    const settings = createSettings({
      systemTheme: true,
      darkTheme: 'monokai-pro-dark',
      lightTheme: 'classic',
    });
    expect(resolveEffectiveTheme(settings, 'dark')).toBe('monokai-pro-dark');
  });

  it('returns the light preference when system theme is light', () => {
    const settings = createSettings({
      systemTheme: true,
      darkTheme: 'dark',
      lightTheme: 'claude-light',
    });
    expect(resolveEffectiveTheme(settings, 'light')).toBe('claude-light');
  });
});

describe('resolveThemeMode', () => {
  it('returns system when system theme is enabled', () => {
    const settings = createSettings({ systemTheme: true });
    expect(resolveThemeMode(settings)).toBe('system');
  });

  it('returns dark for dark themes', () => {
    const settings = createSettings({ systemTheme: false, theme: 'dark' });
    expect(resolveThemeMode(settings)).toBe('dark');
    expect(resolveThemeMode({ ...settings, theme: 'claude-dark' })).toBe('dark');
    expect(resolveThemeMode({ ...settings, theme: 'monokai-pro-dark' })).toBe('dark');
  });

  it('returns light for light themes', () => {
    const settings = createSettings({ systemTheme: false, theme: 'classic' });
    expect(resolveThemeMode(settings)).toBe('light');
    expect(resolveThemeMode({ ...settings, theme: 'claude-light' })).toBe('light');
    expect(resolveThemeMode({ ...settings, theme: 'monokai-pro-light' })).toBe('light');
  });
});

describe('validateDarkTheme', () => {
  it('returns the theme if it is a valid dark theme', () => {
    expect(validateDarkTheme('dark')).toBe('dark');
    expect(validateDarkTheme('claude-dark')).toBe('claude-dark');
    expect(validateDarkTheme('monokai-pro-dark')).toBe('monokai-pro-dark');
  });

  it('returns dark as fallback for invalid themes', () => {
    expect(validateDarkTheme('classic')).toBe('dark');
    expect(validateDarkTheme('unknown')).toBe('dark');
    expect(validateDarkTheme('')).toBe('dark');
  });
});

describe('validateLightTheme', () => {
  it('returns the theme if it is a valid light theme', () => {
    expect(validateLightTheme('classic')).toBe('classic');
    expect(validateLightTheme('claude-light')).toBe('claude-light');
    expect(validateLightTheme('monokai-pro-light')).toBe('monokai-pro-light');
  });

  it('returns classic as fallback for invalid themes', () => {
    expect(validateLightTheme('dark')).toBe('classic');
    expect(validateLightTheme('unknown')).toBe('classic');
    expect(validateLightTheme('')).toBe('classic');
  });
});

describe('getPreferredCodeTheme', () => {
  it('returns dark code theme when dark is true', () => {
    const settings = createSettings({ darkCodeTheme: 'github-dark' });
    expect(getPreferredCodeTheme(settings, true)).toBe('github-dark');
  });

  it('returns light code theme when dark is false', () => {
    const settings = createSettings({ lightCodeTheme: 'github' });
    expect(getPreferredCodeTheme(settings, false)).toBe('github');
  });
});

describe('resolveContentTheme', () => {
  it('returns dark when content theme is linked and dark mode', () => {
    const settings = createSettings({ contentTheme: 'dark' });
    expect(resolveContentTheme(settings, true)).toBe('dark');
  });

  it('returns light when content theme is linked and light mode', () => {
    const settings = createSettings({ contentTheme: 'light' });
    expect(resolveContentTheme(settings, false)).toBe('light');
  });

  it('returns the explicit content theme when not linked', () => {
    const settings = createSettings({ contentTheme: 'custom' });
    expect(resolveContentTheme(settings, true)).toBe('custom');
    expect(resolveContentTheme(settings, false)).toBe('custom');
  });
});
