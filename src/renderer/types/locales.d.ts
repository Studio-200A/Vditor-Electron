export type SupportedLocale = 'en_US' | 'zh_Hans' | 'zh_Hant';

export type LocaleDictionary = Readonly<Record<string, string>>;

export type VditorDesktopLocales = Readonly<Record<SupportedLocale, LocaleDictionary>>;

declare global {
  interface Window {
    VditorDesktopLocales: VditorDesktopLocales;
  }
}
