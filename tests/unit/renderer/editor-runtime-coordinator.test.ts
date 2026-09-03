// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorRuntimeCoordinator } from '../../../src/renderer/editor/editor-runtime-coordinator.js';

interface TestTab {
  id: string;
  host: HTMLElement;
  toolbar: HTMLElement | null;
}

describe('EditorRuntimeCoordinator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coordinates editor UI in activation order and marks only the selected host active', () => {
    const first: TestTab = {
      id: 'first',
      host: document.createElement('section'),
      toolbar: document.createElement('div'),
    };
    const second: TestTab = {
      id: 'second',
      host: document.createElement('section'),
      toolbar: document.createElement('div'),
    };
    let activeId = first.id;
    const calls: string[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const coordinator = new EditorRuntimeCoordinator({
      getTab: (id) => [first, second].find((tab) => tab.id === id) ?? null,
      getTabs: () => [first, second],
      getActiveTab: () => [first, second].find((tab) => tab.id === activeId) ?? null,
      getActiveDocumentId: () => activeId,
      closeContextMenu: () => calls.push('close'),
      restoreToolbar: (tab) => calls.push(`restore:${tab?.id}`),
      activateDocument: (id) => {
        activeId = id;
        calls.push(`activate:${id}`);
      },
      syncToolbarAvailability: () => calls.push('availability'),
      ensureEditor: (tab) => calls.push(`ensure:${tab.id}`),
      updateBottomSpacer: (tab) => calls.push(`spacer:${tab.id}`),
      scrollToPendingAnchor: (tab) => calls.push(`anchor:${tab.id}`),
      mountToolbar: (tab) => calls.push(`toolbar:${tab.id}`),
      scheduleSplitLineNumbers: (tab) => calls.push(`lines:${tab.id}`),
      renderTabs: () => calls.push('tabs'),
      updateActiveUI: () => calls.push('ui'),
      onOutlineRuntimeChanged: () => calls.push('outline'),
      onFindRuntimeChanged: () => calls.push('find'),
      persistSession: () => calls.push('persist'),
    });

    expect(coordinator.activate(second.id)).toBe(true);
    expect(calls).toEqual([
      'close',
      'restore:first',
      'activate:second',
      'availability',
      'ensure:second',
      'spacer:second',
      'anchor:second',
      'toolbar:second',
      'lines:second',
      'tabs',
      'ui',
      'outline',
      'find',
      'persist',
    ]);
    expect(first.host.classList.contains('active')).toBe(false);
    expect(second.host.classList.contains('active')).toBe(true);
  });

  it('skips stale animation-frame work after a newer activation', () => {
    const first: TestTab = { id: 'first', host: document.createElement('section'), toolbar: null };
    const second: TestTab = {
      id: 'second',
      host: document.createElement('section'),
      toolbar: null,
    };
    let activeId = first.id;
    const frames: FrameRequestCallback[] = [];
    const updateBottomSpacer = vi.fn();
    const scrollToPendingAnchor = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const coordinator = new EditorRuntimeCoordinator({
      getTab: (id) => [first, second].find((tab) => tab.id === id) ?? null,
      getTabs: () => [first, second],
      getActiveTab: () => [first, second].find((tab) => tab.id === activeId) ?? null,
      getActiveDocumentId: () => activeId,
      closeContextMenu: () => {},
      restoreToolbar: () => {},
      activateDocument: (id) => {
        activeId = id;
      },
      syncToolbarAvailability: () => {},
      ensureEditor: () => {},
      updateBottomSpacer,
      scrollToPendingAnchor,
      mountToolbar: () => {},
      scheduleSplitLineNumbers: () => {},
      renderTabs: () => {},
      updateActiveUI: () => {},
      onOutlineRuntimeChanged: () => {},
      onFindRuntimeChanged: () => {},
      persistSession: () => {},
    });

    coordinator.activate(first.id);
    coordinator.activate(second.id);
    frames.forEach((frame) => frame(0));

    expect(updateBottomSpacer).toHaveBeenCalledTimes(1);
    expect(updateBottomSpacer).toHaveBeenCalledWith(second);
    expect(scrollToPendingAnchor).toHaveBeenCalledTimes(1);
    expect(scrollToPendingAnchor).toHaveBeenCalledWith(second);
  });
});
