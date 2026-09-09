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
  bottomSpacerObserver: ResizeObserver | null;
  editorRuntimeGeneration?: number;
}

describe('EditorController', () => {
  let currentMode: 'ir' | 'wysiwyg' | 'sv';
  let destroyed: ReturnType<typeof vi.fn>;
  let focused: ReturnType<typeof vi.fn>;
  let setValue: ReturnType<typeof vi.fn>;
  let readRuntimeContent: ReturnType<typeof vi.fn>;
  let editorContent: string;
  let setBottomSpacer: ReturnType<typeof vi.fn>;
  let observeOutlineChanges: ReturnType<typeof vi.fn>;
  let preserveTableScrollDuringInput: ReturnType<typeof vi.fn>;
  let installCustomCaret: ReturnType<typeof vi.fn>;
  let captureUndoHistory: ReturnType<typeof vi.fn>;
  let scheduleUndoHistoryRestore: ReturnType<typeof vi.fn>;
  let createRebuildSnapshot: ReturnType<typeof vi.fn>;
  let scrollContainers: ReturnType<typeof vi.fn>;
  let installScrollEnhancement: ReturnType<typeof vi.fn>;
  let updateDocument: ReturnType<typeof vi.fn>;
  let controller: EditorController<TestTab>;
  let tab: TestTab;

  beforeEach(() => {
    currentMode = 'ir';
    destroyed = vi.fn();
    focused = vi.fn();
    setValue = vi.fn();
    readRuntimeContent = vi.fn(() => editorContent);
    editorContent = '';
    setBottomSpacer = vi.fn();
    observeOutlineChanges = vi.fn(() => ({ disconnect: vi.fn() }));
    preserveTableScrollDuringInput = vi.fn(() => vi.fn());
    installCustomCaret = vi.fn(() => vi.fn());
    captureUndoHistory = vi.fn(() => null);
    scheduleUndoHistoryRestore = vi.fn(() => vi.fn());
    createRebuildSnapshot = vi.fn(() => vi.fn());
    scrollContainers = vi.fn(() => []);
    installScrollEnhancement = vi.fn(() => null);
    updateDocument = vi.fn((target: TestTab, updates: Partial<TestTab>) =>
      Object.assign(target, updates),
    );
    class FakeVditor {
      constructor(_host: HTMLElement, options: { after?: () => void }) {
        queueMicrotask(() => options.after?.());
      }
      destroy(): void {
        destroyed();
      }
      focus(): void {
        focused();
      }
      setValue(content: string, clearStack: boolean): void {
        editorContent = content;
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
      bottomSpacerObserver: null,
    };
    controller = new EditorController({
      adapter: {
        editorScrollContainer: () => null,
        createRebuildSnapshot,
        setBottomSpacer,
        observeOutlineChanges,
        preserveTableScrollDuringInput,
        installCustomCaret,
        captureUndoHistory,
        scheduleUndoHistoryRestore,
        scrollContainers,
        installScrollEnhancement,
      },
      createOptions: () => ({}),
      getActiveDocumentId: () => 'one',
      onAvailabilityChanged: () => {},
      onBeforeDestroy: () => {},
      onCreationFailure: () => {},
      onModeChanged: () => {},
      readContent: () => editorContent,
      readRuntimeContent,
      updateDocument,
    });
  });

  it('invalidates a late callback after a rebuild', () => {
    expect(controller.ensure(tab)).toBe(true);
    const firstGeneration = tab.editorRuntimeGeneration!;
    controller.rebuild(tab);

    expect(controller.isCurrent(tab, firstGeneration)).toBe(false);
    expect(tab.editorRuntimeGeneration).toBeGreaterThan(firstGeneration);
  });

  it('captures runtime content before destroying an editor for rebuild', () => {
    editorContent = 'latest runtime content';
    controller.ensure(tab);

    controller.rebuild(tab);

    expect(readRuntimeContent).toHaveBeenCalledWith(tab);
    expect(tab.content).toBe('latest runtime content');
  });

  it('keeps captured undo history through a replacement runtime until the adapter restores it', () => {
    const history = { undo: vi.fn() };
    const cancelRestore = vi.fn();
    captureUndoHistory.mockReturnValue(history);
    scheduleUndoHistoryRestore.mockReturnValue(cancelRestore);
    controller.ensure(tab);

    controller.rebuild(tab);
    controller.restoreRebuildUndoHistory(tab);

    expect(captureUndoHistory).toHaveBeenCalledTimes(1);
    expect(scheduleUndoHistoryRestore).toHaveBeenCalledWith(
      tab.vditor,
      history,
      expect.any(Function),
    );

    const onRestored = scheduleUndoHistoryRestore.mock.calls[0][2] as () => void;
    onRestored();
    controller.rebuild(tab);

    expect(captureUndoHistory).toHaveBeenCalledTimes(2);
    expect(cancelRestore).not.toHaveBeenCalled();
  });

  it('keeps an active editor snapshot until the rebuilt runtime releases it', () => {
    const releaseSnapshot = vi.fn();
    createRebuildSnapshot.mockReturnValue(releaseSnapshot);
    tab.host.classList.add('active');
    controller.ensure(tab);

    controller.rebuild(tab);
    expect(createRebuildSnapshot).toHaveBeenCalledWith(tab.host);
    expect(releaseSnapshot).not.toHaveBeenCalled();

    controller.releaseRebuildSnapshot(tab);
    expect(releaseSnapshot).toHaveBeenCalledOnce();
  });

  it('releases a rebuild snapshot immediately when no scroll restoration is pending', () => {
    const afterSettled = vi.fn();

    controller.restoreScroll(tab, vi.fn(), afterSettled);

    expect(afterSettled).toHaveBeenCalledOnce();
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

  it('clears a bottom-spacer observer when destroying the runtime', () => {
    const disconnect = vi.fn();
    tab.bottomSpacerObserver = { disconnect } as unknown as ResizeObserver;
    controller.ensure(tab);

    controller.destroy(tab);

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(tab.bottomSpacerObserver).toBeNull();
  });

  it('updates the bottom spacer when ResizeObserver is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: undefined });

    controller.observeBottomSpacer(tab);

    expect(setBottomSpacer).toHaveBeenCalledWith(tab.host, 0);
    if (descriptor) Object.defineProperty(globalThis, 'ResizeObserver', descriptor);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });

  it('replaces an outline observer and clears it when the runtime is destroyed', () => {
    const first = { disconnect: vi.fn() };
    const second = { disconnect: vi.fn() };
    observeOutlineChanges.mockReturnValueOnce(first).mockReturnValueOnce(second);

    controller.observeOutlineChanges(tab, vi.fn());
    controller.observeOutlineChanges(tab, vi.fn());
    controller.destroy(tab);

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(second.disconnect).toHaveBeenCalledTimes(1);
  });

  it('replaces table-scroll and scrollbar enhancements before releasing them on destroy', () => {
    const firstTableCleanup = vi.fn();
    const secondTableCleanup = vi.fn();
    const firstScrollCleanup = vi.fn();
    const secondScrollCleanup = vi.fn();
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    preserveTableScrollDuringInput
      .mockReturnValueOnce(firstTableCleanup)
      .mockReturnValueOnce(secondTableCleanup);
    scrollContainers.mockReturnValue([firstContainer, secondContainer]);
    installScrollEnhancement
      .mockReturnValueOnce(firstScrollCleanup)
      .mockReturnValueOnce(secondScrollCleanup);

    controller.preserveTableScrollDuringInput(tab);
    controller.preserveTableScrollDuringInput(tab);
    controller.installScrollEnhancements(tab, firstContainer);
    controller.destroy(tab);

    expect(firstTableCleanup).toHaveBeenCalledTimes(1);
    expect(secondTableCleanup).toHaveBeenCalledTimes(1);
    expect(firstScrollCleanup).toHaveBeenCalledTimes(1);
    expect(secondScrollCleanup).not.toHaveBeenCalled();
  });

  it('releases the custom caret when the editor runtime is destroyed', () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    installCustomCaret.mockReturnValueOnce(firstCleanup).mockReturnValueOnce(secondCleanup);

    controller.installCustomCaret(tab, () => 'bar');
    controller.installCustomCaret(tab, () => 'block');
    controller.destroy(tab);

    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).toHaveBeenCalledTimes(1);
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
      adapter: {
        editorScrollContainer: () => null,
        createRebuildSnapshot,
        setBottomSpacer,
        observeOutlineChanges,
        preserveTableScrollDuringInput,
        installCustomCaret,
        captureUndoHistory,
        scheduleUndoHistoryRestore,
        scrollContainers,
        installScrollEnhancement,
      },
      createOptions: () => ({}),
      getActiveDocumentId: () => 'one',
      onAvailabilityChanged: () => {},
      onBeforeDestroy: () => {},
      onCreationFailure: () => {},
      onModeChanged,
      readContent: () => '',
      readRuntimeContent: () => '',
    });
    controller.ensure(tab);
    currentMode = 'sv';
    controller.synchronizeMode(tab);

    expect(tab.mode).toBe('sv');
    expect(onModeChanged).toHaveBeenCalledWith(tab);
  });

  it('cancels a pending mode transition when the runtime is destroyed', () => {
    vi.useFakeTimers();
    const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame');
    controller.ensure(tab);
    tab.ready = true;

    expect(controller.prepareModeTransition(tab, 'sv', vi.fn())).toBe(true);
    controller.destroy(tab);
    vi.runAllTimers();

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('removes the custom caret before Vditor changes editing modes', () => {
    const cleanup = vi.fn();
    installCustomCaret.mockReturnValue(cleanup);
    controller.installCustomCaret(tab, () => 'bar');
    controller.ensure(tab);
    tab.ready = true;

    expect(controller.prepareModeTransition(tab, 'sv', vi.fn())).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('rejects delayed scroll restoration after the runtime generation changes', () => {
    vi.useFakeTimers();
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, {
      clientHeight: { value: 100 },
      clientWidth: { value: 100 },
      scrollHeight: { value: 200 },
      scrollWidth: { value: 200 },
    });
    controller = new EditorController({
      adapter: {
        editorScrollContainer: () => scroller,
        createRebuildSnapshot,
        setBottomSpacer,
        observeOutlineChanges,
        preserveTableScrollDuringInput,
        installCustomCaret,
        captureUndoHistory,
        scheduleUndoHistoryRestore,
        scrollContainers,
        installScrollEnhancement,
      },
      createOptions: () => ({}),
      getActiveDocumentId: () => 'one',
      onAvailabilityChanged: () => {},
      onBeforeDestroy: () => {},
      onCreationFailure: () => {},
      onModeChanged: () => {},
      readContent: () => editorContent,
      readRuntimeContent,
    });
    controller.ensure(tab);
    tab.pendingScroll = { mode: 'ir', scrollTop: 30, scrollLeft: 10, progress: 0.3 };
    const afterRestore = vi.fn();
    const afterSettled = vi.fn();

    controller.restoreScroll(tab, afterRestore, afterSettled);
    tab.editorRuntimeGeneration = (tab.editorRuntimeGeneration ?? 0) + 1;
    vi.runAllTimers();

    expect(afterRestore).toHaveBeenCalledTimes(1);
    expect(afterSettled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels delayed focus when the runtime is destroyed', () => {
    vi.useFakeTimers();
    controller.ensure(tab);
    controller.scheduleFocus(tab);
    controller.destroy(tab);
    vi.runAllTimers();

    expect(focused).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('focuses only the active tab after its delayed initialization work', () => {
    vi.useFakeTimers();
    controller.ensure(tab);
    controller.scheduleFocus(tab);
    vi.runAllTimers();

    expect(focused).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('keeps a mode shortcut listener across rebuilds and removes it on tab disposal', () => {
    const onKeyDown = vi.fn();
    controller.attachModeShortcut(tab, onKeyDown);
    controller.ensure(tab);

    controller.rebuild(tab);
    tab.host.dispatchEvent(new KeyboardEvent('keydown'));
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    controller.destroy(tab);
    tab.host.dispatchEvent(new KeyboardEvent('keydown'));
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('keeps document anchor navigation listeners across rebuilds and removes them on tab disposal', () => {
    const onClick = vi.fn();
    controller.attachDocumentAnchorNavigation(tab, {
      onMouseOver: vi.fn(),
      onMouseOut: vi.fn(),
      onMouseMove: vi.fn(),
      onClick,
    });
    controller.ensure(tab);

    controller.rebuild(tab);
    tab.host.dispatchEvent(new MouseEvent('click'));
    expect(onClick).toHaveBeenCalledTimes(1);

    controller.destroy(tab);
    tab.host.dispatchEvent(new MouseEvent('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the context-menu listener across rebuilds and removes it on tab disposal', () => {
    const onContextMenu = vi.fn();
    controller.attachContextMenu(tab, onContextMenu);
    controller.ensure(tab);

    controller.rebuild(tab);
    tab.host.dispatchEvent(new MouseEvent('contextmenu'));
    expect(onContextMenu).toHaveBeenCalledTimes(1);

    controller.destroy(tab);
    tab.host.dispatchEvent(new MouseEvent('contextmenu'));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('replaces toolbar handlers and removes them when the runtime is destroyed', () => {
    const firstToolbar = document.createElement('div');
    const secondToolbar = document.createElement('div');
    const firstClick = vi.fn();
    const secondClick = vi.fn();
    const onMouseDown = vi.fn();

    controller.attachToolbarHandlers(tab, firstToolbar, { onClick: firstClick, onMouseDown });
    controller.attachToolbarHandlers(tab, secondToolbar, { onClick: secondClick, onMouseDown });
    firstToolbar.dispatchEvent(new MouseEvent('click'));
    secondToolbar.dispatchEvent(new MouseEvent('click'));
    secondToolbar.dispatchEvent(new MouseEvent('mousedown'));

    expect(firstClick).not.toHaveBeenCalled();
    expect(secondClick).toHaveBeenCalledTimes(1);
    expect(onMouseDown).toHaveBeenCalledTimes(1);

    controller.destroy(tab);
    secondToolbar.dispatchEvent(new MouseEvent('click'));
    expect(secondClick).toHaveBeenCalledTimes(1);
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

  it('cancels pending auto-save before applying approved external content', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    controller.ensure(tab);
    controller.scheduleAutoSave(tab, 100, save);

    expect(controller.applyExternalContent(tab, 'disk content')).toBe(true);
    vi.advanceTimersByTime(100);

    expect(setValue).toHaveBeenCalledWith('disk content', true);
    expect(save).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps recovery content pending while Vditor is initialized but not ready', () => {
    controller.ensure(tab);
    expect(tab.ready).toBe(false);

    expect(controller.applyRecoveryContent(tab, 'recovered')).toBe(false);
    expect(setValue).not.toHaveBeenCalled();
    expect(tab).toMatchObject({ content: 'recovered', pendingEditorContent: true });
  });

  it('keeps recovery content pending until an editor runtime is available', () => {
    expect(controller.applyRecoveryContent(tab, 'recovered')).toBe(false);
    expect(tab.pendingEditorContent).toBe(true);

    controller.ensure(tab);
    expect(controller.applyPendingContent(tab)).toBe(true);

    expect(setValue).toHaveBeenCalledWith('recovered', true);
    expect(tab.pendingEditorContent).toBe(false);
  });

  it('uses pending content for persistence until the editor has received it', () => {
    tab.pendingEditorContent = true;
    expect(controller.contentForPersistence(tab)).toBe('saved pending content');
  });

  it('keeps pending recovery content authoritative before Vditor initialization completes', () => {
    tab.content = 'recovered';
    tab.pendingEditorContent = true;
    editorContent = 'constructor content';

    expect(controller.currentContent(tab)).toBe('recovered');
  });

  it('preserves a recovery baseline while reconciling initialized content', () => {
    tab.content = 'recovered';
    tab.savedContent = 'saved';
    tab.modified = true;
    tab.pendingEditorContent = true;
    controller.ensure(tab);

    controller.reconcileInitializedContent(tab, false);

    expect(setValue).toHaveBeenCalledWith('recovered', true);
    expect(tab).toMatchObject({
      content: 'recovered',
      savedContent: 'saved',
      modified: true,
      pendingEditorContent: false,
    });
    expect(updateDocument).toHaveBeenCalledWith(tab, {
      content: 'recovered',
      savedContent: 'saved',
      modified: true,
    });
  });

  it('keeps an already dirty tab dirty when initialization reports current content', () => {
    tab.content = 'draft';
    tab.savedContent = 'saved';
    tab.modified = true;
    editorContent = 'draft';

    controller.reconcileInitializedContent(tab, true);

    expect(tab).toMatchObject({ content: 'draft', savedContent: 'saved', modified: true });
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
    expect(updateDocument).toHaveBeenCalledWith(tab, {
      content: 'changed',
      modified: true,
      contentRevision: 1,
    });
  });
});
