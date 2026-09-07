export interface SettingsDialogSize {
  readonly width: number;
  readonly height: number;
  readonly customized?: boolean;
}

export interface SettingsDialogLayoutControllerOptions {
  readonly card: HTMLElement;
  readonly onPersist: (size: SettingsDialogSize) => void;
  readonly onWindowResize: () => void;
}

/** Owns settings-card drag/resize listeners and its persistent geometry. */
export class SettingsDialogLayoutController {
  private readonly header: HTMLElement | null;
  private readonly resizeHandles: HTMLElement[];
  private interactionCleanup: (() => void) | null = null;
  private initialized = false;

  constructor(private readonly options: SettingsDialogLayoutControllerOptions) {
    this.header = options.card.querySelector<HTMLElement>(':scope > header');
    this.resizeHandles = Array.from(
      options.card.querySelectorAll<HTMLElement>('[data-settings-resize]'),
    );
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.header?.addEventListener('mousedown', this.onHeaderMouseDown);
    this.resizeHandles.forEach((handle) =>
      handle.addEventListener('mousedown', this.onResizeMouseDown),
    );
    window.addEventListener('resize', this.onWindowResize);
  }

  restore(saved: SettingsDialogSize | null | undefined): void {
    const fallback = saved?.customized ? saved : { width: 1080, height: 780 };
    const limits = this.limits();
    const width = clamp(Number(fallback.width) || 1080, limits.minWidth, limits.maxWidth);
    const height = clamp(Number(fallback.height) || 780, limits.minHeight, limits.maxHeight);
    this.setBounds({
      left: Math.round((window.innerWidth - width) / 2),
      top: Math.round((window.innerHeight - height) / 2),
      width,
      height,
    });
  }

  dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.interactionCleanup?.();
    this.interactionCleanup = null;
    this.header?.removeEventListener('mousedown', this.onHeaderMouseDown);
    this.resizeHandles.forEach((handle) =>
      handle.removeEventListener('mousedown', this.onResizeMouseDown),
    );
    window.removeEventListener('resize', this.onWindowResize);
  }

  private readonly onHeaderMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button')))
      return;
    const start = this.bounds();
    this.setBounds(start);
    const offsetX = event.clientX - start.left;
    const offsetY = event.clientY - start.top;
    const move = (moveEvent: MouseEvent): void => {
      this.setBounds({
        left: moveEvent.clientX - offsetX,
        top: moveEvent.clientY - offsetY,
        width: start.width,
        height: start.height,
      });
    };
    this.installInteraction(move, () => undefined);
  };

  private readonly onResizeMouseDown = (event: MouseEvent): void => {
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement) || event.button !== 0) return;
    const edge = handle.dataset.settingsResize;
    if (!edge) return;
    event.preventDefault();
    event.stopPropagation();
    const start = this.bounds();
    const right = start.left + start.width;
    const bottom = start.top + start.height;
    this.setBounds(start);
    document.body.classList.add('settings-card-resizing');
    const move = (moveEvent: MouseEvent): void => {
      const limits = this.limits();
      const width = edge.includes('w')
        ? clamp(start.width - (moveEvent.clientX - event.clientX), limits.minWidth, limits.maxWidth)
        : edge.includes('e')
          ? clamp(
              start.width + (moveEvent.clientX - event.clientX),
              limits.minWidth,
              limits.maxWidth,
            )
          : start.width;
      const height = edge.includes('n')
        ? clamp(
            start.height - (moveEvent.clientY - event.clientY),
            limits.minHeight,
            limits.maxHeight,
          )
        : edge.includes('s')
          ? clamp(
              start.height + (moveEvent.clientY - event.clientY),
              limits.minHeight,
              limits.maxHeight,
            )
          : start.height;
      this.setBounds({
        left: edge.includes('w') ? right - width : start.left,
        top: edge.includes('n') ? bottom - height : start.top,
        width,
        height,
      });
    };
    this.installInteraction(move, () => {
      document.body.classList.remove('settings-card-resizing');
      const bounds = this.bounds();
      this.options.onPersist({
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        customized: true,
      });
    });
  };

  private readonly onWindowResize = (): void => {
    if (this.options.card.style.position === 'fixed') this.setBounds(this.bounds());
    this.options.onWindowResize();
  };

  private installInteraction(move: (event: MouseEvent) => void, complete: () => void): void {
    this.interactionCleanup?.();
    const up = (): void => {
      complete();
      this.interactionCleanup?.();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    this.interactionCleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (this.interactionCleanup) this.interactionCleanup = null;
    };
  }

  private limits(): { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number } {
    const maxWidth = Math.max(1, Math.floor(window.innerWidth * 0.9));
    const maxHeight = Math.max(1, Math.floor(window.innerHeight * 0.9));
    return {
      minWidth: Math.min(620, maxWidth),
      minHeight: Math.min(420, maxHeight),
      maxWidth,
      maxHeight,
    };
  }

  private bounds(): { left: number; top: number; width: number; height: number } {
    return {
      left: this.options.card.offsetLeft,
      top: this.options.card.offsetTop,
      width: this.options.card.offsetWidth,
      height: this.options.card.offsetHeight,
    };
  }

  private setBounds(bounds: { left: number; top: number; width: number; height: number }): void {
    const limits = this.limits();
    const width = clamp(bounds.width, limits.minWidth, limits.maxWidth);
    const height = clamp(bounds.height, limits.minHeight, limits.maxHeight);
    this.options.card.style.position = 'fixed';
    this.options.card.style.left = `${clamp(bounds.left, 0, Math.max(0, window.innerWidth - width))}px`;
    this.options.card.style.top = `${clamp(bounds.top, 0, Math.max(0, window.innerHeight - height))}px`;
    this.options.card.style.width = `${width}px`;
    this.options.card.style.height = `${height}px`;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
