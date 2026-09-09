import { THEME_MODES, type ThemeMode } from './theme.js';
import {
  getPreferredCodeTheme,
  resolveContentTheme,
  resolveThemeMode,
  validateDarkTheme,
  validateLightTheme,
  type ThemeSettings,
} from './theme-controller.js';

interface ThemeVditor {
  setTheme(theme: string, contentTheme: string, codeTheme: string, baseUrl: string): void;
}

export interface ThemeCoordinatorTab {
  readonly host: HTMLElement | null;
  readonly toolbar: HTMLElement | null;
  readonly vditor: ThemeVditor | null;
}

export interface ThemeCoordinatorOptions<
  TSettings extends ThemeSettings,
  TTab extends ThemeCoordinatorTab,
> {
  readonly document: Document;
  readonly settingsForm: HTMLFormElement;
  readonly getSettings: () => TSettings;
  readonly replaceSettings: (settings: TSettings) => void;
  readonly getTabs: () => readonly TTab[];
  readonly getSystemTheme: () => Promise<string>;
  readonly isDarkTheme: (theme: string) => boolean;
  readonly persist: (patch: Partial<ThemeSettings>) => Promise<TSettings>;
  readonly syncStatusTheme: (mode: ThemeMode) => void;
  readonly classifyCodeThemeButtons: (
    toolbar: HTMLElement | null,
  ) => readonly { readonly button: HTMLElement; readonly tone: 'dark' | 'light' }[];
}

/** Coordinates applied theme state across browser chrome, settings controls, and Vditor tabs. */
export class ThemeCoordinator<TSettings extends ThemeSettings, TTab extends ThemeCoordinatorTab> {
  constructor(private readonly options: ThemeCoordinatorOptions<TSettings, TTab>) {}

  darkThemePreference(): string {
    return validateDarkTheme(this.options.getSettings().darkTheme);
  }

  lightThemePreference(): string {
    return validateLightTheme(this.options.getSettings().lightTheme);
  }

  mapSystemTheme(theme: string): string {
    return theme === 'dark' ? this.darkThemePreference() : this.lightThemePreference();
  }

  preferredCodeTheme(dark: boolean): string {
    return getPreferredCodeTheme(this.options.getSettings(), dark);
  }

  themeMode(): ThemeMode {
    return resolveThemeMode(this.options.getSettings());
  }

  syncThemeMode(): void {
    this.options.syncStatusTheme(this.themeMode());
  }

  syncCodeThemeControls(dark: boolean, codeTheme = this.preferredCodeTheme(dark)): void {
    this.syncCodeThemeSelect(dark, codeTheme);
    this.syncCodeThemeMenus(dark);
  }

  syncCodeThemeSelect(dark: boolean, codeTheme = this.preferredCodeTheme(dark)): void {
    this.syncCodeThemeSelectControl(dark, codeTheme);
  }

  syncContentThemeHosts(contentTheme: string): void {
    this.options.getTabs().forEach((tab) => {
      if (tab.host) tab.host.dataset.contentTheme = contentTheme;
    });
  }

  async resolveTheme(): Promise<string> {
    const settings = this.options.getSettings();
    return settings.systemTheme
      ? this.mapSystemTheme(await this.options.getSystemTheme())
      : settings.theme;
  }

