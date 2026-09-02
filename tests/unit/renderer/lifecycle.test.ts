import { describe, expect, it, vi } from 'vitest';
import { LifecycleManager } from '../../../src/renderer/core/lifecycle';
import type { Controller } from '../../../src/renderer/core/controller';

describe('LifecycleManager', () => {
  it('initializes controllers in registration order', async () => {
    const order: string[] = [];
    const manager = new LifecycleManager();

    const first: Controller = {
      init: () => {
        order.push('first-init');
      },
      dispose: () => {
        order.push('first-dispose');
      },
    };
    const second: Controller = {
      init: () => {
        order.push('second-init');
      },
      dispose: () => {
        order.push('second-dispose');
      },
    };

    await manager.registerAndInit('first', first);
    await manager.registerAndInit('second', second);

    expect(order).toEqual(['first-init', 'second-init']);
  });

  it('disposes controllers in reverse registration order', async () => {
    const order: string[] = [];
    const manager = new LifecycleManager();

    const first: Controller = {
      init: () => {},
      dispose: () => {
        order.push('first-dispose');
      },
    };
    const second: Controller = {
      init: () => {},
      dispose: () => {
        order.push('second-dispose');
      },
    };
    const third: Controller = {
      init: () => {},
      dispose: () => {
        order.push('third-dispose');
      },
    };

    await manager.registerAndInit('first', first);
    await manager.registerAndInit('second', second);
    await manager.registerAndInit('third', third);

    manager.dispose();

    expect(order).toEqual(['third-dispose', 'second-dispose', 'first-dispose']);
  });

  it('disposes already-initialized controllers when a later init fails', async () => {
    const disposed: string[] = [];
    const manager = new LifecycleManager();

    const first: Controller = {
      init: () => {},
      dispose: () => {
        disposed.push('first');
      },
    };
    const second: Controller = {
      init: () => {},
      dispose: () => {
        disposed.push('second');
      },
    };
    const failing: Controller = {
      init: () => {
        throw new Error('init failed');
      },
      dispose: () => {
        disposed.push('failing');
      },
    };

    await manager.registerAndInit('first', first);
    await manager.registerAndInit('second', second);

    await expect(manager.registerAndInit('failing', failing)).rejects.toThrow('init failed');

    expect(disposed).toEqual(['second', 'first']);
    expect(manager.count).toBe(0);
  });

  it('handles async init', async () => {
    const order: string[] = [];
    const manager = new LifecycleManager();

    const asyncController: Controller = {
      async init() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('async-init');
      },
      dispose: () => {
        order.push('async-dispose');
      },
    };

    await manager.registerAndInit('async', asyncController);
    expect(order).toEqual(['async-init']);

    manager.dispose();
    expect(order).toEqual(['async-init', 'async-dispose']);
  });

  it('disposes already-initialized controllers when async init fails', async () => {
    const disposed: string[] = [];
    const manager = new LifecycleManager();

    const first: Controller = {
      init: () => {},
      dispose: () => {
        disposed.push('first');
      },
    };
    const failing: Controller = {
      async init() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('async init failed');
      },
      dispose: () => {
        disposed.push('failing');
      },
    };

    await manager.registerAndInit('first', first);
    await expect(manager.registerAndInit('failing', failing)).rejects.toThrow('async init failed');

    expect(disposed).toEqual(['first']);
    expect(manager.count).toBe(0);
  });

  it('tolerates dispose failures without blocking other cleanups', async () => {
    const disposed: string[] = [];
    const manager = new LifecycleManager();

    const throwing: Controller = {
      init: () => {},
      dispose: () => {
        throw new Error('dispose error');
      },
    };
    const normal: Controller = {
      init: () => {},
      dispose: () => {
        disposed.push('normal');
      },
    };

    await manager.registerAndInit('throwing', throwing);
    await manager.registerAndInit('normal', normal);

    manager.dispose();

    expect(disposed).toEqual(['normal']);
  });

  it('is idempotent on multiple dispose calls', async () => {
    const disposeCount = vi.fn();
    const manager = new LifecycleManager();

    const controller: Controller = {
      init: () => {},
      dispose: disposeCount,
    };

    await manager.registerAndInit('ctrl', controller);
    manager.dispose();
    manager.dispose();
    manager.dispose();

    expect(disposeCount).toHaveBeenCalledTimes(1);
  });

  it('tracks the number of initialized controllers', async () => {
    const manager = new LifecycleManager();

    expect(manager.count).toBe(0);

    const noop: Controller = { init: () => {}, dispose: () => {} };
    await manager.registerAndInit('a', noop);
    expect(manager.count).toBe(1);

    await manager.registerAndInit('b', noop);
    expect(manager.count).toBe(2);

    manager.dispose();
    expect(manager.count).toBe(0);
  });
});
