// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarLayoutController } from '../../../src/renderer/ui/sidebar-layout-controller';

function fixture() {
  document.body.innerHTML =
    '<main id="app"><aside id="sidebar" class="collapsed"></aside><button id="toggle"></button><nav id="menu"></nav><div id="actions"></div><div id="tabBar"></div><div id="toolbar"></div><div id="editorArea"></div></main>';
  const app = document.getElementById('app')!;
  const sidebar = document.getElementById('sidebar')!;
  let visible = false;
  const persistSidebarVisible = vi.fn();
  const applyTopControlsWidth = vi.fn();
  const controller = new SidebarLayoutController({
    app,
    sidebar,
    toggle: document.getElementById('toggle')!,
    menuBar: document.getElementById('menu')!,
    animatedElements: ['tabBar', 'toolbar', 'editorArea'].map((id) => document.getElementById(id)!),
    chromeElements: ['tabBar', 'toolbar'].map((id) => document.getElementById(id)!),
    getSidebarWidth: () => 240,
    getSidebarVisible: () => visible,
    setSidebarVisible: (next) => {
      visible = next;
    },
    persistSidebarVisible,
    applyTopControlsWidth,
    syncTopControlsWidth: vi.fn(),
    refreshEditorLayout: vi.fn(),
    duration: () => 1,
  });
  return { app, sidebar, controller, persistSidebarVisible, applyTopControlsWidth };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('SidebarLayoutController', () => {
  it('does not persist when initialization already matches the requested visibility', () => {
    const f = fixture();
    f.controller.toggle(false);
    expect(f.persistSidebarVisible).not.toHaveBeenCalled();
    expect(document.getElementById('toggle')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('persists a transition and cancels its timer/listener on disposal', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.controller.toggle(true);
    expect(f.app.classList.contains('sidebar-transitioning')).toBe(true);
    expect(f.persistSidebarVisible).toHaveBeenCalledWith(true);
    f.controller.dispose();
    vi.runAllTimers();
    expect(f.app.classList.contains('sidebar-transitioning')).toBe(false);
    vi.useRealTimers();
  });

  it('releases toolbar chrome width before hiding a visible sidebar', () => {
    const f = fixture();
    f.sidebar.classList.remove('collapsed');

    f.controller.toggle(false);

    expect(f.applyTopControlsWidth).toHaveBeenCalledWith(0, 0);
  });
});
