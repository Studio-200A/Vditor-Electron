import type { AppStore } from '../state/store.js';
import type { SupportedLocale, VditorDesktopLocales } from '../types/locales.js';
import { resolveLocale, translate } from './localization.js';

export interface LocalizationControllerOptions {
  readonly store: AppStore;
  readonly locales: VditorDesktopLocales;
  readonly navigatorLanguage: () => string;
  readonly onLocaleApplied: (locale: SupportedLocale) => void;
}

/** Owns locale resolution, application-owned translated DOM, and locale cleanup. */
export class LocalizationController {
  private readonly store: AppStore;
  private readonly locales: VditorDesktopLocales;
  private readonly navigatorLanguage: () => string;
  private readonly onLocaleApplied: (locale: SupportedLocale) => void;

  constructor(options: LocalizationControllerOptions) {
    this.store = options.store;
    this.locales = options.locales;
    this.navigatorLanguage = options.navigatorLanguage;
    this.onLocaleApplied = options.onLocaleApplied;
  }

  apply(requestedLocale: string): SupportedLocale {
    const locale = resolveLocale(requestedLocale, this.navigatorLanguage(), this.locales);
    this.store.updateLocale(locale);
    document.documentElement.lang =
      locale === 'zh_Hans' ? 'zh-Hans' : locale === 'zh_Hant' ? 'zh-Hant' : 'en-US';
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
      node.textContent = this.translate(locale, node.dataset.i18n ?? '');
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
      const value = this.translate(locale, node.dataset.i18nTitle ?? '');
      node.title = value;
      node.setAttribute('aria-label', value);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-tooltip]').forEach((node) => {
      const value = this.translate(locale, node.dataset.i18nTooltip ?? '');
      node.dataset.tooltip = value;
      node.setAttribute('aria-label', value);
    });
    document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = this.translate(locale, node.dataset.i18nPlaceholder ?? '');
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((label) => {
      Array.from(label.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .forEach((node) => node.remove());
      let text = label.querySelector<HTMLElement>(':scope > .i18n-label');
      if (!text) {
        text = document.createElement('span');
        text.className = 'i18n-label';
        label.insertBefore(text, label.firstChild);
      }
      text.textContent = this.translate(locale, label.dataset.i18nLabel ?? '');
    });
    this.onLocaleApplied(locale);
    return locale;
  }

  dispose(): void {
    // Locale application is synchronous and owns no subscriptions.
  }

  private translate(locale: SupportedLocale, key: string): string {
    return translate(this.locales, locale, key);
  }
}
