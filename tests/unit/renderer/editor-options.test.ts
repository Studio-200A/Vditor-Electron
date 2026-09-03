import { describe, expect, it, vi } from 'vitest';
import {
  createEditorOptions,
  effectiveToolbarItems,
  VDITOR_INITIALIZATION_SETTINGS,
} from '../../../src/renderer/editor/editor-options.js';

const settings = {
  theme: 'classic',
  iconSet: 'ant' as const,
  placeholder: '',
  typewriterMode: false,
  tabInsertSpaces: true,
  tabSize: 2,
  rtl: false,
  toolbarItems: ['bold'],
  previewMode: 'both' as const,
  previewDelay: 500,
  previewMaxWidth: 768,
  multiPlatformPreview: true,
  enableHighlight: true,
  lineNumbers: true,
  codeTheme: 'github',
  mathEngine: 'KaTeX' as const,
  enableAutoSpace: true,
  enableCallout: true,
  enableFootnotes: true,
  enableImageCaption: true,
  enableMark: true,
  enableSub: true,
  enableSup: true,
  toc: true,
  paragraphBeginningSpace: false,
  fixTermTypo: false,
  gfmAutoLink: true,
  listStyle: true,
  sanitize: true,
  contentTheme: 'light',
};

describe('editor options', () => {
  it('preserves the internal outline toolbar item required by Vditor mode transitions', () => {
    expect(effectiveToolbarItems(['bold'], ['italic'])).toEqual(['bold', 'outline']);
    expect(effectiveToolbarItems(['outline', 'bold'], ['italic'])).toEqual(['outline', 'bold']);
  });

  it('creates offline options with localized settings and relative-resource base', async () => {
    const onUpload = vi.fn().mockResolvedValue(null);
    const after = vi.fn();
    const options = createEditorOptions(
      { content: '# Note', mode: 'sv' as const, baseDir: '/notes/a b' },
      {
        settings,
        locale: 'zh_Hant',
        appTheme: 'dark',
        defaultToolbar: ['italic'],
        placeholder: 'Write here',
        isDarkTheme: (theme) => theme === 'dark',
        localResourceBase: (baseDir) => `local-file://root${baseDir}/`,
        onUpload,
        callbacks: { after },
      },
    );

    expect(options).toMatchObject({
      value: '# Note',
      mode: 'sv',
      theme: 'dark',
      lang: 'zh_TW',
      cdn: 'app://app/vditor',
      tab: '  ',
      toolbar: ['bold', 'outline'],
      toolbarConfig: { hide: false, pin: false },
      outline: { enable: false, position: 'left' },
      link: { isOpen: false },
    });
    expect(options.preview?.markdown).toMatchObject({
      linkBase: 'local-file://root/notes/a b/',
      sanitize: true,
      codeBlockPreview: true,
    });
    expect(options.after).toBe(after);
    await options.upload?.handler?.([new File(['image'], 'photo.png', { type: 'image/png' })]);
    expect(onUpload).toHaveBeenCalledWith(
      { content: '# Note', mode: 'sv', baseDir: '/notes/a b' },
      expect.any(Array),
    );
  });

  it('limits editor rebuilds to constructor-only Vditor settings', () => {
    expect(VDITOR_INITIALIZATION_SETTINGS).toContain('sanitize');
    expect(VDITOR_INITIALIZATION_SETTINGS).toContain('toolbarItems');
    expect(VDITOR_INITIALIZATION_SETTINGS).not.toContain('toolbarVisible');
    expect(VDITOR_INITIALIZATION_SETTINGS).not.toContain('contentTheme');
  });
});
