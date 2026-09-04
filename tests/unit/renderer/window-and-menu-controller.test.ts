import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenuController } from '../../../src/renderer/ui/context-menu-controller';
import { MenuController } from '../../../src/renderer/ui/menu-controller';
import { WindowController } from '../../../src/renderer/ui/window-controller';

describe('window and menu controllers', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM(`<!doctype html><body>
      <div id="title"><div id="menu"><button data-menu="main">Main</button></div></div>
      <button id="sidebar"></button><button id="minimize"></button><button id="maximize"></button><button id="close"></button>
      <div id="context" class="hidden"></div>
    </body>`);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('Element', dom.window.Element);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders checked menu state and dispatches named commands without writing state', () => {
    const command = vi.fn();
    const controller = new MenuController({
      menuBar: document.getElementById('menu') as HTMLElement,
      titlebar: document.getElementById('title') as HTMLElement,
      toggleSidebar: document.getElementById('sidebar'),
      translate: (key) => key,
      onPopupCreated: () => undefined,
      getMenu: () => [
        { label: 'menu.command', action: command, checked: () => true },
        { label: 'menu.disabled', action: command, disabled: () => true },
      ],
    });
    controller.init();
    (document.querySelector('[data-menu="main"]') as HTMLButtonElement).click();

    const popup = document.querySelector('.app-menu-popup') as HTMLElement;
    expect(popup.querySelector('.checkmark')?.textContent).toBe('✓');
    (popup.querySelector('button') as HTMLButtonElement).click();
    expect(command).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('owns context-menu replacement and preserves the action state until dispatch', () => {
    const action = vi.fn();
    const controller = new ContextMenuController(
      document.getElementById('context') as HTMLElement,
      vi.fn(),
    );
    controller.show(
      new dom.window.MouseEvent('contextmenu', { clientX: 10, clientY: 10 }),
      [{ id: 'rename', label: 'Rename', action }],
      { path: '/notes' },
    );
    (document.querySelector('[data-context-action="rename"]') as HTMLButtonElement).click();

    expect(action).toHaveBeenCalledWith({ path: '/notes' });
    expect(controller.isOpen()).toBe(false);
  });

  it('binds window controls once and removes display subscriptions on dispose', () => {
    const minimize = vi.fn();
    const maximize = vi.fn();
    const closeWindow = vi.fn();
    const unsubscribeFullscreen = vi.fn();
    const unsubscribeMaximized = vi.fn();
    const fullscreen = vi.fn();
    const maximized = vi.fn();
    const controller = new WindowController({
      appAPI: {
        minimize,
        maximize,
        closeWindow,
        onFullscreenChanged: () => unsubscribeFullscreen,
        onMaximizedChanged: () => unsubscribeMaximized,
      },
      titlebar: document.getElementById('title') as HTMLElement,
      minimize: document.getElementById('minimize') as HTMLButtonElement,
      maximize: document.getElementById('maximize') as HTMLButtonElement,
      close: document.getElementById('close') as HTMLButtonElement,
      onFullscreenChanged: fullscreen,
      onMaximizedChanged: maximized,
    });
    controller.init();
    (document.getElementById('minimize') as HTMLButtonElement).click();
    (document.getElementById('maximize') as HTMLButtonElement).click();
    (document.getElementById('close') as HTMLButtonElement).click();
    expect(minimize).toHaveBeenCalledOnce();
    expect(maximize).toHaveBeenCalledOnce();
    expect(closeWindow).toHaveBeenCalledOnce();
    controller.dispose();
    expect(unsubscribeFullscreen).toHaveBeenCalledOnce();
    expect(unsubscribeMaximized).toHaveBeenCalledOnce();
  });
});
