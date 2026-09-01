import { describe, expect, it } from 'vitest';
import {
  hasSvgImageContentType,
  isRemoteSvgImageUrl,
  shouldBlockRemoteSvgImage,
} from '../../src/main/remote-svg-policy';

describe('remote SVG image policy', () => {
  it('blocks HTTP(S) image URLs with an SVG path while disabled', () => {
    expect(isRemoteSvgImageUrl('https://example.com/image.SVG?version=1', 'image')).toBe(true);
    expect(shouldBlockRemoteSvgImage('https://example.com/image.svg', 'image', false)).toBe(true);
    expect(shouldBlockRemoteSvgImage('https://example.com/image.svg', 'image', true)).toBe(false);
  });

  it('blocks extensionless SVG image responses while disabled', () => {
    const headers = { 'Content-Type': ['image/svg+xml; charset=utf-8'] };
    expect(hasSvgImageContentType(headers)).toBe(true);
    expect(
      shouldBlockRemoteSvgImage('https://example.com/rendered-image', 'image', false, headers),
    ).toBe(true);
  });

  it('does not apply to non-image, non-HTTP(S), or non-SVG resources', () => {
    expect(shouldBlockRemoteSvgImage('https://example.com/image.svg', 'script', false)).toBe(false);
    expect(shouldBlockRemoteSvgImage('local-file://root/image.svg', 'image', false)).toBe(false);
    expect(
      shouldBlockRemoteSvgImage('https://example.com/image.png', 'image', false, {
        'content-type': ['image/png'],
      }),
    ).toBe(false);
  });
});
