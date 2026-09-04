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
  bottomSpacerObserver: ResizeObserver | null;
  editorRuntimeGeneration?: number;
}

type EditorDocumentUpdates = Pick<
  EditorRuntimeTab,
  'content' | 'savedContent' | 'modified' | 'contentRevision' | 'mode'
>;

export interface EditorControllerOptions<TTab extends EditorRuntimeTab> {
  readonly adapter: {
    editorScrollContainer(host: HTMLElement, mode: EditMode): HTMLElement | null;
    setBottomSpacer(host: HTMLElement, height: number): void;
    observeOutlineChanges(host: HTMLElement, callback: () => void): { disconnect(): void };
    preserveTableScrollDuringInput(host: HTMLElement, getMode: () => EditMode): () => void;
    scrollContainers(host: HTMLElement): HTMLElement[];
    installScrollEnhancement(element: HTMLElement): (() => void) | null;
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
  readonly readRuntimeContent: (tab: TTab) => string;
  /** Document fields remain owned by DocumentController/AppStore, not editor runtime. */
  readonly updateDocument?: (tab: TTab, updates: Partial<EditorDocumentUpdates>) => void;
}

export interface DocumentAnchorNavigationHandlers {
  readonly onMouseOver: (event: MouseEvent) => void;
  readonly onMouseOut: (event: MouseEvent) => void;
  readonly onMouseMove: (event: MouseEvent) => void;
  readonly onClick: (event: MouseEvent) => void;
}

export interface ToolbarHandlers {
  readonly onClick: (event: MouseEvent) => void;
  readonly onMouseDown: (event: MouseEvent) => void;
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
  private readonly readRuntimeContent: EditorControllerOptions<TTab>['readRuntimeContent'];
  private readonly updateDocument: NonNullable<EditorControllerOptions<TTab>['updateDocument']>;
  private readonly autoSaveTimers = new Map<TTab, number>();
  private readonly modeTransitionFrames = new Map<TTab, number>();
  private readonly modeTransitionTimers = new Map<TTab, number>();
  private readonly modeShortcutCleanups = new Map<TTab, () => void>();
  private readonly outlineObservers = new Map<TTab, { disconnect(): void }>();
  private readonly tableCompositionScrollCleanups = new Map<TTab, () => void>();
  private readonly scrollEnhancementCleanups = new Map<TTab, Array<() => void>>();
  private readonly documentAnchorNavigationCleanups = new Map<TTab, () => void>();
  private readonly contextMenuCleanups = new Map<TTab, () => void>();
  private readonly toolbarHandlerCleanups = new Map<TTab, () => void>();
  private readonly focusTimers = new Map<TTab, number>();

  constructor(options: EditorControllerOptions<TTab>) {
    this.adapter = options.adapter;
    this.createOptions = options.createOptions;
    this.getActiveDocumentId = options.getActiveDocumentId;
    this.onAvailabilityChanged = options.onAvailabilityChanged;
    this.onBeforeDestroy = options.onBeforeDestroy;
    this.onCreationFailure = options.onCreationFailure;
    this.onModeChanged = options.onModeChanged;
    this.readContent = options.readContent;
    this.readRuntimeContent = options.readRuntimeContent;
    this.updateDocument = options.updateDocument ?? ((tab, updates) => Object.assign(tab, updates));
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
    if (!tab) return '';
    // A recovery snapshot may arrive while Vditor is still applying its
    // constructor value. Keep the pending snapshot authoritative until after
    // reconciliation injects it into the completed runtime.
    return tab.pendingEditorContent ? tab.content : this.readContent(tab);
  }

  contentForPersistence(tab: TTab): string {
    return tab.pendingEditorContent ? tab.content : this.currentContent(tab);
  }

