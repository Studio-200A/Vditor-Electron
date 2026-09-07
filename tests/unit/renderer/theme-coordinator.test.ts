import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeCoordinator } from '../../../src/renderer/ui/theme-coordinator';

describe('ThemeCoordinator', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM(`<!doctype html><html><head>
      <link id="theme-classic"><link id="theme-dark">
    </head><body><form id="settingsForm">
      <select name="contentTheme"><option value="light">Light</option><option value="dark">Dark</option></select>
      <select name="codeTheme"><option value="github" data-theme-tone="light">GitHub</option><option value="github-dark" data-theme-tone="dark">GitHub Dark</option></select>
    </form></body></html>`);
    vi.stubGlobal('HTMLSelectElement', dom.window.HTMLSelectElement);
    vi.stubGlobal('Option', dom.window.Option);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('links content and code themes to a dark application theme without rebuilding tabs', async () => {
    const settings = {
      theme: 'dark',
      systemTheme: false,
      darkTheme: 'dark',
      lightTheme: 'classic',
      contentTheme: 'light',
      codeTheme: 'github',
      darkCodeTheme: 'github-dark',
      lightCodeTheme: 'github',
    };
    const setTheme = vi.fn();
    const persist = vi.fn(async (patch) => Object.assign(settings, patch));
    const syncStatusTheme = vi.fn();
    const coordinator = new ThemeCoordinator({
      document: dom.window.document,
      settingsForm: dom.window.document.querySelector('form') as HTMLFormElement,
      getSettings: () => settings,
      replaceSettings: (next) => Object.assign(settings, next),
      getTabs: () => [
        { host: dom.window.document.createElement('section'), toolbar: null, vditor: { setTheme } },
      ],
      getSystemTheme: async () => 'dark',
      isDarkTheme: (theme) => theme === 'dark',
      persist,
      syncStatusTheme,
      classifyCodeThemeButtons: () => [],
    });

    await coordinator.applyTheme('dark');

    expect(settings).toMatchObject({ contentTheme: 'dark', codeTheme: 'github-dark' });
    expect(persist).toHaveBeenCalledWith({ contentTheme: 'dark', codeTheme: 'github-dark' });
    expect(dom.window.document.documentElement.dataset.theme).toBe('dark');
    expect(dom.window.document.getElementById('theme-dark')).toHaveProperty('disabled', false);
    expect(setTheme).toHaveBeenCalledWith(
      'dark',
      'dark',
      'github-dark',
      'app://app/vditor/dist/css/content-theme',
    );
    expect(syncStatusTheme).toHaveBeenCalledWith('dark');
  });
});
