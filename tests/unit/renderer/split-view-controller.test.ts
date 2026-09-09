// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { SplitViewController } from '../../../src/renderer/editor/split-view-controller.js';

describe('SplitViewController', () => {
  it('normalizes the divider ratio and removes temporary pointer listeners', () => {
    const host = document.createElement('section');
    const content = document.createElement('div');
    const preview = document.createElement('div');
    content.append(preview);
    host.append(content);
    const tab = { host, splitResizer: null as HTMLElement | null };
    let ratio = 50;
    const persistRatio = vi.fn();
    const controller = new SplitViewController({
      getContent: () => content,
      getSource: () => null,
      ensureResizer: () => {
        let resizer = content.querySelector<HTMLElement>('.sv-split-resizer');
        if (!resizer) {
          resizer = document.createElement('div');
          resizer.className = 'sv-split-resizer hidden';
          content.insertBefore(resizer, preview);
        }
        return resizer;
      },
      getVisibility: () => ({ sourceVisible: true, previewVisible: true }),
      getRatio: () => ratio,
      setRatio: (next) => {
        ratio = next;
      },
      persistRatio,
      onLayoutChanged: () => {},
      refreshLineNumbers: () => {},
      canScheduleLineNumbers: () => true,
      shouldDeferLineNumberResize: () => false,
      syncScroll: () => {},
      installScrollEnhancement: () => null,
      installAutoIndent: () => null,
      captureIndentSelection: () => null,
      applyIndent: () => false,
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 200 }),
    });

    controller.attach(tab);
    tab.splitResizer!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 101 }));
    expect(ratio).toBe(50);
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(persistRatio).toHaveBeenCalledTimes(1);
    controller.dispose(tab);
    expect(tab.splitResizer).toBeNull();
  });

  it('applies semantic SV pane visibility without retaining a replaced divider listener', () => {
    const host = document.createElement('section');
    const content = document.createElement('div');
    host.append(content);
    const tab = { host, splitResizer: null as HTMLElement | null };
    let resizer = document.createElement('div');
    resizer.className = 'sv-split-resizer';
    content.append(resizer);
    const controller = new SplitViewController({
      getContent: () => content,
      getSource: () => null,
      ensureResizer: () => resizer,
      getVisibility: (_tab, mode) =>
        mode === 'sv' ? { sourceVisible: true, previewVisible: false } : null,
      getRatio: () => 50,
      setRatio: () => {},
      persistRatio: () => {},
      onLayoutChanged: () => {},
      refreshLineNumbers: () => {},
      canScheduleLineNumbers: () => true,
      shouldDeferLineNumberResize: () => false,
      syncScroll: () => {},
      installScrollEnhancement: () => null,
      installAutoIndent: () => null,
      captureIndentSelection: () => null,
      applyIndent: () => false,
    });

    controller.attach(tab);
    controller.syncLayout(tab, 'sv');
    expect(host.classList.contains('sv-editor-only')).toBe(true);
    expect(resizer.classList.contains('hidden')).toBe(true);

    const replacedResizer = document.createElement('div');
    replacedResizer.className = 'sv-split-resizer';
    resizer.replaceWith(replacedResizer);
    resizer = replacedResizer;
    controller.attach(tab);
    controller.dispose(tab);
    replacedResizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(replacedResizer.classList.contains('dragging')).toBe(false);
  });

  it('cancels a scheduled line-number refresh when the tab runtime is disposed', () => {
    const host = document.createElement('section');
    const tab = { host, splitResizer: null as HTMLElement | null };
    const source = document.createElement('div');
    const refreshLineNumbers = vi.fn();
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queuedFrames.delete(id));
    const controller = new SplitViewController({
      getContent: () => null,
      getSource: () => source,
      ensureResizer: () => null,
      getVisibility: () => null,
      getRatio: () => 50,
      setRatio: () => {},
      persistRatio: () => {},
      onLayoutChanged: () => {},
      refreshLineNumbers,
      canScheduleLineNumbers: () => true,
      shouldDeferLineNumberResize: () => false,
      syncScroll: () => {},
      installScrollEnhancement: () => null,
      installAutoIndent: () => null,
      captureIndentSelection: () => null,
      applyIndent: () => false,
    });

    controller.scheduleLineNumbers(tab);
    controller.dispose(tab);
    queuedFrames.forEach((callback) => callback(0));
    expect(refreshLineNumbers).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('ignores a late refresh after disposal and permits the same tab after rebuild', () => {
    const host = document.createElement('section');
    const source = document.createElement('div');
    const tab = { host, splitResizer: null as HTMLElement | null };
    const refreshLineNumbers = vi.fn();
    const addEventListener = vi.spyOn(source, 'addEventListener');
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    let canSchedule = true;
    let runtimeGeneration = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queuedFrames.delete(id));
    const controller = new SplitViewController({
      getContent: () => null,
      getSource: () => source,
      ensureResizer: () => null,
      getVisibility: () => null,
      getRatio: () => 50,
      setRatio: () => {},
      persistRatio: () => {},
      onLayoutChanged: () => {},
      refreshLineNumbers,
      canScheduleLineNumbers: (_tab, generation) =>
        canSchedule && (generation === undefined || generation === runtimeGeneration),
      shouldDeferLineNumberResize: () => false,
      syncScroll: () => {},
      installScrollEnhancement: () => null,
      installAutoIndent: () => null,
      captureIndentSelection: () => null,
      applyIndent: () => false,
    });
    const flushFrames = () => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      callbacks.forEach((callback) => callback(0));
    };

    try {
      controller.scheduleLineNumbers(tab);
      flushFrames();
      expect(refreshLineNumbers).toHaveBeenCalledTimes(1);
      expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));

      controller.dispose(tab);
      canSchedule = false;
      runtimeGeneration = 2;
      refreshLineNumbers.mockClear();
      addEventListener.mockClear();
      controller.scheduleLineNumbers(tab, 1);
      expect(queuedFrames).toHaveLength(0);
      expect(refreshLineNumbers).not.toHaveBeenCalled();
      expect(addEventListener).not.toHaveBeenCalled();

      canSchedule = true;
      controller.scheduleLineNumbers(tab, 2);
      expect(queuedFrames).toHaveLength(1);
      flushFrames();
      expect(refreshLineNumbers).toHaveBeenCalledTimes(1);
      expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    } finally {
      controller.dispose(tab);
      addEventListener.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('defers expensive split decoration refreshes until source scrolling stops', () => {
    const host = document.createElement('section');
    const source = document.createElement('div');
    const tab = { host, splitResizer: null as HTMLElement | null };
    const refreshLineNumbers = vi.fn();
    const syncScroll = vi.fn();
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queuedFrames.delete(id));
    const controller = new SplitViewController({
      getContent: () => null,
      getSource: () => source,
      ensureResizer: () => null,
      getVisibility: () => null,
      getRatio: () => 50,
      setRatio: () => {},
      persistRatio: () => {},
      onLayoutChanged: () => {},
      refreshLineNumbers,
      canScheduleLineNumbers: () => true,
      shouldDeferLineNumberResize: () => false,
      syncScroll,
      installScrollEnhancement: () => null,
      installAutoIndent: () => null,
      captureIndentSelection: () => null,
      applyIndent: () => false,
    });
    const flushFrames = () => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      callbacks.forEach((callback) => callback(0));
    };

    try {
      controller.scheduleLineNumbers(tab);
      flushFrames();
      expect(refreshLineNumbers).toHaveBeenCalledTimes(1);

      source.dispatchEvent(new Event('scroll'));
      expect(syncScroll).toHaveBeenCalledTimes(1);
      expect(refreshLineNumbers).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(79);
      expect(refreshLineNumbers).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      flushFrames();
      expect(refreshLineNumbers).toHaveBeenCalledTimes(2);
    } finally {
      controller.dispose(tab);
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('replaces line-number observers and disconnects the active observer on disposal', () => {
    const host = document.createElement('section');
    const source = document.createElement('div');
    const tab = { host, splitResizer: null as HTMLElement | null };
    const observers: { disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> }[] =
      [];
    class TestMutationObserver {
      readonly disconnect = vi.fn();
      readonly observe = vi.fn();

      constructor(_callback: MutationCallback) {
        observers.push(this);
      }
    }
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    vi.stubGlobal('ResizeObserver', undefined);
    const controller = new SplitViewController({
      getContent: () => null,
      getSource: () => source,
      ensureResizer: () => null,
      getVisibility: () => null,
      getRatio: () => 50,
      setRatio: () => {},
      persistRatio: () => {},
      onLayoutChanged: () => {},
      refreshLineNumbers: () => {},
      canScheduleLineNumbers: () => true,
      shouldDeferLineNumberResize: () => false,
      syncScroll: () => {},
      installScrollEnhancement: () => null,
      installAutoIndent: () => null,
      captureIndentSelection: () => null,
      applyIndent: () => false,
    });

    controller.observeLineNumbers(tab);
    controller.observeLineNumbers(tab);
    expect(observers).toHaveLength(2);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    controller.dispose(tab);
    expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('owns auto-indent installation and the stored list selection lifecycle', () => {
    const host = document.createElement('section');
    const tab = { host, splitResizer: null as HTMLElement | null };
    const range = document.createRange();
    const autoIndentCleanup = vi.fn();
    const scrollEnhancementCleanup = vi.fn();
    const installScrollEnhancement = vi.fn(() => scrollEnhancementCleanup);
    const installAutoIndent = vi.fn(() => autoIndentCleanup);
    const applyIndent = vi.fn(() => true);
    const controller = new SplitViewController({
      getContent: () => null,
      getSource: () => null,
      ensureResizer: () => null,
      getVisibility: () => null,
      getRatio: () => 50,
      setRatio: () => {},
      persistRatio: () => {},
      onLayoutChanged: () => {},
      refreshLineNumbers: () => {},
      canScheduleLineNumbers: () => true,
      shouldDeferLineNumberResize: () => false,
      syncScroll: () => {},
      installScrollEnhancement,
      installAutoIndent,
      captureIndentSelection: () => range,
      applyIndent,
    });

    controller.activate(tab);
    controller.activate(tab);
    controller.preserveIndentSelection(tab);
    expect(controller.applyToolbarIndent(tab, 'indent')).toBe(true);
    expect(applyIndent).toHaveBeenCalledWith(tab, 'indent', range);
    expect(installAutoIndent).toHaveBeenCalledTimes(1);
    expect(installScrollEnhancement).toHaveBeenCalledTimes(1);
    controller.dispose(tab);
    expect(autoIndentCleanup).toHaveBeenCalledTimes(1);
    expect(scrollEnhancementCleanup).toHaveBeenCalledTimes(1);
  });
});
