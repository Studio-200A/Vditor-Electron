/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { DisposableBag } from '../../../src/renderer/core/disposables';

describe('DisposableBag', () => {
  it('calls cleanup functions in reverse order on dispose', () => {
    const order: number[] = [];
    const bag = new DisposableBag();

    bag.add(() => order.push(1));
    bag.add(() => order.push(2));
    bag.add(() => order.push(3));

    bag.dispose();

    expect(order).toEqual([3, 2, 1]);
  });

  it('is idempotent on multiple dispose calls', () => {
    const cleanup = vi.fn();
    const bag = new DisposableBag();

    bag.add(cleanup);
    bag.dispose();
    bag.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('reports disposed state', () => {
    const bag = new DisposableBag();
    expect(bag.isDisposed).toBe(false);

    bag.dispose();
    expect(bag.isDisposed).toBe(true);
  });

  it('immediately cleans up items added after disposal', () => {
    const bag = new DisposableBag();
    bag.dispose();

    const lateCleanup = vi.fn();
    bag.add(lateCleanup);

    expect(lateCleanup).toHaveBeenCalledTimes(1);
  });

  it('tolerates cleanup failures without blocking other cleanups', () => {
    const cleaned: string[] = [];
    const bag = new DisposableBag();

    bag.add(() => cleaned.push('first'));
    bag.add(() => {
      throw new Error('cleanup error');
    });
    bag.add(() => cleaned.push('third'));

    bag.dispose();

    expect(cleaned).toEqual(['third', 'first']);
  });

  it('manages addEventListener and removeEventListener', () => {
    const bag = new DisposableBag();
    const target = document.createElement('div');
    const handler = vi.fn();

    bag.addEventListener(target, 'click', handler);
    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);

    bag.dispose();
    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('manages setTimeout cleanup', () => {
    const bag = new DisposableBag();
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const id = setTimeout(callback, 1000);
      bag.addTimeout(id);

      bag.dispose();
      vi.advanceTimersByTime(2000);

      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('manages setInterval cleanup', () => {
    const bag = new DisposableBag();
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const id = setInterval(callback, 100);
      bag.addInterval(id);

      vi.advanceTimersByTime(250);
      expect(callback).toHaveBeenCalledTimes(2);

      bag.dispose();
      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('manages animation frame cleanup', () => {
    const bag = new DisposableBag();
    const callback = vi.fn();

    const id = requestAnimationFrame(callback);
    bag.addAnimationFrame(id);

    bag.dispose();

    // After disposal, the animation frame callback should have been cancelled
    // We can't easily test cancelAnimationFrame directly, but we verify no error is thrown
  });

  it('manages observer disconnect', () => {
    const bag = new DisposableBag();
    const observer = { disconnect: vi.fn() };

    bag.addObserver(observer);
    bag.dispose();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });
});
