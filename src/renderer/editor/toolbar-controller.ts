export interface ToolbarRuntime {
  readonly host: HTMLElement;
  readonly toolbar: HTMLElement | null;
  readonly ready: boolean;
  readonly toolbarPreview?: boolean;
}

export interface ToolbarControllerOptions<TRuntime extends ToolbarRuntime> {
  readonly app: HTMLElement;
  readonly mount: HTMLElement;
  readonly mainArea: HTMLElement;
  readonly getActiveRuntime: () => TRuntime | null;
  readonly getPreviewRuntime: () => TRuntime | null;
  readonly findRuntimeByToolbar: (toolbar: HTMLElement) => TRuntime | null;
  readonly getMountedToolbar: () => HTMLElement | null;
}

export class ToolbarController<TRuntime extends ToolbarRuntime> {
  private readonly app: HTMLElement;
  private readonly mount: HTMLElement;
  private readonly mainArea: HTMLElement;
  private readonly getActiveRuntime: ToolbarControllerOptions<TRuntime>['getActiveRuntime'];
  private readonly getPreviewRuntime: ToolbarControllerOptions<TRuntime>['getPreviewRuntime'];
  private readonly findRuntimeByToolbar: ToolbarControllerOptions<TRuntime>['findRuntimeByToolbar'];
  private readonly getMountedToolbar: ToolbarControllerOptions<TRuntime>['getMountedToolbar'];
  private wrapHeight = 0;
  private frame: number | null = null;

  constructor(options: ToolbarControllerOptions<TRuntime>) {
    this.app = options.app;
    this.mount = options.mount;
    this.mainArea = options.mainArea;
    this.getActiveRuntime = options.getActiveRuntime;
    this.getPreviewRuntime = options.getPreviewRuntime;
    this.findRuntimeByToolbar = options.findRuntimeByToolbar;
    this.getMountedToolbar = options.getMountedToolbar;
  }

  syncAvailability(shouldMeasure = true): void {
    const owner = this.getActiveRuntime() || this.getPreviewRuntime();
    const available = Boolean(
      owner?.ready && owner.toolbar && owner.toolbar.parentElement === this.mount,
    );
    // Keep the shared row geometrically stable until Vditor has handed its toolbar to Desktop.
    this.mount.dataset.toolbarPending = String(!available);
    this.mount.setAttribute('aria-busy', String(!available));
    if (shouldMeasure) this.syncWrapHeight();
  }

  restore(runtime: TRuntime | null): void {
    if (runtime?.toolbar && runtime.toolbar.parentElement === this.mount) {
      runtime.host.insertBefore(runtime.toolbar, runtime.host.firstChild);
    }
  }

  mountRuntime(runtime: TRuntime): void {
    const mounted = this.getMountedToolbar();
    if (mounted && mounted !== runtime.toolbar) {
      const owner = this.findRuntimeByToolbar(mounted);
      if (owner?.host.isConnected) owner.host.insertBefore(mounted, owner.host.firstChild);
      else mounted.remove();
    }
    if (runtime.toolbar && runtime.toolbar.parentElement !== this.mount) {
      this.mount.appendChild(runtime.toolbar);
    }
  }

  disablePreview(runtime: TRuntime): void {
    runtime.toolbar
      ?.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')
      .forEach((control) => {
        control.disabled = true;
        control.tabIndex = -1;
      });
  }

  syncWrapHeight(): void {
    const runtime = this.getActiveRuntime() || this.getPreviewRuntime();
    const toolbar = runtime?.toolbar;
    const hidden = this.app.classList.contains('toolbar-hidden');
    // Vditor menus are absolutely positioned but contribute to scrollHeight.
    // Only the toolbar's rendered box represents wrapped control rows.
    const toolbarHeight =
      !hidden && toolbar?.parentElement === this.mount ? toolbar.getBoundingClientRect().height : 0;
    if (toolbarHeight) this.wrapHeight = Math.max(0, Math.ceil(toolbarHeight - 38));
    const extraHeight =
      this.mount.dataset.toolbarPending === 'true'
        ? this.wrapHeight
        : hidden
          ? 0
          : Math.max(0, Math.ceil(toolbarHeight - 38));
    const wrapHeight = `${extraHeight}px`;
    if (this.mainArea.style.paddingTop !== wrapHeight) this.mainArea.style.paddingTop = wrapHeight;
    if (this.mount.style.getPropertyValue('--toolbar-wrap-height') !== wrapHeight) {
      this.mount.style.setProperty('--toolbar-wrap-height', wrapHeight);
    }
  }

  scheduleWrapHeight(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    // Let Vditor finish its pending style work before measuring the shared toolbar.
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.syncWrapHeight();
      });
    });
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
