// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorController } from '../../../src/renderer/editor/editor-controller.js';
import type { Vditor } from '../../../src/renderer/state/types.js';

interface TestTab {
  id: string;
  host: HTMLElement;
  mode: 'ir' | 'wysiwyg' | 'sv';
  vditor: Vditor | null;
  ready: boolean;
  toolbar: HTMLElement | null;
  pendingScroll: null;
  content: string;
  savedContent: string;
  modified: boolean;
  contentRevision: number;
  pendingEditorContent: boolean;
  editorRuntimeGeneration?: number;
}

describe('EditorController', () => {
  let currentMode: 'ir' | 'wysiwyg' | 'sv';
  let destroyed: ReturnType<typeof vi.fn>;
  let setValue: ReturnType<typeof vi.fn>;
  let controller: EditorController<TestTab>;
  let tab: TestTab;

  beforeEach(() => {
    currentMode = 'ir';
    destroyed = vi.fn();
    setValue = vi.fn();
    class FakeVditor {
      constructor(_host: HTMLElement, options: { after?: () => void }) {
        queueMicrotask(() => options.after?.());
      }
      destroy(): void {
        destroyed();
      }
      setValue(content: string, clearStack: boolean): void {
        setValue(content, clearStack);
      }
      getCurrentMode(): 'ir' | 'wysiwyg' | 'sv' {
        return currentMode;
      }
    }
    Object.assign(globalThis, { Vditor: FakeVditor });
    tab = {
      id: 'one',
      host: document.createElement('section'),
      mode: 'ir',
      vditor: null,
      ready: false,
      toolbar: null,
      pendingScroll: null,
      content: 'saved pending content',
      savedContent: 'saved pending content',
      modified: false,
      contentRevision: 0,
      pendingEditorContent: false,
    };
    controller = new EditorController({
      adapter: { editorScrollContainer: () => null },
      createOptions: () => ({}),
      getActiveDocumentId: () => 'one',
      onAvailabilityChanged: () => {},
      onBeforeDestroy: () => {},
      onCreationFailure: () => {},
      onModeChanged: () => {},
      readContent: () => '',
    });
  });

  it('invalidates a late callback after a rebuild', () => {
    expect(controller.ensure(tab)).toBe(true);
    const firstGeneration = tab.editorRuntimeGeneration!;
    controller.rebuild(tab);

    expect(controller.isCurrent(tab, firstGeneration)).toBe(false);
    expect(tab.editorRuntimeGeneration).toBeGreaterThan(firstGeneration);
  });

  it('destroys a runtime once and clears its ownership', () => {
    controller.ensure(tab);
    controller.destroy(tab);
    controller.destroy(tab);

    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(tab.vditor).toBeNull();
    expect(tab.toolbar).toBeNull();
    expect(tab.ready).toBe(false);
  });

  it('reports a destruction failure after clearing runtime ownership', () => {
    controller.ensure(tab);
    destroyed.mockImplementationOnce(() => {
      throw new Error('destroy failed');
    });

    expect(controller.destroy(tab)).toEqual(new Error('destroy failed'));
    expect(tab.vditor).toBeNull();
    expect(tab.toolbar).toBeNull();
    expect(tab.ready).toBe(false);
  });

  it('synchronizes the mode from the current runtime only', () => {
    const onModeChanged = vi.fn();
    controller = new EditorController({
      adapter: { editorScrollContainer: () => null },
      createOptions: () => ({}),
      getActiveDocumentId: () => 'one',
      onAvailabilityChanged: () => {},
      onBeforeDestroy: () => {},
      onCreationFailure: () => {},
      onModeChanged,
      readContent: () => '',
    });
    controller.ensure(tab);
    currentMode = 'sv';
    controller.synchronizeMode(tab);

    expect(tab.mode).toBe('sv');
    expect(onModeChanged).toHaveBeenCalledWith(tab);
  });

  it('owns one auto-save timer per tab and cancels it on destruction', () => {
    vi.useFakeTimers();
    const firstSave = vi.fn();
    const secondSave = vi.fn();

    controller.scheduleAutoSave(tab, 100, firstSave);
    controller.scheduleAutoSave(tab, 100, secondSave);
    vi.advanceTimersByTime(100);
    expect(firstSave).not.toHaveBeenCalled();
    expect(secondSave).toHaveBeenCalledTimes(1);

    controller.scheduleAutoSave(tab, 100, firstSave);
    controller.destroy(tab);
    vi.advanceTimersByTime(100);
    expect(firstSave).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('injects recovery content while Vditor is initialized but not ready', () => {
    controller.ensure(tab);
    expect(tab.ready).toBe(false);

    expect(controller.injectContent(tab, 'recovered', true)).toBe(true);
    expect(setValue).toHaveBeenCalledWith('recovered', true);
  });

  it('uses pending content for persistence until the editor has received it', () => {
    tab.pendingEditorContent = true;
    expect(controller.contentForPersistence(tab)).toBe('saved pending content');
  });

  it('updates editor-owned input state without retaining pending recovery content', () => {
    tab.pendingEditorContent = true;
    expect(controller.applyInput(tab, 'changed')).toBe(true);
    expect(tab).toMatchObject({
      content: 'changed',
      modified: true,
      contentRevision: 1,
      pendingEditorContent: false,
    });
  });
});
