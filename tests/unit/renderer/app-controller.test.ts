// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppController,
  type AppCommands,
  type AppStartup,
} from '../../../src/renderer/app/app-controller';

const controllers: AppController[] = [];

function fixture() {
  const order: string[] = [];
  const step = (name: string) =>
    vi.fn(() => {
      order.push(name);
    });
  const startup: AppStartup = {
    loadSettings: step('settings'),
    applyLocale: step('locale'),
    initializeUI: step('ui'),
    restoreWorkspace: step('workspace'),
    restoreSession: step('session'),
    restoreRecovery: step('recovery'),
    finishRestoration: step('finish'),
    dispose: vi.fn(),
  };
  const commands: AppCommands = {
    beforeShortcut: vi.fn(() => false),
    selectAll: vi.fn(),
    save: vi.fn(),
    openFiles: vi.fn(),
    openFolder: vi.fn(),
    newDocument: vi.fn(),
    toggleSidebar: vi.fn(),
    find: vi.fn(),
    settings: vi.fn(),
    closeDocument: vi.fn(),
    closeWindow: vi.fn(),
    openPaths: vi.fn(async () => {}),
    menu: vi.fn(),
    rejectDrop: vi.fn(),
  };
  const opened = new Set<(paths: string[]) => void>();
  const menus = new Set<(action: string, value?: string) => void>();
  const bridge = {
    onOpenFiles: vi.fn((callback: (paths: string[]) => void) => {
      opened.add(callback);
      return () => opened.delete(callback);
    }),
    onMenuAction: vi.fn((callback: (action: string, value?: string) => void) => {
      menus.add(callback);
      return () => menus.delete(callback);
    }),
    getDroppedPath: vi.fn((file: File) => file.name),
    rendererReady: vi.fn(() => {
      expect(document.body.dataset.appReady).toBe('true');
      order.push('ready');
    }),
  };
  const reportError = vi.fn();
  const controller = new AppController({
    document,
    window,
    startup,
    commands,
    bridge,
    reportError,
  });
  controllers.push(controller);
  return { controller, startup, commands, bridge, reportError, opened, menus, order };
}

function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  document.dispatchEvent(event);
  return event;
}

function drop(names: string[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: names.map((name) => new File([''], name)) },
  });
  document.body.dispatchEvent(event);
  return event;
}

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.restoreAllMocks();
});

