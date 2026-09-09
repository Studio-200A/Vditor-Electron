// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { StatusMenuController } from '../../../src/renderer/ui/status-menu-controller.js';

function createFixture() {
  const modeTrigger = document.createElement('button');
  const modeMenu = document.createElement('div');
  modeMenu.classList.add('hidden');
  const ir = document.createElement('button');
  ir.dataset.statusMode = 'ir';
  ir.innerHTML = '<span class="checkmark"></span>';
  const sv = document.createElement('button');
  sv.dataset.statusMode = 'sv';
  sv.innerHTML = '<span class="checkmark"></span>';
  modeMenu.append(ir, sv);
  const themeTrigger = document.createElement('button');
  themeTrigger.innerHTML = '<span id="statusThemeIcon"></span>';
  const themeMenu = document.createElement('div');
  themeMenu.classList.add('hidden');
  const dark = document.createElement('button');
  dark.dataset.themeMode = 'dark';
  themeMenu.append(dark);
  document.body.append(modeTrigger, modeMenu, themeTrigger, themeMenu);
  const onSelectMode = vi.fn();
  const onSelectThemeMode = vi.fn();
  const onBeforeThemeOpen = vi.fn();
  let mode: string | null = 'ir';
  const controller = new StatusMenuController({
    document,
    modeTrigger,
    modeMenu,
    themeTrigger,
    themeMenu,
    getMode: () => mode,
    onBeforeThemeOpen,
    onSelectMode,
    onSelectThemeMode,
  });
  return {
    controller,
    modeTrigger,
    modeMenu,
    themeTrigger,
    themeMenu,
    ir,
    sv,
    dark,
    onSelectMode,
    onSelectThemeMode,
    onBeforeThemeOpen,
    setMode: (value: string | null) => (mode = value),
  };
}

describe('StatusMenuController', () => {
  it('opens the current mode menu and sends its selected mode to the application command', () => {
    const { controller, modeTrigger, modeMenu, ir, sv, onSelectMode } = createFixture();
    controller.init();
    modeTrigger.click();

    expect(modeMenu.classList.contains('hidden')).toBe(false);
    expect(ir.getAttribute('aria-checked')).toBe('true');
    expect(sv.getAttribute('aria-checked')).toBe('false');

    sv.click();
    expect(onSelectMode).toHaveBeenCalledWith('sv');
    expect(modeMenu.classList.contains('hidden')).toBe(true);
  });

  it('synchronizes theme presentation and dismisses theme UI through document clicks', () => {
    const { controller, themeTrigger, themeMenu, dark, onBeforeThemeOpen, onSelectThemeMode } =
      createFixture();
    controller.init();
    controller.syncTheme({ mode: 'dark', label: 'Dark', labelKey: 'themeMode.dark' });
    themeTrigger.click();

    expect(onBeforeThemeOpen).toHaveBeenCalledOnce();
    expect(themeMenu.classList.contains('hidden')).toBe(false);
    expect(themeTrigger.getAttribute('aria-label')).toBe('Dark');
    expect(dark.getAttribute('aria-checked')).toBe('true');

    dark.click();
    expect(onSelectThemeMode).toHaveBeenCalledWith('dark');
    expect(themeMenu.classList.contains('hidden')).toBe(true);

    themeTrigger.click();
    document.body.click();
    expect(themeMenu.classList.contains('hidden')).toBe(true);
  });

  it('removes its listeners when disposed', () => {
    const { controller, modeTrigger, modeMenu, setMode } = createFixture();
    controller.init();
    controller.dispose();
    setMode('ir');
    modeTrigger.click();

    expect(modeMenu.classList.contains('hidden')).toBe(true);
  });
});