  async applyTheme(theme: string): Promise<void> {
    const settings = this.options.getSettings();
    this.options.document.documentElement.dataset.theme = theme;
    this.options.document.querySelectorAll('link[id^="theme-"]').forEach((link) => {
      (link as HTMLLinkElement).disabled = link.id !== `theme-${theme}`;
    });
    const dark = this.options.isDarkTheme(theme);
    this.syncThemeMode();
    const contentTheme = resolveContentTheme(settings, dark);
    this.syncContentThemeHosts(contentTheme);
    const patch: Partial<ThemeSettings> = {};
    if (contentTheme !== settings.contentTheme) {
      settings.contentTheme = contentTheme;
      const select = this.options.settingsForm.elements.namedItem('contentTheme');
      if (select instanceof HTMLSelectElement) select.value = contentTheme;
      patch.contentTheme = contentTheme;
    }
    const codeTheme = this.preferredCodeTheme(dark);
    if (codeTheme !== settings.codeTheme) {
      settings.codeTheme = codeTheme;
      patch.codeTheme = codeTheme;
    }
    this.syncCodeThemeControls(dark, codeTheme);
    if (Object.keys(patch).length) await this.options.persist(patch);
    this.options.getTabs().forEach((tab) => {
      if (!tab.vditor) return;
      try {
        tab.vditor.setTheme(
          dark ? 'dark' : 'classic',
          contentTheme,
          codeTheme,
          'app://app/vditor/dist/css/content-theme',
        );
      } catch {
        // A tab can be disposed while Vditor is applying the shared presentation theme.
      }
    });
  }

  async selectThemeMode(mode: string): Promise<void> {
    if (!(THEME_MODES as readonly string[]).includes(mode) || mode === this.themeMode()) return;
    const patch =
      mode === 'system'
        ? { systemTheme: true }
        : {
            systemTheme: false,
            theme: mode === 'dark' ? this.darkThemePreference() : this.lightThemePreference(),
          };
    this.options.replaceSettings(await this.options.persist(patch));
    await this.applyTheme(await this.resolveTheme());
  }

  async selectApplicationTheme(theme: string): Promise<void> {
    const settings = this.options.getSettings();
    settings.theme = theme;
    settings.systemTheme = false;
    if (this.options.isDarkTheme(theme)) settings.darkTheme = theme;
    else settings.lightTheme = theme;
    await this.options.persist({
      theme,
      systemTheme: false,
      ...(this.options.isDarkTheme(theme) ? { darkTheme: theme } : { lightTheme: theme }),
    });
    await this.applyTheme(theme);
  }

  async selectContentTheme(contentTheme: string): Promise<void> {
    this.options.getSettings().contentTheme = contentTheme;
    this.syncContentThemeHosts(contentTheme);
    await this.options.persist({ contentTheme });
    if (contentTheme === 'light' || contentTheme === 'dark')
      await this.applyTheme(
        this.options.document.documentElement.dataset.theme || this.options.getSettings().theme,
      );
  }

  async selectCodeTheme(codeTheme: string, dark: boolean): Promise<void> {
    const settings = this.options.getSettings();
    const preferenceKey = dark ? 'darkCodeTheme' : 'lightCodeTheme';
    settings.codeTheme = codeTheme;
    settings[preferenceKey] = codeTheme;
    this.syncCodeThemeSelectControl(dark, codeTheme);
    await this.options.persist({ codeTheme, [preferenceKey]: codeTheme });
  }

  private syncCodeThemeSelectControl(dark: boolean, codeTheme: string): void {
    const select = this.options.settingsForm.elements.namedItem('codeTheme');
    if (!(select instanceof HTMLSelectElement)) return;
    let option = Array.from(select.options).find((item) => item.value === codeTheme);
    if (!option && codeTheme) {
      option = new Option(codeTheme, codeTheme);
      option.dataset.themeTone = dark ? 'dark' : 'light';
      select.add(option);
    }
    const tone = dark ? 'dark' : 'light';
    Array.from(select.options).forEach((item) => {
      const allowed = item.dataset.themeTone === tone;
      item.hidden = !allowed;
      item.disabled = !allowed;
    });
    select.value = codeTheme;
  }

  private syncCodeThemeMenus(dark: boolean): void {
    this.options.getTabs().forEach((tab) => {
      this.options.classifyCodeThemeButtons(tab.toolbar).forEach(({ button, tone }) => {
        button.dataset.themeTone = tone;
        button.hidden = tone !== (dark ? 'dark' : 'light');
      });
    });
  }
}
