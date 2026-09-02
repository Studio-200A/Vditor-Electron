/**
 * Keeps a renderer-approved close scoped to the BrowserWindow that requested it.
 * A replacement window (such as one created by macOS activate) must ask again.
 */
export class WindowCloseConfirmation<TWindow extends object> {
  private confirmedWindow: TWindow | null = null;

  confirm(window: TWindow): void {
    this.confirmedWindow = window;
  }

  isConfirmed(window: TWindow): boolean {
    return this.confirmedWindow === window;
  }

  clear(window: TWindow): void {
    if (this.confirmedWindow === window) this.confirmedWindow = null;
  }
}
