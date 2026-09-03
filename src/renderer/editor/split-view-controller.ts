export interface SplitViewTab {
  readonly host: HTMLElement;
  splitResizer: HTMLElement | null;
}

export interface SplitViewControllerOptions<TTab extends SplitViewTab> {
  readonly getContent: (tab: TTab) => HTMLElement | null;
  readonly getSource: (tab: TTab) => HTMLElement | null;
  readonly ensureResizer: (tab: TTab) => HTMLElement | null;
  readonly getVisibility: (
    tab: TTab,
    mode: 'wysiwyg' | 'ir' | 'sv',
  ) => { sourceVisible: boolean; previewVisible: boolean } | null;
  readonly getRatio: () => number;
  readonly setRatio: (ratio: number) => void;
  readonly persistRatio: () => void;
  readonly onLayoutChanged: (tab: TTab) => void;
  readonly refreshLineNumbers: (tab: TTab) => void;
  readonly shouldDeferLineNumberResize: () => boolean;
  readonly syncScroll: (tab: TTab) => void;
  readonly installScrollEnhancement: (tab: TTab) => (() => void) | null;
  readonly installAutoIndent: (tab: TTab) => (() => void) | null;
  readonly captureIndentSelection: (tab: TTab) => Range | null;
  readonly applyIndent: (tab: TTab, type: 'indent' | 'outdent', range: Range | null) => boolean;
}

interface SplitRuntime {
  lineNumberFrame: number | null;
  lineObserver: MutationObserver | null;
  lineResizeObserver: ResizeObserver | null;
  scrollSource: HTMLElement | null;
  onScroll: (() => void) | null;
  scrollEnhancementCleanup: (() => void) | null;
  autoIndentCleanup: (() => void) | null;
}

/** Owns each tab's SV layout runtime, divider, and temporary listeners. */
export class SplitViewController<TTab extends SplitViewTab> {
  private readonly getContent: SplitViewControllerOptions<TTab>['getContent'];
  private readonly getSource: SplitViewControllerOptions<TTab>['getSource'];
  private readonly ensureResizer: SplitViewControllerOptions<TTab>['ensureResizer'];
  private readonly getVisibility: SplitViewControllerOptions<TTab>['getVisibility'];
  private readonly getRatio: () => number;
  private readonly setRatio: (ratio: number) => void;
  private readonly persistRatio: () => void;
  private readonly onLayoutChanged: (tab: TTab) => void;
  private readonly refreshLineNumbers: (tab: TTab) => void;
  private readonly shouldDeferLineNumberResize: () => boolean;
  private readonly syncScroll: (tab: TTab) => void;
  private readonly installScrollEnhancement: (tab: TTab) => (() => void) | null;
  private readonly installAutoIndent: (tab: TTab) => (() => void) | null;
  private readonly captureIndentSelection: (tab: TTab) => Range | null;
  private readonly applyIndent: SplitViewControllerOptions<TTab>['applyIndent'];
  private readonly indentSelections = new Map<TTab, Range>();
  private readonly runtimes = new Map<TTab, SplitRuntime>();
  private readonly activeDrags = new Map<
    TTab,
    { move: (event: MouseEvent) => void; up: () => void }
  >();
  private readonly resizerListeners = new Map<
    TTab,
    { resizer: HTMLElement; onMouseDown: (event: MouseEvent) => void }
  >();

  constructor(options: SplitViewControllerOptions<TTab>) {
    this.getContent = options.getContent;
    this.getSource = options.getSource;
    this.ensureResizer = options.ensureResizer;
    this.getVisibility = options.getVisibility;
    this.getRatio = options.getRatio;
    this.setRatio = options.setRatio;
    this.persistRatio = options.persistRatio;
    this.onLayoutChanged = options.onLayoutChanged;
    this.refreshLineNumbers = options.refreshLineNumbers;
    this.shouldDeferLineNumberResize = options.shouldDeferLineNumberResize;
    this.syncScroll = options.syncScroll;
    this.installScrollEnhancement = options.installScrollEnhancement;
    this.installAutoIndent = options.installAutoIndent;
    this.captureIndentSelection = options.captureIndentSelection;
    this.applyIndent = options.applyIndent;
  }

  attach(tab: TTab): void {
    const content = this.getContent(tab);
    const resizer = this.ensureResizer(tab);
    if (!content || !resizer) return;
    const previous = this.resizerListeners.get(tab);
    if (previous?.resizer !== resizer) {
      previous?.resizer.removeEventListener('mousedown', previous.onMouseDown);
      const onMouseDown = (event: MouseEvent): void => this.startDrag(tab, content, resizer, event);
      resizer.addEventListener('mousedown', onMouseDown);
      this.resizerListeners.set(tab, { resizer, onMouseDown });
    }
    tab.host.style.setProperty('--split-source-width', `${this.getRatio() || 50}%`);
    tab.splitResizer = resizer;
  }

  activate(tab: TTab): void {
    const runtime = this.runtimeFor(tab);
    if (!runtime.scrollEnhancementCleanup)
      runtime.scrollEnhancementCleanup = this.installScrollEnhancement(tab);
    if (!runtime.autoIndentCleanup) runtime.autoIndentCleanup = this.installAutoIndent(tab);
  }

