import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsWindow } from '../../../src/renderer/settings/settings-window';

describe('SettingsWindow', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body><div id="modal" class="hidden"></div></body>');
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '0' }));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses one close timer and applies presentation only when requested', async () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    const controller = new SettingsWindow({
      modal: dom.window.document.getElementById('modal') as HTMLElement,
      onClosed,
    });

    const modal = dom.window.document.getElementById('modal') as HTMLElement;
    modal.classList.remove('hidden');
    modal.classList.add('modal-open');
    const closing = controller.close(false);
    await vi.advanceTimersByTimeAsync(30);
    await closing;

    expect(onClosed).toHaveBeenCalledWith(false);
    expect(dom.window.document.getElementById('modal')?.classList.contains('hidden')).toBe(true);
    controller.dispose();
    vi.useRealTimers();
  });
});
