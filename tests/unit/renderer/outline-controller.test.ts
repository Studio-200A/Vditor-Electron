// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { OutlineController } from '../../../src/renderer/editor/outline-controller.js';

describe('OutlineController', () => {
  it('renders nested headings with textContent and preserves collapse state', () => {
    const view = document.createElement('section');
    view.classList.add('active');
    const tree = document.createElement('div');
    const tab = {
      host: document.createElement('section'),
      mode: 'ir',
      outlineCollapsed: new Set<string>(),
    };
    const scrollToHeading = vi.fn();
    const controller = new OutlineController({
      view,
      tree,
      getActiveTab: () => tab,
      getSnapshot: () => [
        { level: 1, key: 'top', text: '<Top>' },
        { level: 2, key: 'child', text: 'Child' },
      ],
      scrollToHeading,
      translate: (key) => key,
    });

    controller.render();

    expect(tree.querySelector('.outline-item')?.textContent).toBe('<Top>');
    expect(tree.querySelector('.outline-item')?.innerHTML).toBe('&lt;Top&gt;');
    const toggle = tree.querySelector<HTMLButtonElement>('.outline-toggle')!;
    toggle.click();
    expect(tab.outlineCollapsed).toEqual(new Set(['top']));
    tree.querySelectorAll<HTMLButtonElement>('.outline-item')[1].click();
    expect(scrollToHeading).toHaveBeenCalledWith(tab, 1);
  });

  it('cancels a deferred refresh on dispose', () => {
    vi.useFakeTimers();
    const view = document.createElement('section');
    view.classList.add('active');
    const tree = document.createElement('div');
    const controller = new OutlineController({
      view,
      tree,
      getActiveTab: () => null,
      getSnapshot: () => [],
      scrollToHeading: () => {},
      translate: (key) => key,
    });
    controller.schedule();
    controller.dispose();
    vi.runAllTimers();

    expect(tree.childElementCount).toBe(0);
    vi.useRealTimers();
  });

  it('cancels an old deferred refresh and renders the newly active runtime', () => {
    vi.useFakeTimers();
    const view = document.createElement('section');
    view.classList.add('active');
    const tree = document.createElement('div');
    const first = {
      host: document.createElement('section'),
      mode: 'ir',
      outlineCollapsed: new Set<string>(),
    };
    const second = {
      host: document.createElement('section'),
      mode: 'sv',
      outlineCollapsed: new Set<string>(),
    };
    let active = first;
    const getSnapshot = vi.fn((tab) => [
      { level: 1, key: tab.mode, text: tab.mode === 'ir' ? 'First' : 'Second' },
    ]);
    const controller = new OutlineController({
      view,
      tree,
      getActiveTab: () => active,
      getSnapshot,
      scrollToHeading: () => {},
      translate: (key) => key,
    });

    controller.schedule();
    active = second;
    controller.onRuntimeChanged();
    vi.runAllTimers();

    expect(tree.textContent).toBe('Second');
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
