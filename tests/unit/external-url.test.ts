import { describe, expect, it } from 'vitest';
import { allowedExternalUrl } from '../../src/main/external-url';

describe('external URL allowlist', () => {
  it('accepts the only protocols delegated to the system', () => {
    expect(allowedExternalUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(allowedExternalUrl('http://example.com')).toBe('http://example.com/');
    expect(allowedExternalUrl('mailto:author@example.com')).toBe('mailto:author@example.com');
  });

  it('rejects non-URL values and unsafe protocols', () => {
    for (const value of [
      undefined,
      42,
      '',
      '/local/document.md',
      'app://app/index.html',
      'file:///tmp/document.md',
      'javascript:alert(1)',
      'data:text/html,unsafe',
    ]) {
      expect(allowedExternalUrl(value)).toBeNull();
    }
  });

  it('normalizes protocol casing while rejecting invisible or encoded scheme tricks', () => {
    expect(allowedExternalUrl('HTTPS://example.com/docs')).toBe('https://example.com/docs');
    expect(allowedExternalUrl('MAILTO:author@example.com')).toBe('mailto:author@example.com');

    for (const value of [
      ' https://example.com/docs',
      'https://example.com/docs ',
      'https://example.com/\njavascript:alert(1)',
      '\u0000https://example.com/docs',
      'https://example.com/docs\u007f',
      'java%73cript:alert(1)',
      'https://example.com/%ZZ',
      'https://[::1',
    ]) {
      expect(allowedExternalUrl(value)).toBeNull();
    }
  });
});
