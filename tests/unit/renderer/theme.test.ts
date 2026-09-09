import { describe, expect, it } from 'vitest';
import {
  ALL_THEMES,
  DARK_THEMES,
  isDarkTheme,
  LIGHT_THEMES,
  THEME_MODES,
} from '../../../src/renderer/ui/theme';

describe('isDarkTheme', () => {
  it('returns true for dark themes', () => {
    expect(isDarkTheme('dark')).toBe(true);
    expect(isDarkTheme('claude-dark')).toBe(true);
    expect(isDarkTheme('monokai-pro-dark')).toBe(true);
  });

  it('returns false for light themes', () => {
    expect(isDarkTheme('classic')).toBe(false);
    expect(isDarkTheme('claude-light')).toBe(false);
    expect(isDarkTheme('monokai-pro-light')).toBe(false);
  });

  it('returns false for unknown theme strings', () => {
    expect(isDarkTheme('unknown')).toBe(false);
    expect(isDarkTheme('')).toBe(false);
  });
});

describe('theme constants', () => {
  it('DARK_THEMES contains exactly three dark themes', () => {
    expect(DARK_THEMES).toHaveLength(3);
    expect(DARK_THEMES).toContain('dark');
    expect(DARK_THEMES).toContain('claude-dark');
    expect(DARK_THEMES).toContain('monokai-pro-dark');
  });

  it('LIGHT_THEMES contains exactly three light themes', () => {
    expect(LIGHT_THEMES).toHaveLength(3);
    expect(LIGHT_THEMES).toContain('classic');
    expect(LIGHT_THEMES).toContain('claude-light');
    expect(LIGHT_THEMES).toContain('monokai-pro-light');
  });

  it('ALL_THEMES combines dark and light themes', () => {
    expect(ALL_THEMES).toHaveLength(6);
    for (const theme of [...DARK_THEMES, ...LIGHT_THEMES]) {
      expect(ALL_THEMES).toContain(theme);
    }
  });

  it('THEME_MODES contains light, dark, and system', () => {
    expect(THEME_MODES).toHaveLength(3);
    expect(THEME_MODES).toContain('light');
    expect(THEME_MODES).toContain('dark');
    expect(THEME_MODES).toContain('system');
  });
});
