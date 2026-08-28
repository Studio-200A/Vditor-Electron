import { describe, expect, it } from 'vitest';
import { isTrustedAppPageUrl, isTrustedAppResourceUrl } from '../../src/main/app-url';

describe('application protocol URL policy', () => {
  it('accepts only the trusted app origin for bundled resources', () => {
    for (const value of [
      'app://app/index.html',
      'app://app/vditor/dist/index.css',
      'APP://APP/assets/app-icon/vditor-desktop.svg',
    ]) {
      expect(isTrustedAppResourceUrl(value)).toBe(true);
    }

    for (const value of [
      undefined,
      42,
      '',
      'app://evil/index.html',
      'app://app.evil/index.html',
      'app://app@evil/index.html',
      'app://app:4321/index.html',
      'https://app/index.html',
      'app://app/\nindex.html',
      'app://app/\u0000index.html',
      'app://app/%ZZ',
    ]) {
      expect(isTrustedAppResourceUrl(value)).toBe(false);
    }
  });

  it('allows only the renderer document as a top-level app page', () => {
    for (const value of ['app://app/', 'app://app/index.html', 'APP://APP/index.html#settings']) {
      expect(isTrustedAppPageUrl(value)).toBe(true);
    }

    for (const value of [
      'app://app/vditor/dist/index.css',
      'app://app/assets/app-icon/vditor-desktop.svg',
      'app://app/index.html?redirect=https://example.com',
      'app://app/%69ndex.html',
      'app://evil/index.html',
      'javascript:alert(1)',
    ]) {
      expect(isTrustedAppPageUrl(value)).toBe(false);
    }
  });
});
