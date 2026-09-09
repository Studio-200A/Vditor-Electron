// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApplicationShellController,
  type ApplicationShellResources,
} from '../../../src/renderer/app/application-shell-controller';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('ApplicationShellController', () => {
  it('initializes once and releases setup-installed DOM handlers and listeners', () => {
    document.body.innerHTML = '<button id="action"></button>';
    const action = document.getElementById('action') as HTMLButtonElement;
    const setup = vi.fn((resources: ApplicationShellResources) => {
      action.onclick = vi.fn();
      resources.listen(action, 'mouseenter', action.onclick);
    });
    const controller = new ApplicationShellController({ document, setup });

    controller.init();
    controller.init();
    action.click();
    action.dispatchEvent(new MouseEvent('mouseenter'));
    expect(setup).toHaveBeenCalledTimes(1);
    expect(action.onclick).toHaveBeenCalledTimes(2);

    controller.dispose();
    action.click();
    action.dispatchEvent(new MouseEvent('mouseenter'));
    expect(action.onclick).toBeNull();
  });

  it('disconnects observers and cancels timers, animation frames, and subscriptions once', () => {
    const disconnectResize = vi.fn();
    const disconnectMutation = vi.fn();
    const unsubscribe = vi.fn();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const controller = new ApplicationShellController({
      document,
      setup(resources) {
        resources.observeResize({ disconnect: disconnectResize } as ResizeObserver);
        resources.observeMutations({ disconnect: disconnectMutation } as MutationObserver);
        resources.timeout(setTimeout(() => {}, 10));
        resources.animationFrame(12);
        resources.add(unsubscribe);
      },
    });

    controller.init();
    controller.dispose();
    controller.dispose();

    expect(disconnectResize).toHaveBeenCalledTimes(1);
    expect(disconnectMutation).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(12);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