describe('AppController', () => {
  it('restores workspace, session and recovery in order before announcing readiness once', async () => {
    const { controller, order, bridge } = fixture();
    await Promise.all([controller.init(), controller.init()]);
    await controller.init();
    expect(order).toEqual([
      'settings',
      'locale',
      'ui',
      'workspace',
      'session',
      'recovery',
      'finish',
      'ready',
    ]);
    expect(bridge.onOpenFiles).toHaveBeenCalledTimes(1);
  });

  it.each([
    'loadSettings',
    'initializeUI',
    'restoreWorkspace',
    'restoreRecovery',
    'finishRestoration',
  ] as const)(
    'cleans partial initialization when %s fails without announcing readiness',
    async (stage) => {
      const f = fixture();
      f.startup[stage] = async () => {
        throw new Error('failed stage');
      };
      await expect(f.controller.init()).rejects.toThrow('failed stage');
      expect(f.startup.dispose).toHaveBeenCalledTimes(1);
      expect(f.bridge.rendererReady).not.toHaveBeenCalled();
      expect(f.opened.size).toBe(0);
      expect(f.menus.size).toBe(0);
      press('n', { ctrlKey: true });
      expect(f.commands.newDocument).not.toHaveBeenCalled();
      f.controller.dispose();
      expect(f.startup.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('stops startup after unload while settings are pending', async () => {
    const f = fixture();
    let resolveSettings: () => void = () => {};
    f.startup.loadSettings = () =>
      new Promise<void>((resolve) => {
        resolveSettings = resolve;
      });
    const initializing = f.controller.init();
    window.dispatchEvent(new Event('beforeunload'));
    resolveSettings();
    await initializing;
    expect(f.startup.applyLocale).not.toHaveBeenCalled();
    expect(f.bridge.rendererReady).not.toHaveBeenCalled();
    expect(f.startup.dispose).toHaveBeenCalledTimes(1);
  });

  it('dispatches platform modifier shortcuts and preserves open/folder/sidebar modifiers', async () => {
    const f = fixture();
    await f.controller.init();
    expect(press('s', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(f.commands.save).toHaveBeenCalledWith(true);
    press('s', { ctrlKey: true });
    expect(f.commands.save).toHaveBeenLastCalledWith(false);
    for (const [key, command] of [
      ['o', 'openFiles'],
      ['k', 'openFolder'],
      ['b', 'toggleSidebar'],
    ] as const) {
      expect(press(key, { ctrlKey: true }).defaultPrevented).toBe(false);
      press(key, { ctrlKey: true, altKey: true, shiftKey: true });
      expect(f.commands[command]).not.toHaveBeenCalled();
      expect(press(key, { ctrlKey: true, altKey: true }).defaultPrevented).toBe(true);
      expect(f.commands[command]).toHaveBeenCalledTimes(1);
    }
    for (const [key, command] of [
      ['n', 'newDocument'],
      ['f', 'find'],
      [',', 'settings'],
      ['w', 'closeDocument'],
      ['q', 'closeWindow'],
    ] as const) {
      press(key, { metaKey: true });
      expect(f.commands[command]).toHaveBeenCalledTimes(1);
    }
  });

  it('preserves modal priority, native selection and already consumed Vditor shortcuts', async () => {
    const f = fixture();
    await f.controller.init();
    vi.mocked(f.commands.beforeShortcut).mockReturnValueOnce(true);
    press('n', { ctrlKey: true });
    expect(f.commands.newDocument).not.toHaveBeenCalled();
    const consumed = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    consumed.preventDefault();
    document.dispatchEvent(consumed);
    expect(f.commands.save).not.toHaveBeenCalled();
    expect(press('a', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(f.commands.selectAll).toHaveBeenCalledTimes(1);
    press('n');
    expect(f.commands.newDocument).not.toHaveBeenCalled();
  });

  it('routes queued open files, menu values and Markdown drops through domain commands', async () => {
    const f = fixture();
    await f.controller.init();
    f.opened.forEach((callback) => callback(['queued.md']));
    f.menus.forEach((callback) => callback('mode', 'sv'));
    expect(f.commands.openPaths).toHaveBeenCalledWith(['queued.md']);
    expect(f.commands.menu).toHaveBeenCalledWith('mode', 'sv');
    expect(drop(['one.MD', 'image.png', 'two.markdown']).defaultPrevented).toBe(true);
    expect(f.commands.openPaths).toHaveBeenLastCalledWith(['one.MD', 'two.markdown']);
    drop(['image.png']);
    expect(f.commands.rejectDrop).toHaveBeenCalledTimes(1);
    drop([]);
    expect(f.commands.rejectDrop).toHaveBeenCalledTimes(1);
  });

  it('reports asynchronous open failure and ignores callbacks retained after dispose', async () => {
    const f = fixture();
    await f.controller.init();
    const callback = [...f.opened][0];
    const error = new Error('open failed');
    vi.mocked(f.commands.openPaths).mockRejectedValueOnce(error);
    callback(['failed.md']);
    await Promise.resolve();
    expect(f.reportError).toHaveBeenCalledWith(error);
    f.controller.dispose();
    callback(['late.md']);
    expect(f.commands.openPaths).toHaveBeenCalledTimes(1);
  });

  it('removes window listeners and subscriptions on repeated dispose and fresh mount', async () => {
    const first = fixture();
    await first.controller.init();
    first.controller.dispose();
    first.controller.dispose();
    expect(first.opened.size).toBe(0);
    expect(first.menus.size).toBe(0);
    expect(document.body.dataset.appReady).toBeUndefined();
    const next = fixture();
    await next.controller.init();
    press('n', { ctrlKey: true });
    drop(['test.md']);
    expect(first.commands.newDocument).not.toHaveBeenCalled();
    expect(first.commands.openPaths).not.toHaveBeenCalled();
    expect(next.commands.newDocument).toHaveBeenCalledTimes(1);
    expect(next.commands.openPaths).toHaveBeenCalledTimes(1);
    expect(first.startup.dispose).toHaveBeenCalledTimes(1);
  });
});
