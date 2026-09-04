import type { AppAPI, Unsubscribe } from '../types/bridges.js';

export interface WindowControllerOptions {
  readonly appAPI: Pick<
    AppAPI,
    'minimize' | 'maximize' | 'closeWindow' | 'onFullscreenChanged' | 'onMaximizedChanged'
  >;
  readonly titlebar: HTMLElement;
  readonly minimize: HTMLButtonElement;
  readonly maximize: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  readonly onFullscreenChanged: (fullscreen: boolean) => void;
  readonly onMaximizedChanged: (maximized: boolean) => void;
}

/** Owns titlebar commands and window-display subscriptions. */
export class WindowController {
  private readonly options: WindowControllerOptions;
  private readonly subscriptions: Unsubscribe[] = [];

  constructor(options: WindowControllerOptions) {
    this.options = options;
  }

  init(): void {
    const { appAPI, titlebar, minimize, maximize, close } = this.options;
    minimize.onclick = () => appAPI.minimize();
    maximize.onclick = () => appAPI.maximize();
    close.onclick = () => appAPI.closeWindow();
    titlebar.ondblclick = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('button')) appAPI.maximize();
    };
    this.subscriptions.push(appAPI.onFullscreenChanged(this.options.onFullscreenChanged));
    this.subscriptions.push(appAPI.onMaximizedChanged(this.options.onMaximizedChanged));
  }

  dispose(): void {
    this.options.minimize.onclick = null;
    this.options.maximize.onclick = null;
    this.options.close.onclick = null;
    this.options.titlebar.ondblclick = null;
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}
