import type { VditorDesktopLocales } from '../types/locales.js';
import { en_US } from './en_US.js';
import { zh_Hans } from './zh_Hans.js';
import { zh_Hant } from './zh_Hant.js';

export const locales = { en_US, zh_Hans, zh_Hant } satisfies VditorDesktopLocales;

// The plain composition script reads this global before the main bundle starts.
window.VditorDesktopLocales = locales;
