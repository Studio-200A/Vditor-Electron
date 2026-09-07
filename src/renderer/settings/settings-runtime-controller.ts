import { classifySettingsChange } from './settings-controller.js';
import type { SettingsController } from './settings-controller.js';

interface SettingsRecord extends Record<string, unknown> {
  readonly systemTheme?: boolean;
  readonly theme?: string;
  readonly lightCodeTheme?: string;
  readonly darkCodeTheme?: string;
  readonly codeTheme?: string;
  readonly toolbarConfig?: unknown;
  readonly workspaceReadDepth?: unknown;
  readonly allowSvgImages?: boolean;
}

interface ConfirmAction {
  readonly id: string;
  readonly label: string;
  readonly primary?: boolean;
  readonly danger?: boolean;
}

interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly actions: readonly ConfirmAction[];
  readonly draggable: boolean;
}

export interface SettingsRuntimeControllerOptions {
  readonly form: HTMLFormElement;
  readonly settingsController: Pick<SettingsController, 'savePatch'>;
  readonly getSettings: () => SettingsRecord;
  readonly getDefaultSettings: () => SettingsRecord | null;
  readonly initializationSettings: ReadonlySet<string>;
  readonly getAppliedTheme: () => string;
  readonly isDarkTheme: (theme: string) => boolean;
  readonly preferredCodeTheme: (dark: boolean) => string;
  readonly syncCodeThemeSelect: (dark: boolean, codeTheme: string) => void;
  readonly syncPreviewZoomVisibility: () => void;
  readonly syncEditorTextWidthValue: () => void;
  readonly syncWorkspaceReadDepthValue: () => void;
  readonly restoreDialogLayout: () => void;
  readonly openWindow: () => void;
  readonly closeWindow: () => Promise<void>;
  readonly showConfirmDialog: (options: ConfirmOptions) => Promise<string>;
  readonly translate: (key: string) => string;
  readonly showMessage: (message: string, error?: boolean) => void;
  readonly errorMessage: (error: unknown) => string;
  readonly reloadImages: () => void;
  readonly applyLocale: (locale: string) => void;
  readonly hasWorkspace: () => boolean;
  readonly setWorkspaceWatch: (depth: unknown) => Promise<void>;
  readonly refreshWorkspaceTree: () => Promise<void>;
  readonly applyPresentation: () => void;
  readonly resolveTheme: () => Promise<string>;
  readonly applyTheme: (theme: string) => Promise<void>;
  readonly applyLiveEditorSettings: (changedKeys: readonly string[]) => void;
  readonly rebuildEditors: () => void;
  readonly refreshToolbarPreview: () => void;
}

