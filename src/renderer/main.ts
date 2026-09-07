import type { Controller } from './core/controller.js';

declare global {
  interface Window {
    __vditorDesktopApplication?: Controller;
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
      '<div class="fatal"><h1>Application resources failed to load</h1><p>Please run npm run build again.</p></div>';
    console.error('[main]', error);
    return;
  }

  try {
    const application = window.__vditorDesktopApplication;
    if (!application) throw new Error('Application composition not available');
    await application.init();
  } catch (error) {
    console.error('[main] Failed to initialize:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    main();
  });
} else {
  main();
}
