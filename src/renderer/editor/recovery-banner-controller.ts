export type RecoveryBannerState = 'unchanged' | 'changed' | 'unavailable';

export interface RecoveryBannerTab {
  readonly recoveryState: RecoveryBannerState | null;
}

export interface RecoveryBannerControllerOptions<TTab extends RecoveryBannerTab> {
  readonly banner: HTMLElement;
  readonly message: HTMLElement;
  readonly detail: HTMLElement;
  readonly saveButton: HTMLElement;
  readonly saveAsButton: HTMLElement;
  readonly discardButton: HTMLElement;
  readonly getActiveTab: () => TTab | null;
  readonly translate: (key: string) => string;
  readonly onSave: (tab: TTab) => void;
  readonly onSaveAs: (tab: TTab) => void;
  readonly onDiscard: (tab: TTab) => void;
}

/** Renders the recovery banner and routes its actions without owning recovery state. */
export class RecoveryBannerController<TTab extends RecoveryBannerTab> {
  private readonly banner: HTMLElement;
  private readonly message: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly saveButton: HTMLElement;
  private readonly saveAsButton: HTMLElement;
  private readonly discardButton: HTMLElement;
  private readonly getActiveTab: RecoveryBannerControllerOptions<TTab>['getActiveTab'];
  private readonly translate: RecoveryBannerControllerOptions<TTab>['translate'];
  private readonly onSave: RecoveryBannerControllerOptions<TTab>['onSave'];
  private readonly onSaveAs: RecoveryBannerControllerOptions<TTab>['onSaveAs'];
  private readonly onDiscard: RecoveryBannerControllerOptions<TTab>['onDiscard'];

  constructor(options: RecoveryBannerControllerOptions<TTab>) {
    this.banner = options.banner;
    this.message = options.message;
    this.detail = options.detail;
    this.saveButton = options.saveButton;
    this.saveAsButton = options.saveAsButton;
    this.discardButton = options.discardButton;
    this.getActiveTab = options.getActiveTab;
    this.translate = options.translate;
    this.onSave = options.onSave;
    this.onSaveAs = options.onSaveAs;
    this.onDiscard = options.onDiscard;
    this.saveButton.addEventListener('click', this.save);
    this.saveAsButton.addEventListener('click', this.saveAs);
    this.discardButton.addEventListener('click', this.discard);
  }

  render(tab: TTab | null): void {
    const state = tab?.recoveryState;
    this.banner.classList.toggle('hidden', !state);
    if (!state) return;

    this.message.textContent = this.translate(
      state === 'changed'
        ? 'recovery.changed'
        : state === 'unavailable'
          ? 'recovery.unavailable'
          : 'recovery.restored',
    );
    this.detail.textContent = this.translate(
      state === 'changed'
        ? 'recovery.changedDetail'
        : state === 'unavailable'
          ? 'recovery.unavailableDetail'
          : 'recovery.restoredDetail',
    );
    this.saveButton.classList.toggle('hidden', state !== 'unchanged');
  }

  dispose(): void {
    this.saveButton.removeEventListener('click', this.save);
    this.saveAsButton.removeEventListener('click', this.saveAs);
    this.discardButton.removeEventListener('click', this.discard);
  }

  private readonly save = (): void => {
    const tab = this.getActiveTab();
    if (tab?.recoveryState) this.onSave(tab);
  };

  private readonly saveAs = (): void => {
    const tab = this.getActiveTab();
    if (tab?.recoveryState) this.onSaveAs(tab);
  };

  private readonly discard = (): void => {
    const tab = this.getActiveTab();
    if (tab?.recoveryState) this.onDiscard(tab);
  };
}
