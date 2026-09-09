import type { Controller } from './controller.js';

interface InitializedEntry {
  name: string;
  controller: Controller;
}

export class LifecycleManager {
  private initialized: InitializedEntry[] = [];

  async registerAndInit(name: string, controller: Controller): Promise<void> {
    try {
      await controller.init();
      this.initialized.push({ name, controller });
    } catch (error) {
      this.disposeInitialized();
      throw error;
    }
  }

  dispose(): void {
    this.disposeInitialized();
  }

  private disposeInitialized(): void {
    while (this.initialized.length > 0) {
      const entry = this.initialized.pop()!;
      try {
        entry.controller.dispose();
      } catch {
        // dispose failures must not block other cleanups
      }
    }
  }

  get count(): number {
    return this.initialized.length;
  }
}
