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
});
