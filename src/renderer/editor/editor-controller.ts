import type { EditMode, Vditor } from '../state/types.js';

export interface EditorScrollPosition {
  readonly mode: EditMode;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly progress: number;
}

export interface EditorRuntimeTab {
  readonly id: string;
  readonly host: HTMLElement;
  mode: EditMode;
  vditor: Vditor | null;
  ready: boolean;
  toolbar: HTMLElement | null;
  pendingScroll: EditorScrollPosition | null;
  content: string;
  savedContent: string;
  modified: boolean;
  contentRevision: number;
  pendingEditorContent: boolean;
  editorRuntimeGeneration?: number;
}

export interface EditorControllerOptions<TTab extends EditorRuntimeTab> {
  readonly adapter: {
    editorScrollContainer(host: HTMLElement, mode: EditMode): HTMLElement | null;
  };
  readonly createOptions: (
    tab: TTab,
    generation: number,
  ) => ConstructorParameters<typeof Vditor>[1];
  readonly getActiveDocumentId: () => string | null;
  readonly onAvailabilityChanged: (tab: TTab) => void;
  readonly onBeforeDestroy: (tab: TTab, disposeTabResources: boolean) => void;
  readonly onCreationFailure: (tab: TTab, error: unknown) => void;
  readonly onModeChanged: (tab: TTab) => void;
  readonly readContent: (tab: TTab) => string;
}

/**
 * Owns the lifetime of a tab's Vditor instance.  The generation is deliberately
 * kept on the tab because legacy document callbacks also need to reject a late
 * Vditor callback after a rebuild or close.
 */
export class EditorController<TTab extends EditorRuntimeTab> {
  private readonly adapter: EditorControllerOptions<TTab>['adapter'];
  private readonly createOptions: EditorControllerOptions<TTab>['createOptions'];
  private readonly getActiveDocumentId: EditorControllerOptions<TTab>['getActiveDocumentId'];
  private readonly onAvailabilityChanged: EditorControllerOptions<TTab>['onAvailabilityChanged'];
  private readonly onBeforeDestroy: EditorControllerOptions<TTab>['onBeforeDestroy'];
  private readonly onCreationFailure: EditorControllerOptions<TTab>['onCreationFailure'];
  private readonly onModeChanged: EditorControllerOptions<TTab>['onModeChanged'];
  private readonly readContent: EditorControllerOptions<TTab>['readContent'];
  private readonly autoSaveTimers = new Map<TTab, number>();

  constructor(options: EditorControllerOptions<TTab>) {
    this.adapter = options.adapter;
    this.createOptions = options.createOptions;
    this.getActiveDocumentId = options.getActiveDocumentId;
    this.onAvailabilityChanged = options.onAvailabilityChanged;
    this.onBeforeDestroy = options.onBeforeDestroy;
    this.onCreationFailure = options.onCreationFailure;
    this.onModeChanged = options.onModeChanged;
    this.readContent = options.readContent;
  }

  ensure(tab: TTab): boolean {
    if (tab.vditor) return true;
    tab.ready = false;
    tab.host.dataset.editorReady = 'false';
    this.onAvailabilityChanged(tab);
    const generation = (tab.editorRuntimeGeneration ?? 0) + 1;
    tab.editorRuntimeGeneration = generation;
    try {
      tab.vditor = new Vditor(tab.host, this.createOptions(tab, generation));
      return true;
    } catch (error) {
      tab.vditor = null;
      this.onCreationFailure(tab, error);
      return false;
    }
  }

  isCurrent(tab: TTab, generation: number): boolean {
    // Vditor 3.11.3 may invoke `after` synchronously from its constructor,
    // before JavaScript assigns the constructed instance back to `tab.vditor`.
    // The generation is the lifecycle authority; destroy/rebuild invalidates it.
    return tab.editorRuntimeGeneration === generation;
  }

  currentContent(tab: TTab | null): string {
    return tab ? this.readContent(tab) : '';
  }

  contentForPersistence(tab: TTab): string {
    return tab.pendingEditorContent ? tab.content : this.currentContent(tab);
  }