  syncLayout(tab: TTab, mode: 'wysiwyg' | 'ir' | 'sv') {
    const visibility = this.getVisibility(tab, mode);
    if (!visibility) return null;
    const { sourceVisible, previewVisible } = visibility;
    tab.host.classList.toggle('sv-editor-only', sourceVisible && !previewVisible);
    tab.host.classList.toggle('sv-preview-only', !sourceVisible && previewVisible);
    tab.host.classList.toggle('sv-both', sourceVisible && previewVisible);
    const resizer = this.ensureResizer(tab);
    if (resizer) {
      tab.splitResizer = resizer;
      resizer.classList.toggle('hidden', !sourceVisible || !previewVisible);
    }
    return visibility;
  }

  scheduleLineNumbers(tab: TTab): void {
    const runtime = this.runtimeFor(tab);
    if (runtime.lineNumberFrame !== null) cancelAnimationFrame(runtime.lineNumberFrame);
    runtime.lineNumberFrame = requestAnimationFrame(() => {
      if (this.runtimes.get(tab) !== runtime) return;
      runtime.lineNumberFrame = null;
      this.refreshLineNumbers(tab);
      this.observeSourceScroll(tab);
    });
  }

  observeLineNumbers(tab: TTab): void {
    const runtime = this.runtimeFor(tab);
    runtime.lineObserver?.disconnect();
    runtime.lineResizeObserver?.disconnect();
    runtime.lineObserver = null;
    runtime.lineResizeObserver = null;
    const source = this.getSource(tab);
    if (!source) return;
    runtime.lineObserver = new MutationObserver(() => this.scheduleLineNumbers(tab));
    runtime.lineObserver.observe(source, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style'],
    });
    if (typeof ResizeObserver !== 'function') return;
    runtime.lineResizeObserver = new ResizeObserver(() => {
      if (!this.shouldDeferLineNumberResize()) this.scheduleLineNumbers(tab);
    });
    runtime.lineResizeObserver.observe(source);
  }

  dispose(tab: TTab): void {
    this.cancelDrag(tab);
    const runtime = this.runtimes.get(tab);
    if (runtime) {
      runtime.lineObserver?.disconnect();
      runtime.lineResizeObserver?.disconnect();
      if (runtime.lineNumberFrame !== null) cancelAnimationFrame(runtime.lineNumberFrame);
      if (runtime.scrollSource && runtime.onScroll)
        runtime.scrollSource.removeEventListener('scroll', runtime.onScroll);
      runtime.scrollEnhancementCleanup?.();
      runtime.autoIndentCleanup?.();
      this.runtimes.delete(tab);
    }
    const listener = this.resizerListeners.get(tab);
    if (listener) listener.resizer.removeEventListener('mousedown', listener.onMouseDown);
    this.resizerListeners.delete(tab);
    this.indentSelections.delete(tab);
    tab.splitResizer?.classList.remove('dragging');
    tab.splitResizer = null;
  }

  preserveIndentSelection(tab: TTab): void {
    const range = this.captureIndentSelection(tab);
    if (range) this.indentSelections.set(tab, range);
  }

  applyToolbarIndent(tab: TTab, type: 'indent' | 'outdent'): boolean {
    const applied = this.applyIndent(tab, type, this.indentSelections.get(tab) || null);
    this.indentSelections.delete(tab);
    return applied;
  }

  private runtimeFor(tab: TTab): SplitRuntime {
    let runtime = this.runtimes.get(tab);
    if (!runtime) {
      runtime = {
        lineNumberFrame: null,
        lineObserver: null,
        lineResizeObserver: null,
        scrollSource: null,
        onScroll: null,
        scrollEnhancementCleanup: null,
        autoIndentCleanup: null,
      };
      this.runtimes.set(tab, runtime);
    }
    return runtime;
  }

  private observeSourceScroll(tab: TTab): void {
    const runtime = this.runtimeFor(tab);
    const source = this.getSource(tab);
    if (runtime.scrollSource === source) return;
    if (runtime.scrollSource && runtime.onScroll)
      runtime.scrollSource.removeEventListener('scroll', runtime.onScroll);
    runtime.scrollSource = source;
    runtime.onScroll = source
      ? () => {
          this.syncScroll(tab);
          this.scheduleLineNumbers(tab);
        }
      : null;
    if (source && runtime.onScroll) source.addEventListener('scroll', runtime.onScroll);
  }

  private cancelDrag(tab: TTab): void {
    const drag = this.activeDrags.get(tab);
    if (!drag) return;
    window.removeEventListener('mousemove', drag.move);
    window.removeEventListener('mouseup', drag.up);
    this.activeDrags.delete(tab);
  }

  private startDrag(
    tab: TTab,
    content: HTMLElement,
    resizer: HTMLElement,
    event: MouseEvent,
  ): void {
    event.preventDefault();
    this.cancelDrag(tab);
    resizer.classList.add('dragging');
    const move = (moveEvent: MouseEvent): void => {
      const rect = content.getBoundingClientRect();
      if (!rect.width) return;
      const rawRatio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      const ratio = Math.min(80, Math.max(20, rawRatio));
      const normalized = Math.abs(ratio - 50) <= 2.5 ? 50 : Math.round(ratio * 10) / 10;
      this.setRatio(normalized);
      resizer.classList.toggle('snapped', normalized === 50);
      tab.host.style.setProperty('--split-source-width', `${normalized}%`);
      this.onLayoutChanged(tab);
    };
    const up = (): void => {
      resizer.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.activeDrags.delete(tab);
      this.persistRatio();
    };
    this.activeDrags.set(tab, { move, up });
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
}
