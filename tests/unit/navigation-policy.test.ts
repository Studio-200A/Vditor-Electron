import { describe, expect, it } from 'vitest';
import { classifyNavigation } from '../../src/main/navigation-policy';

describe('navigation policy', () => {
  it('keeps the trusted renderer page inside the application', () => {
    expect(classifyNavigation('app://app/index.html#settings')).toEqual({ kind: 'internal' });
    expect(classifyNavigation('app://app/vditor/dist/index.css')).toEqual({ kind: 'blocked' });
    expect(classifyNavigation('app://evil/index.html')).toEqual({ kind: 'blocked' });
  });

  it('delegates supported external URLs and rejects everything else', () => {
    expect(classifyNavigation('HTTPS://example.com/docs')).toEqual({
      kind: 'external',
      url: 'https://example.com/docs',
    });
    expect(classifyNavigation('mailto:author@example.com')).toEqual({
      kind: 'external',
      url: 'mailto:author@example.com',
    });

    for (const value of [
      undefined,
      'javascript:alert(1)',
      ' data:text/html,unsafe',
      'https://example.com/\njavascript:alert(1)',
      'https://example.com/%ZZ',
    ]) {
      expect(classifyNavigation(value)).toEqual({ kind: 'blocked' });
    }
  });
});
