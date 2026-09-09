export interface SidebarLayoutControllerOptions {
  readonly app: HTMLElement;
  readonly sidebar: HTMLElement;
  readonly toggle: HTMLElement;
  readonly menuBar: HTMLElement;
  readonly animatedElements: readonly HTMLElement[];
  readonly chromeElements: readonly HTMLElement[];
  readonly getSidebarWidth: () => number;
  readonly getSidebarVisible: () => boolean;
  readonly setSidebarVisible: (visible: boolean) => void;
  readonly persistSidebarVisible: (visible: boolean) => void;
  readonly applyTopControlsWidth: (sidebarWidth: number, menuWidth: number) => void;
  readonly syncTopControlsWidth: () => void;
  readonly refreshEditorLayout: () => void;
  readonly duration: () => number;
}

/** Owns sidebar transition handles, fallback timer and FLIP animations. */
export class SidebarLayoutController {
  private transitionTimer: ReturnType<typeof setTimeout> | undefined;
  private transitionEnd: ((event: TransitionEvent) => void) | undefined;
  private animations: Animation[] = [];

  constructor(private readonly options: SidebarLayoutControllerOptions) {}

  toggle(force?: boolean): void {
    const { app, sidebar } = this.options;
    const isTransitioning = app.classList.contains('sidebar-transitioning');
    const visible =
      typeof force === 'boolean'
        ? force
        : isTransitioning
          ? !this.options.getSidebarVisible()
          : sidebar.classList.contains('collapsed');
    const currentTargetVisible = isTransitioning
      ? this.options.getSidebarVisible()
      : !sidebar.classList.contains('collapsed');
    if (currentTargetVisible === visible) {
      this.setVisible(visible, false);
      if (!isTransitioning) this.options.syncTopControlsWidth();
      return;
    }
    this.finish();
    const initial = this.layoutPositions();
    app.classList.add('sidebar-transitioning');
    if (visible) {
      this.options.applyTopControlsWidth(
        this.options.getSidebarWidth(),
        this.options.menuBar.getBoundingClientRect().width,
      );
      sidebar.classList.add('sidebar-entering');
      void sidebar.offsetWidth;
      sidebar.classList.add('sidebar-opening');
    } else {
      this.options.applyTopControlsWidth(0, this.options.menuBar.getBoundingClientRect().width);
      sidebar.classList.add('sidebar-closing');
    }
    if (!visible) sidebar.classList.remove('collapsed');
    if (visible) app.classList.remove('sidebar-collapsed', 'sidebar-hiding');
    else app.classList.add('sidebar-hiding');
    this.setVisible(visible, true);
    const targetChrome = visible ? [] : this.measureCollapsedChrome();
    this.animate(initial, visible, targetChrome);
    this.transitionEnd = (event) => {
      if (event.target === sidebar && event.propertyName === 'transform') this.finish(true);
    };
    sidebar.addEventListener('transitionend', this.transitionEnd);
    this.transitionTimer = setTimeout(() => this.finish(true), 220);
  }

  dispose(): void {
    this.finish();
  }

  private setVisible(visible: boolean, persist: boolean): void {
    this.options.setSidebarVisible(visible);
    this.options.toggle.setAttribute('aria-pressed', String(visible));
    if (persist) this.options.persistSidebarVisible(visible);
  }

  private finish(refreshEditorLayout = false): void {
    const { app, sidebar } = this.options;
    if (this.transitionTimer !== undefined) clearTimeout(this.transitionTimer);
    this.transitionTimer = undefined;
    if (this.transitionEnd) sidebar.removeEventListener('transitionend', this.transitionEnd);
    this.transitionEnd = undefined;
    const wasOpening = sidebar.classList.contains('sidebar-opening');
    const wasHiding = app.classList.contains('sidebar-hiding');
    if (wasHiding) sidebar.classList.add('collapsed');
    sidebar.classList.remove('sidebar-entering', 'sidebar-opening', 'sidebar-closing');
    if (wasOpening) sidebar.classList.remove('collapsed');
    if (wasHiding) app.classList.add('sidebar-collapsed');
    app.classList.remove('sidebar-transitioning', 'sidebar-hiding');
    this.options.syncTopControlsWidth();
    this.cancelAnimations();
    if (refreshEditorLayout) this.options.refreshEditorLayout();
  }

  private layoutPositions(): Array<readonly [HTMLElement, number]> {
    return this.options.animatedElements.map(
      (element) => [element, element.getBoundingClientRect().left] as const,
    );
  }

  private measureCollapsedChrome(): Array<readonly [HTMLElement, number]> {
    const wasCollapsed = this.options.app.classList.contains('sidebar-collapsed');
    this.options.app.classList.add('sidebar-collapsed');
    const positions = this.options.chromeElements.map(
      (element) => [element, element.getBoundingClientRect().left] as const,
    );
    this.options.app.classList.toggle('sidebar-collapsed', wasCollapsed);
    return positions;
  }

  private animate(
    initial: ReadonlyArray<readonly [HTMLElement, number]>,
    visible: boolean,
    targetChrome: ReadonlyArray<readonly [HTMLElement, number]>,
  ): void {
    this.cancelAnimations();
    const before = new Map(initial);
    const targets = new Map(targetChrome);
    const sidebarWidth = this.options.getSidebarWidth();
    this.animations = this.layoutPositions().flatMap(([element, currentLeft]) => {
      if (!visible && element.id === 'vditorToolbarMount') return [];
      const initialLeft = before.get(element);
      if (initialLeft === undefined) return [];
      const from = initialLeft - currentLeft;
      const to =
        element.id === 'editorArea'
          ? visible
            ? sidebarWidth
            : -sidebarWidth
          : visible
            ? 0
            : (targets.get(element) ?? currentLeft) - currentLeft;
      if (Math.abs(from - to) < 0.5 || typeof element.animate !== 'function') return [];
      return [
        element.animate(
          [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
          { duration: this.options.duration(), easing: 'ease', fill: 'forwards' },
        ),
      ];
    });
  }

  private cancelAnimations(): void {
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
  }
}
