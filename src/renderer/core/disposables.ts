export type Cleanup = () => void;

export class DisposableBag {
  private items: Cleanup[] = [];
  private disposed = false;

  add(cleanup: Cleanup): void {
    if (this.disposed) {
      cleanup();
      return;
    }
    this.items.push(cleanup);
  }

  addEventListener<E extends string>(
    target: EventTarget,
    type: E,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => target.removeEventListener(type, listener, options));
  }

  addTimeout(id: ReturnType<typeof setTimeout>): void {
    this.add(() => clearTimeout(id));
  }

  addAnimationFrame(id: number): void {
    this.add(() => cancelAnimationFrame(id));
  }

  addInterval(id: ReturnType<typeof setInterval>): void {
    this.add(() => clearInterval(id));
  }

  addObserver(observer: { disconnect(): void }): void {
    this.add(() => observer.disconnect());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    while (this.items.length > 0) {
      const cleanup = this.items.pop()!;
      try {
        cleanup();
      } catch {
        // cleanup failures must not block other cleanups
      }
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
