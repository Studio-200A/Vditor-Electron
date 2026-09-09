// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { ToolbarController } from '../../../src/renderer/editor/toolbar-controller.js';

interface Runtime {
  host: HTMLElement;
  toolbar: HTMLElement | null;
  ready: boolean;
}

function createFixture() {
  const app = document.createElement('main');
  const mount = document.createElement('div');
  const mainArea = document.createElement('section');
  app.append(mount, mainArea);
  const first: Runtime = {
    host: document.createElement('section'),
    toolbar: document.createElement('div'),
    ready: true,
  };
  const second: Runtime = {
    host: document.createElement('section'),
    toolbar: document.createElement('div'),
    ready: true,
  };
  document.body.append(first.host, second.host);
  let active: Runtime | null = first;
  const controller = new ToolbarController({
    app,
    mount,
    mainArea,
    getActiveRuntime: () => active,
    getPreviewRuntime: () => null,
    findRuntimeByToolbar: (toolbar) => (toolbar === first.toolbar ? first : second),
    getMountedToolbar: () => mount.firstElementChild as HTMLElement | null,
  });
  return {
    controller,
    first,
    second,
    mount,
    setActive: (runtime: Runtime | null) => (active = runtime),
  };
}

describe('ToolbarController', () => {
  it('returns the prior toolbar to its owner before mounting the active runtime', () => {
    const { controller, first, second, mount } = createFixture();
    controller.mountRuntime(first);
    controller.mountRuntime(second);

    expect(mount.firstElementChild).toBe(second.toolbar);
    expect(first.host.firstElementChild).toBe(first.toolbar);
  });

  it('keeps the shared row pending until an active runtime owns its mounted toolbar', () => {
    const { controller, first, mount } = createFixture();
    controller.syncAvailability();
    expect(mount.dataset.toolbarPending).toBe('true');

    controller.mountRuntime(first);
    controller.syncAvailability();
    expect(mount.dataset.toolbarPending).toBe('false');
    expect(mount.getAttribute('aria-busy')).toBe('false');
  });

  it('disables every preview toolbar control', () => {
    const { controller, first } = createFixture();
    const button = document.createElement('button');
    const input = document.createElement('input');
    first.toolbar?.append(button, input);
    controller.disablePreview(first);

    expect(button.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect(button.tabIndex).toBe(-1);
  });

  it('cancels its deferred measurement during disposal', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { controller } = createFixture();
    controller.scheduleWrapHeight();
    controller.dispose();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });
});