  applyInput(tab: TTab, value: string): boolean {
    const changed = value !== tab.content;
    if (changed) tab.pendingEditorContent = false;
    this.updateDocument(tab, {
      content: value,
      modified: value !== tab.savedContent,
      ...(changed ? { contentRevision: tab.contentRevision + 1 } : {}),
    });
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

  scheduleFocus(tab: TTab): void {
    this.cancelFocus(tab);
    const timer = window.setTimeout(() => {
      if (this.focusTimers.get(tab) !== timer) return;
      this.focusTimers.delete(tab);
      if (tab.id === this.getActiveDocumentId()) this.focus(tab);
    }, 0);
    this.focusTimers.set(tab, timer);
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

  beginExternalChange(tab: TTab): void {
    this.cancelAutoSave(tab);
  }

  applyExternalContent(tab: TTab, content: string): boolean {
    this.beginExternalChange(tab);
    return this.injectContent(tab, content, true);
  }

  applyRecoveryContent(tab: TTab, content: string): boolean {
    this.updateDocument(tab, { content });
    if (!tab.ready) {
      tab.pendingEditorContent = true;
      return false;
    }
    tab.pendingEditorContent = !this.injectContent(tab, content, true);
    return !tab.pendingEditorContent;
  }

  applyPendingContent(tab: TTab): boolean {
    if (!tab.pendingEditorContent) return false;
    if (!this.injectContent(tab, tab.content, true)) return false;
    tab.pendingEditorContent = false;
    return true;
  }

  observeBottomSpacer(tab: TTab): void {
    this.disconnectBottomSpacer(tab);
    if (typeof ResizeObserver !== 'function') {
      this.updateBottomSpacer(tab);
      return;
    }
    // Vditor completes long-document layout asynchronously; observe rather than
    // reading a provisional height during its `after` callback.
    tab.bottomSpacerObserver = new ResizeObserver(() => this.updateBottomSpacer(tab));
    tab.bottomSpacerObserver.observe(tab.host);
  }

  disconnectBottomSpacer(tab: TTab): void {
    tab.bottomSpacerObserver?.disconnect();
    tab.bottomSpacerObserver = null;
  }

  updateBottomSpacer(tab: TTab): void {
    this.adapter.setBottomSpacer(tab.host, tab.host.clientHeight / 2);
  }

  observeOutlineChanges(tab: TTab, onChanged: () => void): void {
    this.disconnectOutlineObserver(tab);
    this.outlineObservers.set(tab, this.adapter.observeOutlineChanges(tab.host, onChanged));
  }

  preserveTableScrollDuringInput(tab: TTab): void {
    this.tableCompositionScrollCleanups.get(tab)?.();
    this.tableCompositionScrollCleanups.set(
      tab,
      this.adapter.preserveTableScrollDuringInput(
        tab.host,
        () => tab.vditor?.getCurrentMode() ?? tab.mode,
      ),
    );
  }

  installScrollEnhancements(tab: TTab, excludedElement: HTMLElement | null): void {
    this.clearScrollEnhancements(tab);
    const cleanups = this.adapter
      .scrollContainers(tab.host)
      .filter((element) => element !== excludedElement)
      .map((element) => this.adapter.installScrollEnhancement(element))
      .filter((cleanup): cleanup is () => void => Boolean(cleanup));
    if (cleanups.length) this.scrollEnhancementCleanups.set(tab, cleanups);
  }

  reconcileInitializedContent(tab: TTab, wasModified: boolean): void {
    const hadPendingContent = tab.pendingEditorContent;
    const savedContent = tab.savedContent;
    const wasPendingModified = tab.modified;
    if (hadPendingContent) this.applyPendingContent(tab);
    const content = this.currentContent(tab);
    const nextSavedContent =
      wasModified || hadPendingContent || wasPendingModified ? savedContent : content;
    this.updateDocument(tab, {
      content,
      savedContent: nextSavedContent,
      modified:
        wasModified || wasPendingModified || hadPendingContent || content !== nextSavedContent,
    });
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
    const generation = tab.editorRuntimeGeneration;
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
      if (tab.pendingScroll !== saved || !tab.vditor || tab.editorRuntimeGeneration !== generation)
        return;
      restore();
      if (frame < 3) {
        requestAnimationFrame(() => restoreUntilStable(frame + 1));
        return;
      }
      window.setTimeout(() => {
        if (
          tab.pendingScroll !== saved ||
          !tab.vditor ||
          tab.editorRuntimeGeneration !== generation
        )
          return;
        restore();
        tab.pendingScroll = null;
      }, 80);
    };
    restoreUntilStable();
  }

  synchronizeMode(tab: TTab): void {
    const mode = tab.vditor?.getCurrentMode();
    if (!mode) return;
    this.updateDocument(tab, { mode });
    this.onModeChanged(tab);
  }

  prepareModeTransition(tab: TTab, targetMode: EditMode, afterRestore: () => void): boolean {
    if (!tab.vditor || !tab.ready || targetMode === tab.vditor.getCurrentMode()) return false;
    tab.pendingScroll = this.captureScroll(tab);
    this.cancelModeTransition(tab);
    // Vditor 3.11.3 updates its mode synchronously. Sync on the next frame, then
    // once more after toolbar-driven DOM work settles.
    const frame = requestAnimationFrame(() => {
      this.modeTransitionFrames.delete(tab);
      if (!tab.vditor) return;
      this.synchronizeMode(tab);
      this.restoreScroll(tab, afterRestore);
    });
    this.modeTransitionFrames.set(tab, frame);
    const timer = window.setTimeout(() => {
      this.modeTransitionTimers.delete(tab);
      if (tab.vditor) this.synchronizeMode(tab);
    }, 50);
    this.modeTransitionTimers.set(tab, timer);
    return true;
  }

  attachModeShortcut(tab: TTab, onKeyDown: (event: KeyboardEvent) => void): void {
    if (this.modeShortcutCleanups.has(tab)) return;
    tab.host.addEventListener('keydown', onKeyDown, true);
    this.modeShortcutCleanups.set(tab, () => {
      tab.host.removeEventListener('keydown', onKeyDown, true);
      this.modeShortcutCleanups.delete(tab);
    });
  }

  attachDocumentAnchorNavigation(tab: TTab, handlers: DocumentAnchorNavigationHandlers): void {
    if (this.documentAnchorNavigationCleanups.has(tab)) return;
    tab.host.addEventListener('mouseover', handlers.onMouseOver, true);
    tab.host.addEventListener('mouseout', handlers.onMouseOut, true);
    tab.host.addEventListener('mousemove', handlers.onMouseMove, true);
    tab.host.addEventListener('click', handlers.onClick, true);
    this.documentAnchorNavigationCleanups.set(tab, () => {
      tab.host.removeEventListener('mouseover', handlers.onMouseOver, true);
      tab.host.removeEventListener('mouseout', handlers.onMouseOut, true);
      tab.host.removeEventListener('mousemove', handlers.onMouseMove, true);
      tab.host.removeEventListener('click', handlers.onClick, true);
      this.documentAnchorNavigationCleanups.delete(tab);
    });
  }

  attachContextMenu(tab: TTab, onContextMenu: (event: MouseEvent) => void): void {
    if (this.contextMenuCleanups.has(tab)) return;
    tab.host.addEventListener('contextmenu', onContextMenu, true);
    this.contextMenuCleanups.set(tab, () => {
      tab.host.removeEventListener('contextmenu', onContextMenu, true);
      this.contextMenuCleanups.delete(tab);
    });
  }

  attachToolbarHandlers(tab: TTab, toolbar: HTMLElement, handlers: ToolbarHandlers): void {
    this.toolbarHandlerCleanups.get(tab)?.();
    toolbar.addEventListener('click', handlers.onClick, true);
    toolbar.addEventListener('mousedown', handlers.onMouseDown, true);
    this.toolbarHandlerCleanups.set(tab, () => {
      toolbar.removeEventListener('click', handlers.onClick, true);
      toolbar.removeEventListener('mousedown', handlers.onMouseDown, true);
      this.toolbarHandlerCleanups.delete(tab);
    });
  }

  rebuild(tab: TTab, mode?: EditMode): Error | null {
    if (tab.vditor) this.updateDocument(tab, { content: this.readRuntimeContent(tab) });
    tab.ready = false;
    tab.host.dataset.editorReady = 'false';
    this.onAvailabilityChanged(tab);
    tab.pendingScroll = this.captureScroll(tab);
    const rebuildError = this.destroy(tab, false);
    tab.host.innerHTML = '';
    if (mode) this.updateDocument(tab, { mode });
    if (tab.id === this.getActiveDocumentId() && !this.ensure(tab)) {
      return new Error('The editor could not be initialized after the document changed.');
    }
    return rebuildError;
  }

  destroy(tab: TTab, disposeTabResources = true): Error | null {
    this.cancelAutoSave(tab);
    this.cancelModeTransition(tab);
    this.disconnectBottomSpacer(tab);
    this.disconnectOutlineObserver(tab);
    this.tableCompositionScrollCleanups.get(tab)?.();
    this.tableCompositionScrollCleanups.delete(tab);
    this.clearScrollEnhancements(tab);
    this.toolbarHandlerCleanups.get(tab)?.();
    this.cancelFocus(tab);
    if (disposeTabResources) this.modeShortcutCleanups.get(tab)?.();
    if (disposeTabResources) this.documentAnchorNavigationCleanups.get(tab)?.();
    if (disposeTabResources) this.contextMenuCleanups.get(tab)?.();
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

  private cancelModeTransition(tab: TTab): void {
    const frame = this.modeTransitionFrames.get(tab);
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      this.modeTransitionFrames.delete(tab);
    }
    const timer = this.modeTransitionTimers.get(tab);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.modeTransitionTimers.delete(tab);
    }
  }

  private disconnectOutlineObserver(tab: TTab): void {
    this.outlineObservers.get(tab)?.disconnect();
    this.outlineObservers.delete(tab);
  }

  private clearScrollEnhancements(tab: TTab): void {
    this.scrollEnhancementCleanups.get(tab)?.forEach((cleanup) => cleanup());
    this.scrollEnhancementCleanups.delete(tab);
  }

  private cancelFocus(tab: TTab): void {
    const timer = this.focusTimers.get(tab);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.focusTimers.delete(tab);
  }
}
