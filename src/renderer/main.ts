import type { Controller } from './core/controller.js';
import { LifecycleManager } from './core/lifecycle.js';

declare global {
  interface Window {
    __vditorDesktopLegacyBootstrap?: () => Promise<void>;
  }
}

class LegacyAppController implements Controller {
  private bootstrap: (() => Promise<void>) | undefined;

  constructor() {
    this.bootstrap = window.__vditorDesktopLegacyBootstrap;
  }

  async init(): Promise<void> {
    if (!this.bootstrap) {
      throw new Error('Legacy bootstrap not available');
    }
    await this.bootstrap();
  }

  dispose(): void {
    // legacy app.js does not have a dispose mechanism yet
  }
}

function validateGlobalAPIs(): void {
  const missing: string[] = [];
  if (typeof Vditor === 'undefined') missing.push('Vditor');
  if (!window.VditorDesktopAdapter) missing.push('VditorDesktopAdapter');
  if (!window.fileAPI) missing.push('fileAPI');
  if (!window.appAPI) missing.push('appAPI');
  if (missing.length > 0) {
    throw new Error(`Missing required global APIs: ${missing.join(', ')}`);
  }
}

async function main(): Promise<void> {
  try {
    validateGlobalAPIs();
  } catch (error) {
    document.body.innerHTML =
      '<div class="fatal"><h1>应用资源加载失败</h1><p>请重新运行 npm run build。</p></div>';
    console.error('[main]', error);
    return;
  }

  const lifecycle = new LifecycleManager();

  const handleDispose = (): void => {
    lifecycle.dispose();
  };

  try {
    await lifecycle.registerAndInit('legacy-app', new LegacyAppController());
  } catch (error) {
    console.error('[main] Failed to initialize:', error);
    handleDispose();
    return;
  }

  window.addEventListener('beforeunload', handleDispose, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    main();
  });
} else {
  main();
}
