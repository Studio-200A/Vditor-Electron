// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { FindController } from '../../../src/renderer/editor/find-controller.js';

describe('FindController', () => {
  it('owns keyboard navigation and clears highlights on disposal', () => {
    const widget = document.createElement('section');
    widget.classList.add('hidden');
    const input = document.createElement('input');
    const replaceInput = document.createElement('input');
    const replaceRow = document.createElement('div');
    replaceRow.classList.add('hidden');
    const toggleReplace = document.createElement('button');
    const count = document.createElement('span');
    widget.append(input, replaceInput);
    document.body.append(widget);
    const revealTextMatch = vi.fn();
    const clearFindHighlights = vi.fn();
    const controller = new FindController({
      widget,
      input,
      replaceInput,
      replaceRow,
      toggleReplace,
      count,
      getActiveRuntime: () => ({
        id: 'tab',
        content: 'alpha beta alpha',
        host: document.createElement('section'),
        mode: 'ir',
        focus: () => {},
      }),
      adapter: {
        revealTextMatch,
        selectTextMatch: () => true,
        replaceTextMatch: () => true,
        clearFindHighlights,
      },
      onSave: () => {},
    });

    controller.init();
    controller.open();
    input.value = 'alpha';
    input.dispatchEvent(new Event('input'));
    expect(count.textContent).toBe('1 / 2');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true }));
    expect(count.textContent).toBe('2 / 2');
    expect(revealTextMatch).toHaveBeenCalled();
    controller.dispose();
    expect(clearFindHighlights).toHaveBeenCalled();
  });
});
