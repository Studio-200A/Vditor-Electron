import type { Controller } from '../core/controller.js';
import { DisposableBag, type Cleanup } from '../core/disposables.js';

export interface ApplicationShellResources {
  add(cleanup: Cleanup): void;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  observeResize(observer: ResizeObserver): void;
  observeMutations(observer: MutationObserver): void;
  timeout(id: ReturnType<typeof setTimeout>): void;
  animationFrame(id: number): void;
}

export interface ApplicationShellControllerOptions {
  document: Document;
  setup(resources: ApplicationShellResources): void;
}

/** Owns application-shell DOM resources that do not belong to a domain controller. */
export class ApplicationShellController implements Controller {
  private readonly resources = new DisposableBag();
  private initialized = false;

  constructor(private readonly options: ApplicationShellControllerOptions) {}

  init(): void {
    if (this.initialized || this.resources.isDisposed) return;
    this.initialized = true;
    this.options.setup(this);
    this.trackPropertyHandlers();
  }

  add(cleanup: Cleanup): void {
    this.resources.add(cleanup);
  }

  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.resources.addEventListener(target, type, listener, options);
  }

  observeResize(observer: ResizeObserver): void {
    this.resources.addObserver(observer);
  }

  observeMutations(observer: MutationObserver): void {
    this.resources.addObserver(observer);
  }

  timeout(id: ReturnType<typeof setTimeout>): void {
    this.resources.addTimeout(id);
  }

  animationFrame(id: number): void {
    this.resources.addAnimationFrame(id);
  }

  private trackPropertyHandlers(): void {
    const properties = ['onclick', 'oninput', 'onkeydown', 'onmousedown'] as const;
    for (const element of this.options.document.querySelectorAll<HTMLElement>('*')) {
      for (const property of properties) {
        const listener = element[property];
        if (!listener) continue;
        this.resources.add(() => {
          if (element[property] === listener) element[property] = null;
        });
      }
    }
  }

  dispose(): void {
    this.resources.dispose();
    this.initialized = false;
  }
}