  applyInput(tab: TTab, value: string): boolean {
    const changed = value !== tab.content;
    if (changed) {
      tab.pendingEditorContent = false;
      tab.contentRevision++;
    }
    tab.content = value;
    tab.modified = value !== tab.savedContent;
    return changed;
  }

  injectContent(tab: TTab, content: string, clearStack = true): boolean {
    if (!tab.vditor) return false;
    // Vditor exposes setValue during its synchronous after callback, before the
    // tab can be marked ready. Recovery content must be applied at that point
    // rather than leaving a direct private instance mutation in app.js.
    tab.vditor.setValue(content, clearStack);
    return true;
  }

  focus(tab: TTab | null): void {
    tab?.vditor?.focus();
  }

  scheduleAutoSave(tab: TTab, delay: number, save: () => void): void {
    this.cancelAutoSave(tab);
    const timer = window.setTimeout(() => {
      if (this.autoSaveTimers.get(tab) !== timer) return;
      this.autoSaveTimers.delete(tab);
      save();
    }, delay);
    this.autoSaveTimers.set(tab, timer);
  }

  cancelAutoSave(tab: TTab): void {
    const timer = this.autoSaveTimers.get(tab);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.autoSaveTimers.delete(tab);
  }

  captureScroll(tab: TTab): EditorScrollPosition | null {
    if (!tab.vditor) return null;
    const mode = tab.vditor.getCurrentMode();
    if (!mode) return null;
    const scroller = this.adapter.editorScrollContainer(tab.host, mode);
    if (!scroller) return null;
    const maximumTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return {
      mode,
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
      progress: maximumTop ? scroller.scrollTop / maximumTop : 0,
    };
  }

  restoreScroll(tab: TTab, afterRestore: () => void): void {
    const saved = tab.pendingScroll;
    if (!saved) return;
    const restore = (): void => {
      const mode = tab.vditor?.getCurrentMode() ?? tab.mode;
      const scroller = this.adapter.editorScrollContainer(tab.host, mode);
      if (!scroller) return;
      const maximumTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const maximumLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollTop =
        mode === saved.mode
          ? Math.min(maximumTop, Math.max(0, saved.scrollTop))
          : maximumTop * Math.min(1, Math.max(0, saved.progress));
      scroller.scrollLeft = Math.min(maximumLeft, Math.max(0, saved.scrollLeft));
      afterRestore();
    };
    const restoreUntilStable = (frame = 0): void => {
      if (tab.pendingScroll !== saved || !tab.vditor) return;
      restore();
      if (frame < 3) {
        requestAnimationFrame(() => restoreUntilStable(frame + 1));
        return;
      }
      window.setTimeout(() => {
        if (tab.pendingScroll !== saved || !tab.vditor) return;
        restore();
        tab.pendingScroll = null;
      }, 80);
    };
    restoreUntilStable();
  }

  synchronizeMode(tab: TTab): void {
    const mode = tab.vditor?.getCurrentMode();
    if (!mode) return;
    tab.mode = mode;
    this.onModeChanged(tab);
  }

  rebuild(tab: TTab, mode?: EditMode): Error | null {
    tab.ready = false;
    tab.host.dataset.editorReady = 'false';
    this.onAvailabilityChanged(tab);
    tab.pendingScroll = this.captureScroll(tab);
    const rebuildError = this.destroy(tab, false);
    tab.host.innerHTML = '';
    if (mode) tab.mode = mode;
    if (tab.id === this.getActiveDocumentId() && !this.ensure(tab)) {
      return new Error('The editor could not be initialized after the document changed.');
    }
    return rebuildError;
  }

  destroy(tab: TTab, disposeTabResources = true): Error | null {
    this.cancelAutoSave(tab);
    tab.editorRuntimeGeneration = (tab.editorRuntimeGeneration ?? 0) + 1;
    this.onBeforeDestroy(tab, disposeTabResources);
    if (!tab.vditor) return null;
    let destroyError: Error | null = null;
    try {
      tab.vditor.destroy();
    } catch (error) {
      // Destruction is best effort; the document-close transaction must continue.
      destroyError =
        error instanceof Error ? error : new Error('The editor could not be destroyed.');
    }
    tab.vditor = null;
    tab.toolbar = null;
    tab.ready = false;
    return destroyError;
  }
}