/** Owns settings form synchronization, guarded live saves, and runtime effect dispatch. */
export class SettingsRuntimeController {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: SettingsRuntimeControllerOptions) {}

  open(): void {
    this.syncForm(this.options.getSettings());
    const settings = this.options.getSettings();
    this.options.syncCodeThemeSelect(
      this.options.isDarkTheme(this.options.getAppliedTheme()),
      String(settings.codeTheme ?? ''),
    );
    this.options.syncPreviewZoomVisibility();
    this.options.syncEditorTextWidthValue();
    this.options.syncWorkspaceReadDepthValue();
    this.options.restoreDialogLayout();
    this.options.openWindow();
  }

  async save(closeAfterSave = true, overrides: Record<string, unknown> = {}): Promise<void> {
    this.clearSaveTimer();
    if (this.disposed) return;
    const previous = { ...this.options.getSettings() };
    const patch = { ...this.createPatch(previous), ...overrides };
    try {
      await this.options.settingsController.savePatch(patch);
    } catch (error) {
      this.options.showMessage(this.options.errorMessage(error), true);
      return;
    }
    if (this.disposed) return;

    const next = this.options.getSettings();
    const change = classifySettingsChange(previous, next, this.options.initializationSettings);
    if (change.changedKeys.includes('allowSvgImages')) this.options.reloadImages();
    if (closeAfterSave) await this.options.closeWindow();
    if (this.disposed) return;

    if (change.impacts.has('locale')) this.options.applyLocale(String(next.locale ?? ''));
    if (change.impacts.has('workspace-watch') && this.options.hasWorkspace()) {
      await this.options.setWorkspaceWatch(next.workspaceReadDepth);
    }
    if (
      (change.impacts.has('workspace-watch') || change.impacts.has('locale')) &&
      this.options.hasWorkspace()
    ) {
      await this.options.refreshWorkspaceTree();
    }
    if (change.impacts.has('presentation')) this.options.applyPresentation();
    // Vditor refreshes its mode surfaces through setTheme; presentation changes must retain this
    // existing non-rebuild refresh so their undo history remains intact.
    if (change.impacts.has('theme') || change.impacts.has('presentation'))
      await this.options.applyTheme(await this.options.resolveTheme());
    if (change.impacts.has('live-editor')) this.options.applyLiveEditorSettings(change.changedKeys);
    if (change.shouldRebuildEditor) this.options.rebuildEditors();
    this.options.refreshToolbarPreview();
    this.options.showMessage(this.options.translate('message.settingsSaved'));
  }

  async resetCurrentPage(activePanel: HTMLElement | null): Promise<void> {
    const defaults = this.options.getDefaultSettings();
    if (!activePanel || !defaults) return;
    this.syncForm(defaults, activePanel);
    const appearanceOverrides =
      activePanel.dataset.settingsPanel === 'appearance'
        ? {
            systemTheme: defaults.systemTheme,
            theme: defaults.theme,
            lightTheme: defaults.lightTheme,
            darkTheme: defaults.darkTheme,
            lightCodeTheme: defaults.lightCodeTheme,
            darkCodeTheme: defaults.darkCodeTheme,
          }
        : {};
    await this.save(false, appearanceOverrides);
  }

  async scheduleLiveSave(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.name || this.disposed) return;
    if (!(await this.confirmDangerousChange(input))) return;
    if (
      (input.type === 'number' || input.type === 'range') &&
      (!input.value || !input.validity.valid)
    )
      return;
    this.clearSaveTimer();
    this.saveTimer = setTimeout(
      () => {
        this.saveTimer = null;
        void this.save(false);
      },
      input.type === 'text' || input.type === 'number' ? 250 : 0,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.clearSaveTimer();
  }

  private syncForm(settings: SettingsRecord, scope: ParentNode = this.options.form): void {
    for (const input of scope.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]')) {
      const value = settings[input.name];
      if (input instanceof HTMLInputElement && input.type === 'checkbox')
        input.checked = Boolean(value);
      else if (input instanceof HTMLInputElement && input.type === 'radio')
        input.checked = input.value === value;
      else if (value !== undefined) input.value = String(value);
    }
  }

  private createPatch(previous: SettingsRecord): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    const numericNames = new Set(['tabSize']);
    for (const input of this.options.form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[name]',
    )) {
      if (input instanceof HTMLInputElement && input.type === 'radio' && !input.checked) continue;
      if (
        input instanceof HTMLInputElement &&
        (input.type === 'number' || input.type === 'range') &&
        (!input.value || !input.validity.valid)
      )
        continue;
      const isNumeric =
        input instanceof HTMLInputElement && (input.type === 'number' || input.type === 'range');
      patch[input.name] =
        input instanceof HTMLInputElement && input.type === 'checkbox'
          ? input.checked
          : isNumeric || input.name.endsWith('Zoom') || numericNames.has(input.name)
            ? Number(input.value)
            : input.value;
    }
    const appliedTheme = this.options.getAppliedTheme() || String(previous.theme ?? '');
    patch.systemTheme = previous.systemTheme;
    patch.theme = previous.systemTheme
      ? previous.theme
      : this.options.isDarkTheme(appliedTheme)
        ? patch.darkTheme
        : patch.lightTheme;
    const dark = previous.systemTheme
      ? this.options.isDarkTheme(appliedTheme)
      : this.options.isDarkTheme(String(patch.theme));
    patch.lightCodeTheme = previous.lightCodeTheme;
    patch.darkCodeTheme = previous.darkCodeTheme;
    patch[dark ? 'darkCodeTheme' : 'lightCodeTheme'] = patch.codeTheme;
    patch.toolbarConfig = previous.toolbarConfig;
    return patch;
  }

  private async confirmDangerousChange(input: HTMLInputElement): Promise<boolean> {
    const settings = this.options.getSettings();
    if (input.name === 'allowSvgImages' && input.checked && !settings.allowSvgImages) {
      const action = await this.options.showConfirmDialog({
        title: this.options.translate('settings.allowSvgImagesWarningTitle'),
        message: this.options.translate('settings.allowSvgImagesWarningMessage'),
        detail: this.options.translate('settings.allowSvgImagesWarningDetail'),
        actions: [
          { id: 'cancel', label: this.options.translate('settings.keepSvgImagesBlocked') },
          {
            id: 'confirm',
            label: this.options.translate('settings.allowSvgImagesAnyway'),
            primary: true,
            danger: true,
          },
        ],
        draggable: true,
      });
      if (action !== 'confirm') input.checked = false;
      return action === 'confirm';
    }
    if (input.name === 'sanitize' && !input.checked && settings.sanitize) {
      const action = await this.options.showConfirmDialog({
        title: this.options.translate('settings.sanitizeWarningTitle'),
        message: this.options.translate('settings.sanitizeWarningMessage'),
        detail: this.options.translate('settings.sanitizeWarningDetail'),
        actions: [
          { id: 'cancel', label: this.options.translate('settings.keepHtmlFilter') },
          {
            id: 'confirm',
            label: this.options.translate('settings.disableHtmlFilter'),
            primary: true,
            danger: true,
          },
        ],
        draggable: true,
      });
      if (action !== 'confirm') input.checked = true;
      return action === 'confirm';
    }
    return true;
  }

  private clearSaveTimer(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
}
