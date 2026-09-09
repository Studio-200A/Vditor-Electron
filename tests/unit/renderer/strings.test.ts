import { describe, expect, it } from 'vitest';
import { escapeHTML, fileName, stripExtension } from '../../../src/renderer/utils/strings';

describe('escapeHTML', () => {
  it('escapes angle brackets and ampersand', () => {
    expect(escapeHTML('<div class="a">&</div>')).toBe(
      '&lt;div class=&quot;a&quot;&gt;&amp;&lt;/div&gt;',
    );
  });

  it('escapes single quotes', () => {
    expect(escapeHTML("it's")).toBe('it&#39;s');
  });

  it('converts non-string input to string', () => {
    expect(escapeHTML(42)).toBe('42');
    expect(escapeHTML(null)).toBe('null');
    expect(escapeHTML(undefined)).toBe('undefined');
  });

  it('returns an empty string for empty input', () => {
    expect(escapeHTML('')).toBe('');
  });

  it('does not modify strings without special characters', () => {
    expect(escapeHTML('hello world')).toBe('hello world');
  });
});

describe('fileName', () => {
  it('extracts file name from a Unix path', () => {
    expect(fileName('/home/user/doc.md')).toBe('doc.md');
  });

  it('extracts file name from a Windows path', () => {
    expect(fileName('C:\\Users\\user\\doc.md')).toBe('doc.md');
  });

  it('returns the full string when no separator is present', () => {
    expect(fileName('doc.md')).toBe('doc.md');
  });

  it('returns an empty string for empty input', () => {
    expect(fileName('')).toBe('');
  });

  it('returns an empty string for falsy input', () => {
    expect(fileName(null as unknown as string)).toBe('');
    expect(fileName(undefined as unknown as string)).toBe('');
  });

  it('handles trailing separators', () => {
    expect(fileName('/home/user/')).toBe('');
  });
});

describe('stripExtension', () => {
  it('removes .md extension', () => {
    expect(stripExtension('readme.md')).toBe('readme');
  });

  it('removes .markdown extension', () => {
    expect(stripExtension('readme.markdown')).toBe('readme');
  });

  it('is case-insensitive', () => {
    expect(stripExtension('README.MD')).toBe('README');
    expect(stripExtension('README.Markdown')).toBe('README');
  });

  it('does not remove other extensions', () => {
    expect(stripExtension('image.png')).toBe('image.png');
    expect(stripExtension('style.css')).toBe('style.css');
  });

  it('does not modify names without extensions', () => {
    expect(stripExtension('README')).toBe('README');
  });
});
