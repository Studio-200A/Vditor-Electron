import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabController, type TabViewModel } from '../../../src/renderer/documents/tab-controller';

const tabs: TabViewModel[] = [
  { id: 'one', title: 'One', filePath: '/notes/one.md', modified: false, needsAttention: false },
  { id: 'two', title: 'Two', filePath: null, modified: true, needsAttention: true },
];

describe('TabController', () => {
  let document: Document;
  let controller: TabController;
  let activate: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let move: ReturnType<typeof vi.fn>;
  let onResize: ResizeObserverCallback;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dom = new JSDOM(
      '<!doctype html><body><div id="tabBar"><div id="tabStrip"></div><button id="addTab"></button></div></body>',
    );
    document = dom.window.document;
    vi.stubGlobal('document', document);
    vi.stubGlobal('Element', dom.window.Element);
    disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          onResize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('setTimeout', (callback: () => void) => {
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    vi.stubGlobal('clearTimeout', () => {});
    (dom.window.HTMLElement.prototype as HTMLElement).scrollIntoView = vi.fn();
    activate = vi.fn();
    close = vi.fn();
    move = vi.fn();
    controller = new TabController({
      tabBar: document.getElementById('tabBar') as HTMLElement,
      tabStrip: document.getElementById('tabStrip') as HTMLElement,
      getAttentionTitle: (tab) => `Attention: ${tab.title}`,
      getCloseTitle: () => 'Close tab',
      callbacks: { activate, close, move },
    });
  });

  afterEach(() => {
    controller.dispose();
    vi.unstubAllGlobals();
  });

  it('renders title, dirty marker, attention indicator, and active state from a view model', () => {
    controller.render(tabs, 'two');

    const buttons = document.querySelectorAll<HTMLButtonElement>('.document-tab');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.dataset.tooltip).toBe('/notes/one.md');
    expect(buttons[0]?.hasAttribute('title')).toBe(false);
    expect(buttons[1]?.classList.contains('active')).toBe(true);
    expect(buttons[1]?.querySelector('.dirty')?.textContent).toBe('●');
    expect(buttons[1]?.querySelector('.conflict')?.title).toBe('Attention: Two');
    expect(buttons[1]?.querySelector('b')?.title).toBe('Close tab');
  });

  it('routes primary, close, and middle clicks to its UI callbacks', () => {
    controller.render(tabs, 'one');
    const first = document.querySelector<HTMLButtonElement>('.document-tab[data-id="one"]');
    const second = document.querySelector<HTMLButtonElement>('.document-tab[data-id="two"]');

    first?.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
    second
      ?.querySelector('b')
      ?.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true }));
    second?.dispatchEvent(
      new document.defaultView!.MouseEvent('auxclick', { bubbles: true, button: 1 }),
    );

    expect(activate).toHaveBeenCalledWith('one');
    expect(close).toHaveBeenCalledWith('two');
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('replaces old tab DOM instead of accumulating event-owning controls', () => {
    controller.render(tabs, 'one');
    controller.render([tabs[1]], 'two');

    expect(document.querySelectorAll('.document-tab')).toHaveLength(1);
    expect(document.querySelector('.document-tab')?.getAttribute('data-id')).toBe('two');
  });

  it('cancels its pending drag reset when disposed', () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
    const internals = controller as unknown as {
      draggedTabId: string | null;
      dragPointerId: number | null;
      finishDrag(event: PointerEvent): void;
    };
    internals.draggedTabId = 'one';
    internals.dragPointerId = 1;
    document.elementFromPoint = () => null;

    internals.finishDrag({ clientX: 0, clientY: 0, pointerId: 1 } as PointerEvent);
    controller.dispose();

    expect(clearTimeout).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows shadows only on sides with hidden tabs and updates after resizing', () => {
    const strip = document.getElementById('tabStrip')!;
    const bar = document.getElementById('tabBar')!;
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 600 });
    controller.render(tabs, 'one');
    expect(bar.classList.contains('has-tabs-before')).toBe(false);
    expect(bar.classList.contains('has-tabs-after')).toBe(true);
    strip.scrollLeft = 200;
    strip.dispatchEvent(new document.defaultView!.Event('scroll'));
    expect(bar.classList.contains('has-tabs-before')).toBe(true);
    expect(bar.classList.contains('has-tabs-after')).toBe(true);
    strip.scrollLeft = 400;
    strip.dispatchEvent(new document.defaultView!.Event('scroll'));
    expect(bar.classList.contains('has-tabs-after')).toBe(false);
    strip.scrollLeft = 0;
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 600 });
    onResize([], {} as ResizeObserver);
    expect(bar.classList.contains('has-tabs-before')).toBe(false);
    expect(bar.classList.contains('has-tabs-after')).toBe(false);
  });

  it('scrolls only the tab strip with the wheel and releases listeners on disposal', () => {
    const strip = document.getElementById('tabStrip')!;
    const bar = document.getElementById('tabBar')!;
    Object.defineProperty(strip, 'clientWidth', { value: 200 });
    Object.defineProperty(strip, 'scrollWidth', { value: 600 });
    const wheel = () =>
      new document.defaultView!.WheelEvent('wheel', { deltaY: 80, cancelable: true });
    const event = wheel();
    bar.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(80);
    expect(bar.scrollLeft).toBe(0);
    controller.dispose();
    bar.dispatchEvent(wheel());
    expect(strip.scrollLeft).toBe(80);
    expect(disconnect).toHaveBeenCalled();
  });
});
