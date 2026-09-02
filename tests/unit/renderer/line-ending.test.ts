import { describe, expect, it } from 'vitest';
import { detectLineEnding } from '../../../src/renderer/utils/line-ending';

describe('detectLineEnding', () => {
  it('detects CRLF line endings', () => {
    expect(detectLineEnding('hello\r\nworld')).toBe('CRLF');
  });

  it('detects LF line endings', () => {
    expect(detectLineEnding('hello\nworld')).toBe('LF');
  });

  it('defaults to LF for content without line breaks', () => {
    expect(detectLineEnding('hello world')).toBe('LF');
  });

  it('defaults to LF for empty content', () => {
    expect(detectLineEnding('')).toBe('LF');
  });

  it('detects CRLF when mixed with LF', () => {
    expect(detectLineEnding('a\r\nb\nc')).toBe('CRLF');
  });
});
