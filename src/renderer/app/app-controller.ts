import type { Controller } from '../core/controller.js';
import { DisposableBag } from '../core/disposables.js';

type StartupStep = () => void | Promise<void>;

export interface AppStartup {
  loadSettings: StartupStep;
  applyLocale: StartupStep;
  initializeUI: StartupStep;
  restoreWorkspace: StartupStep;
  restoreSession: StartupStep;
  restoreRecovery: StartupStep;
  finishRestoration: StartupStep;
  dispose: () => void;
}

export interface AppCommands {
  beforeShortcut(event: KeyboardEvent): boolean;
  selectAll(event: KeyboardEvent): void;
  save(saveAs: boolean): void;
  openFiles(): void;
  openFolder(): void;
  newDocument(): void;
  toggleSidebar(): void;
  find(): void;
  settings(): void;
  closeDocument(): void;
  closeWindow(): void;
  openPaths(paths: string[]): Promise<void>;
  menu(action: string, value?: string): void;
  rejectDrop(): void;
}

export interface AppControllerOptions {
  document: Document;
  window: Window;
  startup: AppStartup;
  commands: AppCommands;
  bridge: {
    onOpenFiles(callback: (paths: string[]) => void): () => void;
    onMenuAction(callback: (action: string, value?: string) => void): () => void;
    getDroppedPath(file: File): string;
    rendererReady(): void;
  };
  reportError(error: unknown): void;
}

/** Owns window command routing and startup order; domains own all data transitions. */
export class AppController implements Controller {
  private readonly resources = new DisposableBag();
  private initialization: Promise<void> | undefined;

  constructor(private readonly options: AppControllerOptions) {}

  init(): Promise<void> {
    if (this.resources.isDisposed) return Promise.resolve();
    this.initialization ??= this.start();
    return this.initialization;
  }

  private async start(): Promise<void> {
    const { startup, document, window, bridge } = this.options;
    this.resources.add(startup.dispose);
    this.resources.addEventListener(window, 'beforeunload', () => this.dispose());
    try {
      await startup.loadSettings();
      if (this.resources.isDisposed) return;
      await startup.applyLocale();
      if (this.resources.isDisposed) return;
      await startup.initializeUI();
      if (this.resources.isDisposed) return;
      this.connectCommands();
      for (const restore of [
        startup.restoreWorkspace,
        startup.restoreSession,
        startup.restoreRecovery,
        startup.finishRestoration,
      ]) {
        await restore();
        if (this.resources.isDisposed) return;
      }
      document.body.dataset.appReady = 'true';
      bridge.rendererReady();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private connectCommands(): void {
    const { bridge, document, commands } = this.options;
    const openPaths = (paths: string[]): void => {
      if (this.resources.isDisposed) return;
      void commands.openPaths(paths).catch(this.options.reportError);
    };
    this.resources.add(bridge.onOpenFiles(openPaths));
    this.resources.add(
      bridge.onMenuAction((action, value) => {
        if (!this.resources.isDisposed) commands.menu(action, value);
      }),
    );
    const keydown = (event: KeyboardEvent): void => this.routeShortcut(event);
    document.addEventListener('keydown', keydown);
    this.resources.add(() => document.removeEventListener('keydown', keydown));
    this.resources.addEventListener(document.body, 'dragover', (event) => event.preventDefault());
    const drop = (event: DragEvent): void => {
      event.preventDefault();
      const transfer = event.dataTransfer;
      if (!transfer) return;
      const paths = Array.from(transfer.files).map(bridge.getDroppedPath).filter(Boolean);
      const markdown = paths.filter((filePath) =>
        /\.(md|markdown|mdown|mkd|mkdn)$/i.test(filePath),
      );
      if (markdown.length) openPaths(markdown);
      else if (paths.length) commands.rejectDrop();
    };
    document.body.addEventListener('drop', drop);
    this.resources.add(() => document.body.removeEventListener('drop', drop));
  }

  private routeShortcut(event: KeyboardEvent): void {
    const { commands } = this.options;
    if (commands.beforeShortcut(event)) return;
    // Vditor 3.11.3 consumes editor gestures before this bubbling document listener.
    if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'a') {
      commands.selectAll(event);
      return;
    }
    const actions: Record<string, (() => void) | undefined> = {
      s: () => commands.save(event.shiftKey),
      n: commands.newDocument,
      f: commands.find,
      ',': commands.settings,
      w: commands.closeDocument,
      q: commands.closeWindow,
    };
    if (event.altKey && !event.shiftKey) {
      actions.o = commands.openFiles;
      actions.k = commands.openFolder;
      actions.b = commands.toggleSidebar;
    }
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  dispose(): void {
    this.resources.dispose();
    delete this.options.document.body.dataset.appReady;
  }
}
