import type { Controller } from '../core/controller.js';

export interface StatusMenuControllerOptions {
  readonly document: Document;
  readonly modeTrigger: HTMLElement;
  readonly modeMenu: HTMLElement;
  readonly themeTrigger: HTMLElement;
  readonly themeMenu: HTMLElement;
  readonly getMode: () => string | null;
  readonly onBeforeThemeOpen: () => void;
  readonly onSelectMode: (mode: string) => void;
  readonly onSelectThemeMode: (mode: string) => void | Promise<void>;
}

export interface ThemeModePresentation {
  readonly mode: string;
  readonly label: string;
  readonly labelKey: string;
}

/** Owns the status-bar popup DOM and its document-level dismissal listener. */
export class StatusMenuController implements Controller {
  private initialized = false;

  constructor(private readonly options: StatusMenuControllerOptions) {}

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const { modeTrigger, modeMenu, themeTrigger, themeMenu, document } = this.options;
    modeTrigger.addEventListener('click', this.onModeTriggerClick);
    modeTrigger.addEventListener('keydown', this.onModeTriggerKeyDown);
    modeMenu.addEventListener('click', this.onModeMenuClick);
    themeTrigger.addEventListener('click', this.onThemeTriggerClick);
    themeMenu.addEventListener('click', this.onThemeMenuClick);
    document.addEventListener('click', this.closeAll);
  }

  syncMode(mode: string): void {
    this.options.modeMenu.querySelectorAll<HTMLElement>('[data-status-mode]').forEach((button) => {
      const selected = button.dataset.statusMode === mode;
      button.setAttribute('aria-checked', String(selected));
      const checkmark = button.querySelector<HTMLElement>('.checkmark');
      if (checkmark) checkmark.textContent = selected ? '✓' : '';
    });
  }

  syncTheme(presentation: ThemeModePresentation): void {
    const { themeTrigger, themeMenu } = this.options;
    const icon = themeTrigger.querySelector<HTMLElement>('#statusThemeIcon');
    if (icon) icon.className = `theme-mode-icon theme-mode-icon-${presentation.mode}`;
    themeTrigger.dataset.themeMode = presentation.mode;
    themeTrigger.dataset.i18nTitle = presentation.labelKey;
    themeTrigger.title = presentation.label;
    themeTrigger.setAttribute('aria-label', presentation.label);
    themeMenu.querySelectorAll<HTMLElement>('[data-theme-mode]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.themeMode === presentation.mode));
    });
  }

  closeMode = (): void => {
    this.options.modeMenu.classList.add('hidden');
    this.options.modeTrigger.setAttribute('aria-expanded', 'false');
  };

  closeTheme = (): void => {
    this.options.themeMenu.classList.add('hidden');
    this.options.themeTrigger.setAttribute('aria-expanded', 'false');
  };

  closeAll = (): void => {
    this.closeMode();
    this.closeTheme();
  };

  isModeOpen(): boolean {
    return !this.options.modeMenu.classList.contains('hidden');
  }

  isThemeOpen(): boolean {
    return !this.options.themeMenu.classList.contains('hidden');
  }

  dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    const { modeTrigger, modeMenu, themeTrigger, themeMenu, document } = this.options;
    modeTrigger.removeEventListener('click', this.onModeTriggerClick);
    modeTrigger.removeEventListener('keydown', this.onModeTriggerKeyDown);
    modeMenu.removeEventListener('click', this.onModeMenuClick);
    themeTrigger.removeEventListener('click', this.onThemeTriggerClick);
    themeMenu.removeEventListener('click', this.onThemeMenuClick);
    document.removeEventListener('click', this.closeAll);
    this.closeAll();
  }

  private readonly onModeTriggerClick = (event: MouseEvent): void => {
    event.stopPropagation();
    this.toggleMode();
  };

  private readonly onModeTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleMode();
  };

  private readonly onModeMenuClick = (event: MouseEvent): void => {
    const button = this.menuButton(event.target, '[data-status-mode]');
    if (!button?.dataset.statusMode) return;
    event.stopPropagation();
    this.closeMode();
    this.options.onSelectMode(button.dataset.statusMode);
  };

  private readonly onThemeTriggerClick = (event: MouseEvent): void => {
    event.stopPropagation();
    this.toggleTheme();
  };

  private readonly onThemeMenuClick = (event: MouseEvent): void => {
    const button = this.menuButton(event.target, '[data-theme-mode]');
    if (!button?.dataset.themeMode) return;
    event.stopPropagation();
    this.closeTheme();
    void this.options.onSelectThemeMode(button.dataset.themeMode);
  };

  private toggleMode(): void {
    if (!this.options.getMode()) return;
    const willOpen = this.options.modeMenu.classList.contains('hidden');
    if (!willOpen) {
      this.closeMode();
      return;
    }
    this.closeTheme();
    this.syncMode(this.options.getMode()!);
    this.options.modeMenu.classList.remove('hidden');
    this.options.modeTrigger.setAttribute('aria-expanded', 'true');
  }

  private toggleTheme(): void {
    const willOpen = this.options.themeMenu.classList.contains('hidden');
    if (!willOpen) {
      this.closeTheme();
      return;
    }
    this.closeMode();
    this.options.onBeforeThemeOpen();
    this.options.themeMenu.classList.remove('hidden');
    this.options.themeTrigger.setAttribute('aria-expanded', 'true');
  }

  private menuButton(target: EventTarget | null, selector: string): HTMLElement | null {
    const element = target instanceof Element ? target : null;
    return element?.closest<HTMLElement>(selector) ?? null;
  }
}
