import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

describe('renderer shell', () => {
  let document: Document;

  beforeAll(() => {
    const html = fs.readFileSync(path.resolve('src/renderer/index.html'), 'utf8');
    document = new JSDOM(html).window.document;
  });

  it('contains the merged menu/title bar and window controls', () => {
    expect(document.querySelectorAll('#appMenuBar > button')).toHaveLength(4);
    expect(document.querySelector('[data-menu="mode"]')).toBeNull();
    expect(document.querySelector('[data-menu="theme"]')).toBeNull();
    expect(document.querySelector('#windowTitle')).not.toBeNull();
    expect(document.querySelector('#windowMinimize')).not.toBeNull();
    expect(document.querySelector('#windowMaximize')).not.toBeNull();
    expect(document.querySelector('#windowClose')).not.toBeNull();
  });

  it('contains the empty-tab recovery actions', () => {
    expect(document.querySelector('#noTabs')).not.toBeNull();
    expect(document.querySelector('#emptyNewFile')).not.toBeNull();
    expect(document.querySelector('#emptyOpenFile')).not.toBeNull();
  });

  it('exposes all three zoom settings', () => {
    expect(document.querySelector('[name="uiZoom"]')).not.toBeNull();
    expect(document.querySelector('[name="editorZoom"]')).not.toBeNull();
    expect(document.querySelector('[name="previewZoom"]')).not.toBeNull();
  });

  it('contains the path-first status bar controls', () => {
    expect(document.querySelector('#statusPath')).not.toBeNull();
    expect(document.querySelector('#statusLineEnding')).not.toBeNull();
    expect(document.querySelector('#statusSettings')).not.toBeNull();
    expect(document.querySelector('#statusThemeToggle')).not.toBeNull();
    expect(document.querySelector('#statusVersion')).not.toBeNull();
  });

  it('groups font settings under secondary headings', () => {
    expect(document.querySelectorAll('.settings-subheading')).toHaveLength(4);
    expect(document.querySelector('.settings-nav [data-panel="fonts"]')).not.toBeNull();
    expect(
      document.querySelector('[data-settings-panel="fonts"] [name="uiFontFamily"]'),
    ).not.toBeNull();
  });

  it('uses a compact workspace-name explorer header', () => {
    expect(document.querySelector('#workspaceName')).not.toBeNull();
    expect(document.querySelector('#refreshTree')).not.toBeNull();
    expect(document.querySelector('#fileSearch')).toBeNull();
    expect(document.querySelector('#newExplorerFile')).toBeNull();
    expect(document.querySelector('#workspaceLabel')).toBeNull();
  });

  it('offers a continuous 40-100 percent editor text-width control', () => {
    const range = document.querySelector<HTMLInputElement>('[name="editorTextWidth"]');
    expect(range).not.toBeNull();
    expect(range?.type).toBe('range');
    expect(range?.min).toBe('40');
    expect(range?.max).toBe('100');
  });

  it('does not expose obsolete placeholder or Vditor toolbar settings', () => {
    expect(document.querySelector('[name="placeholder"]')).toBeNull();
    expect(document.querySelector('[name="toolbarHide"]')).toBeNull();
    expect(document.querySelector('[name="toolbarPin"]')).toBeNull();
  });

  it('offers split-view indentation and whitespace controls', () => {
    expect(document.querySelector('[name="tabString"]')).toBeNull();
    expect(document.querySelector('[name="tabInsertSpaces"]')).not.toBeNull();
    expect(document.querySelectorAll('[name="tabSize"] option')).toHaveLength(4);
    expect(document.querySelector('[name="showWhitespace"]')).not.toBeNull();
    expect(document.querySelector('[name="autoIndent"]')).not.toBeNull();
  });

  it('separates tab and workspace restoration settings', () => {
    expect(document.querySelector('[name="sessionRestore"]')).toBeNull();
    expect(document.querySelector('[name="restoreTabs"]')).not.toBeNull();
    expect(document.querySelector('[name="restoreWorkspace"]')).not.toBeNull();
  });

  it('shows the configuration path and current-page reset in the settings footer', () => {
    expect(document.querySelector('.settings-card > footer #settingsPath')).not.toBeNull();
    expect(document.querySelector('#openSettingsFolder svg')).not.toBeNull();
    expect(document.querySelector('#resetSettingsPage')).not.toBeNull();
  });
});
