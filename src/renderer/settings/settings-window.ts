export interface SettingsWindowOptions {
  readonly modal: HTMLElement;
  readonly onClosed: (applyPresentation: boolean) => void;
}

/** Owns modal enter/exit timers; form validation and persistence stay in SettingsController. */
export class SettingsWindow {
  private readonly modal: HTMLElement;
  private readonly onClosed: (applyPresentation: boolean) => void;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly animationFrames = new Set<number>();

  constructor(options: SettingsWindowOptions) {
    this.modal = options.modal;
    this.onClosed = options.onClosed;
  }

  open(): void {
    this.clearCloseTimer();
    this.modal.classList.remove('hidden', 'modal-closing', 'modal-open');
    let first: number | null = null;
    first = requestAnimationFrame(() => {
      if (first !== null) this.animationFrames.delete(first);
      let second: number | null = null;
      second = requestAnimationFrame(() => {
        if (second !== null) this.animationFrames.delete(second);
        this.modal.classList.add('modal-open');
      });
      this.animationFrames.add(second);
    });
    this.animationFrames.add(first);
  }

  close(applyPresentation = true): Promise<void> {
    if (this.modal.classList.contains('hidden')) return Promise.resolve();
    if (this.modal.classList.contains('modal-closing'))
      return new Promise((resolve) => setTimeout(resolve, 190));
    this.clearCloseTimer();
    this.modal.classList.remove('modal-open');
    this.modal.classList.add('modal-closing');
    const duration = parseFloat(
      getComputedStyle(this.modal).getPropertyValue('--settings-exit-duration'),
    );
    return new Promise((resolve) => {
      this.closeTimer = setTimeout(
        () => {
          this.closeTimer = null;
          this.modal.classList.add('hidden');
          this.modal.classList.remove('modal-closing');
          this.onClosed(applyPresentation);
          resolve();
        },
        Number.isFinite(duration) ? duration + 30 : 190,
      );
    });
  }

  dispose(): void {
    this.clearCloseTimer();
    for (const frame of this.animationFrames) cancelAnimationFrame(frame);
    this.animationFrames.clear();
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }
}
