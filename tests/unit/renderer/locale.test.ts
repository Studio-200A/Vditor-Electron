import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { en_US } from '../../../src/renderer/locale/en_US.js';
import { zh_Hans } from '../../../src/renderer/locale/zh_Hans.js';
import { zh_Hant } from '../../../src/renderer/locale/zh_Hant.js';

const locales = { en_US, zh_Hans, zh_Hant };

function placeholders(value: string): string[] {
  return [...new Set(Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]))].sort();
}

describe('renderer locale dictionaries', () => {
  it('keeps the same keys and placeholders in all three languages', () => {
    const english: Record<string, string> = en_US;
    const englishKeys = Object.keys(english);
    expect(englishKeys.length).toBeGreaterThan(0);

    for (const locale of [zh_Hans, zh_Hant]) {
      const translations: Record<string, string> = locale;
      expect(Object.keys(locale)).toEqual(englishKeys);
      for (const key of englishKeys) {
        expect(placeholders(translations[key])).toEqual(placeholders(english[key]));
      }
    }
  });

  it('publishes the three dictionaries from the bundled startup entry', async () => {
    const result = await build({
      entryPoints: ['src/renderer/locale/index.ts'],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      write: false,
      outfile: 'locales.js',
    });
    const localeWindow: { VditorDesktopLocales?: typeof locales } = {};
    new Function('window', result.outputFiles[0].text)(localeWindow);
    expect(localeWindow.VditorDesktopLocales).toEqual(locales);
  });
});
