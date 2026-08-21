import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

describe('renderer shell', () => {
  let document: Document;
  let css: string;
  let rendererScript: string;
  let mainScript: string;
  let preloadScript: string;
  let vditorAdapterScript: string;
  let localesScript: string;
  let packageMetadata: Record<string, unknown>;

  beforeAll(() => {
    const html = fs.readFileSync(path.resolve('src/renderer/index.html'), 'utf8');
    document = new JSDOM(html).window.document;
    css = fs.readFileSync(path.resolve('src/renderer/styles/app.css'), 'utf8');
    rendererScript = fs.readFileSync(path.resolve('src/renderer/app.js'), 'utf8');
    mainScript = fs.readFileSync(path.resolve('src/main/index.ts'), 'utf8');
    preloadScript = fs.readFileSync(path.resolve('src/main/preload.ts'), 'utf8');
    vditorAdapterScript = fs.readFileSync(path.resolve('src/renderer/vditor-adapter.js'), 'utf8');
    localesScript = fs.readFileSync(path.resolve('src/renderer/locales.js'), 'utf8');
    packageMetadata = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  });

  it('contains the merged menu/title bar and window controls', () => {
    expect(document.querySelectorAll('#appMenuBar > button[data-menu]')).toHaveLength(1);
    expect(document.querySelector('#appMenuBar [data-menu="main"]')).not.toBeNull();
    expect(document.querySelector('#toggleSidebar')).not.toBeNull();
    expect(document.querySelector('.titlebar-file-actions > #toggleSidebar')).not.toBeNull();
    expect(document.querySelector('#settingsButton')).toBeNull();
    expect(document.querySelector('[data-menu="mode"]')).toBeNull();
    expect(document.querySelector('[data-menu="theme"]')).toBeNull();
    expect(document.querySelector('#windowTitle')).not.toBeNull();
    expect(document.querySelector('#windowMinimize')).not.toBeNull();
    expect(document.querySelector('#windowMaximize')).not.toBeNull();
    expect(document.querySelector('#windowClose')).not.toBeNull();
    expect(rendererScript).toContain("app.classList.toggle('sidebar-collapsed', !visible)");
    expect(rendererScript).toContain("app.classList.add('sidebar-transitioning')");
    expect(css).toContain('.titlebar-file-actions');
    expect(css).toContain('.toolbar-sidebar-tabs');
    expect(css).toMatch(/\.titlebar-file-actions svg\s*\{[^}]*stroke-width:\s*1\.7/s);
    expect(document.querySelector('.app-menu-logo path:first-child')).not.toBeNull();
    expect(css).toContain('.app-menu-logo path:first-child');
    expect(css).toContain("mask-image: url('../assets/titlebar-sidebar.svg')");
    expect(css).toContain("mask-image: url('../assets/titlebar-new.svg')");
    expect(css).toContain("mask-image: url('../assets/titlebar-open.svg')");
    expect(css).toContain("mask-image: url('../assets/titlebar-save.svg')");
    expect(css).toMatch(/background:\s*linear-gradient\(\s*120deg/s);
    expect(css).toContain('.tabbar.app-scrollbar::-webkit-scrollbar');
    expect(css).toMatch(/\.window-controls button:hover\s*\{[^}]*background:/s);
    expect(css).toMatch(
      /\.window-controls button\s*\{[^}]*transition:[^}]*color 0\.16s ease[^}]*background-color 0\.16s ease/s,
    );
    expect(css).toMatch(/\.window-titlebar\s*\{[^}]*background:\s*var\(--panel-2\)/s);
    expect(css).toMatch(
      /#app:is\(\.toolbar-hidden, \.toolbar-unavailable\) \.window-titlebar\s*\{[^}]*box-shadow:\s*none/s,
    );
    expect(css).toMatch(
      /\.titlebar-sidebar-toggle\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s,
    );
    expect(css).toMatch(
      /#app\.sidebar-transitioning \.toolbar-sidebar-tabs\s*\{[^}]*width 0\.16s ease/s,
    );
    expect(css).toMatch(
      /\.app-menu-popup button:disabled:hover,[\s\S]*?color:\s*color-mix\(in srgb, var\(--muted\) 55%, transparent\)/,
    );
    expect(css).toContain('--window-radius: 8px');
    expect(css).toMatch(/#app\s*\{[^}]*border-radius:\s*var\(--window-radius\)/s);
  });

  it('places all three localized editing modes under the View menu', () => {
    const nativeMenu = fs.readFileSync(path.resolve('src/main/menu.ts'), 'utf8');
    expect(rendererScript).toContain("label: 'menu.editMode'");
    expect(rendererScript).toContain("run('mode', 'wysiwyg')");
    expect(rendererScript).toContain("run('mode', 'ir')");
    expect(rendererScript).toContain("run('mode', 'sv')");
    expect(localesScript).toContain("'menu.editModeWysiwyg': '所见即所得模式'");
    expect(localesScript).toContain("'menu.editModeIr': '即时渲染模式'");
    expect(localesScript).toContain("'menu.editModeSv': '分栏预览模式'");
    expect(nativeMenu).toContain("label: tr('Editing Mode', '编辑模式', '編輯模式')");
    expect(nativeMenu).not.toContain("label: tr('Mode', '模式', '模式')");
  });

  it('provides complete Simplified and Traditional Chinese locales', () => {
    const localeWindow: { VditorDesktopLocales?: Record<string, Record<string, string>> } = {};
    new Function('window', localesScript)(localeWindow);
    const locales = localeWindow.VditorDesktopLocales;
    expect(locales).toBeDefined();
    expect(Object.keys(locales || {})).toEqual(['en_US', 'zh_Hans', 'zh_Hant']);
    expect(Object.keys(locales?.zh_Hans || {})).toEqual(Object.keys(locales?.en_US || {}));
    expect(Object.keys(locales?.zh_Hant || {})).toEqual(Object.keys(locales?.en_US || {}));
    expect(locales?.zh_Hant['settings.title']).toBe('Vditor Desktop 設定');
    expect(localesScript).not.toContain('zh_CN: {');
    expect(
      Array.from(document.querySelectorAll('[name="locale"] option')).map(
        (option) => (option as HTMLOptionElement).value,
      ),
    ).toEqual(['system', 'en_US', 'zh_Hans', 'zh_Hant']);
    expect(rendererScript).toContain("state.locale === 'zh_Hant' ? 'zh_TW'");
  });

  it('uses native macOS traffic lights with a protected custom-titlebar menu area', () => {
    expect(mainScript).toContain("titleBarStyle: process.platform === 'darwin' ? 'hiddenInset'");
    expect(mainScript).toContain(
      "trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 9 }",
    );
    expect(preloadScript).toContain('platform: process.platform');
    expect(rendererScript).toContain('document.body.dataset.platform = window.appAPI.platform');
    expect(css).toMatch(
      /body\[data-platform='darwin'\] \.app-menu-bar\s*\{[^}]*padding-left:\s*78px/s,
    );
    expect(css).toMatch(
      /body\[data-platform='darwin'\] \.window-controls\s*\{[^}]*display:\s*none/s,
    );
  });

  it('defines reproducible Linux portable and AppImage release entry points', () => {
    const scripts = packageMetadata.scripts;
    const build = packageMetadata.build;
    const releaseScript = fs.readFileSync(path.resolve('scripts/release-linux.js'), 'utf8');
    const desktopTemplate = fs.readFileSync(
      path.resolve('resources/linux/vditor-desktop.desktop.in'),
      'utf8',
    );
    const appRun = fs.readFileSync(path.resolve('resources/linux/AppRun'), 'utf8');
    expect(scripts).toMatchObject({
      'release:linux': 'npm run build && node scripts/release-linux.js all',
      'release:linux:portable': 'npm run build && node scripts/release-linux.js portable',
      'release:linux:appimage': 'npm run build && node scripts/release-linux.js appimage',
    });
    expect(build.linux.executableName).toBe('vditor-desktop');
    expect(build.fileAssociations[0].mimeType).toBe('text/markdown');
    expect(releaseScript).toContain('vditor-desktop-x86_64-${version}-portable.tar.gz');
    expect(releaseScript).toContain('vditor-desktop-x86_64-${version}-portable.AppImage');
    expect(releaseScript).toContain('appImageToolChecksum');
    expect(releaseScript).toContain('appImageRuntimeChecksum');
    expect(desktopTemplate).toContain('MimeType=text/markdown;text/x-markdown;');
    expect(desktopTemplate).toContain('StartupWMClass=com.github.studio-200a.vditor-electron');
    expect(appRun).toContain('usr/lib/vditor-desktop/vditor-desktop');
  });

  it('auto-hides sidebar scrollbars and keeps status text unselectable', () => {
    expect(rendererScript).toContain("setupAutoHideScrollbar($('#fileTree'))");
    expect(rendererScript).toContain("setupAutoHideScrollbar($('#outlineTree'))");
    expect(css).toMatch(/\.statusbar\s*\{[^}]*user-select:\s*none/s);
    expect(css).toContain("html[data-scrollbar-mode='auto'] .app-scrollbar.scrollbar-visible");
  });

  it('routes desktop-launcher files into the initialized renderer', () => {
    expect(mainScript).toContain('app.requestSingleInstanceLock()');
    expect(mainScript).toContain("app.on('second-instance'");
    expect(mainScript).toContain("app.on('open-file'");
    expect(mainScript).toContain("send('app:openFiles', paths)");
    expect(preloadScript).toContain('onOpenFiles: (callback: (paths: string[]) => void)');
    expect(preloadScript).toContain("ipcRenderer.send('app:rendererReady')");
    expect(rendererScript).toContain('window.appAPI.onOpenFiles((paths) => void openPaths(paths))');
    expect(rendererScript).toContain('window.appAPI.rendererReady()');
  });

  it('contains a themed application confirmation dialog', () => {
    expect(document.querySelector('#confirmModal[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('#confirmMessage')).not.toBeNull();
    expect(document.querySelector('#confirmDetail')).not.toBeNull();
    expect(document.querySelector('#confirmActions')).not.toBeNull();
    expect(css).toMatch(/\.confirm-card\s*\{/);
    expect(document.querySelectorAll('.confirm-card [data-settings-resize]')).toHaveLength(0);
    expect(rendererScript).toContain('setupConfirmDialogDrag()');
    expect(css).toMatch(/\.confirm-card\.confirm-card-draggable > header\s*\{[^}]*cursor:\s*move/s);
    expect(css).toMatch(/\.modal\s*\{[^}]*inset:\s*14px 20px 28px/s);
  });

  it('delegates main-window resizing to the native resizable frame', () => {
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    expect(mainScript).toContain('resizable: true');
    expect(mainScript).toContain("transparent: process.platform === 'win32'");
    expect(mainScript).toContain('hasShadow: true');
    expect(mainScript).not.toContain("ipcMain.on('window:resize'");
    expect(preloadScript).not.toContain('resizeWindow:');
    expect(css).toMatch(
      /body\[data-platform='linux'\] #app\s*\{[^}]*inset:\s*0[^}]*box-shadow:\s*none/s,
    );
  });

  it('provides bounded resize hit areas for the settings dialog', () => {
    expect(document.querySelectorAll('.settings-card [data-settings-resize]')).toHaveLength(8);
    expect(css).toMatch(/\.modal-card\s*\{[^}]*border-radius:\s*var\(--window-radius\)/s);
    expect(css).toMatch(/\.settings-card\s*\{[^}]*min-width:\s*min\(620px, 90vw\)/s);
    expect(css).toMatch(/\.settings-card\s*\{[^}]*min-height:\s*min\(420px, 90vh\)/s);
    expect(css).toMatch(/\.settings-card\s*\{[^}]*height:\s*min\(780px, 90vh\)/s);
    expect(css).toMatch(/\.settings-card\s*\{[^}]*max-width:\s*90vw/s);
    expect(css).toMatch(/\.settings-card\s*\{[^}]*max-height:\s*90vh/s);
  });

  it('contains the empty-tab recovery actions', () => {
    expect(document.querySelector('#noTabs')).not.toBeNull();
    expect(document.querySelector('#emptyNewFile')).not.toBeNull();
    expect(document.querySelector('#emptyOpenFile')).not.toBeNull();
  });

  it('provides a localized document find and replace widget', () => {
    const nativeMenu = fs.readFileSync(path.resolve('src/main/menu.ts'), 'utf8');
    expect(document.querySelector('#findWidget.hidden')).not.toBeNull();
    expect(
      document.querySelector('#findInput[data-i18n-placeholder="find.placeholder"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('#replaceInput[data-i18n-placeholder="find.replacePlaceholder"]'),
    ).not.toBeNull();
    expect(document.querySelector('#findCount')).not.toBeNull();
    expect(rendererScript).toContain("else if (key === 'f')");
    expect(rendererScript).toContain("else if (key === 'f')");
    expect(nativeMenu).not.toContain("accelerator: 'CmdOrCtrl+F'");
    expect(vditorAdapterScript).toContain('function selectTextMatch');
    expect(vditorAdapterScript).toContain('function highlightTextMatches');
    expect(css).toContain('::highlight(vditor-desktop-find-active)');
    expect(document.querySelectorAll('#findWidget button svg')).toHaveLength(4);
    expect(document.querySelector('#replaceOne .find-replace-one-icon')).not.toBeNull();
    expect(document.querySelector('#replaceAll .find-replace-all-icon')).not.toBeNull();
    expect(css).toContain("mask-image: url('../assets/replace.svg')");
    expect(css).toContain("mask-image: url('../assets/replace-all.svg')");
    expect(css).toContain('background: currentColor');
    expect(rendererScript).toContain('VDITOR.revealTextMatch(tab.host, mode, query, findIndex)');
    expect(rendererScript).toContain("$('#findWidget').addEventListener('focusout'");
    expect(rendererScript).toContain('event.stopImmediatePropagation()');
    expect(rendererScript).toContain("event.key === 'Enter' && event.target === $('#findInput')");
    expect(rendererScript).toContain("event.key.toLowerCase() === 's'");
    expect(rendererScript).not.toContain(
      'moveFindMatch(event.shiftKey ? -1 : 1);\n        }\n      },\n      true,',
    );
    expect(css).toMatch(/\.find-widget\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*12/s);
  });

  it('keeps explorer entries non-draggable', () => {
    expect(rendererScript).not.toContain('text/x-vditor-path');
    expect(rendererScript).not.toMatch(/row\.draggable\s*=/);
    expect(css).not.toMatch(/\.tree-row\.drop-target/);
  });

  it('collapses and expands explorer directory children', () => {
    expect(css).toMatch(/\.tree-children\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.tree-row\.expanded \+ \.tree-children\s*\{[^}]*display:\s*block/s);
  });

  it('keeps explorer controls fixed and shortens names in the middle', () => {
    expect(css).toMatch(/\.tree\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(css).toMatch(/\.chevron\s*\{[^}]*flex:\s*0 0 12px/s);
    expect(css).toMatch(/\.tree-name\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(rendererScript).toContain('function middleEllipsis');
    expect(rendererScript).toContain("const ellipsis = '...'");
    expect(rendererScript).toContain('name.dataset.fullName');
  });

  it('labels settings navigation with localized text and category icons', () => {
    expect(document.querySelector('.settings-card > header h2')?.textContent).toBe(
      'Vditor Desktop Settings',
    );
    expect(document.querySelectorAll('.settings-nav button > svg')).toHaveLength(6);
    expect(document.querySelectorAll('.settings-nav button > span[data-i18n]')).toHaveLength(6);
    expect(css).toMatch(/\.settings-nav button\s*\{[^}]*gap:\s*8px/s);
    expect(css).toMatch(/\.settings-nav button:hover\s*\{[^}]*background:\s*var\(--hover\)/s);
  });

  it('centers the About content above its reset divider', () => {
    expect(document.querySelector('.about-panel > .about-main')).not.toBeNull();
    expect(document.querySelector('.about-panel > .about-reset')).not.toBeNull();
    expect(css).toMatch(/\.about-main\s*\{[^}]*flex:\s*1[^}]*justify-content:\s*center/s);
    expect(css).toMatch(/\.about-reset\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
    expect(css).toMatch(/\.about-credit > span\s*\{[^}]*white-space:\s*pre/s);
  });

  it('exposes all three zoom settings', () => {
    expect(document.querySelector('[name="uiZoom"]')).not.toBeNull();
    expect(document.querySelector('[name="editorZoom"]')).not.toBeNull();
    expect(document.querySelector('[name="previewZoom"]')).not.toBeNull();
    expect(
      Array.from(document.querySelectorAll('[name="uiZoom"] option')).map(
        (option) => option.textContent,
      ),
    ).toEqual(expect.arrayContaining(['115', '120']));
  });

  it('contains the path-first status bar controls', () => {
    expect(document.querySelector('#statusPath')).not.toBeNull();
    expect(document.querySelector('#statusLineEnding')).not.toBeNull();
    expect(document.querySelector('#statusSettings')).not.toBeNull();
    expect(document.querySelector('#statusThemeToggle')).not.toBeNull();
    expect(document.querySelector('#statusVersion')).not.toBeNull();
    expect(document.querySelector('#app > .statusbar')).not.toBeNull();
    expect(css).toMatch(/\.statusbar\s*\{[^}]*font-family:\s*var\(--ui-font\)/s);
  });

  it('uses complete four-number viewBoxes for inline SVG icons', () => {
    const invalidIcons = Array.from(document.querySelectorAll('svg[viewBox]')).filter((icon) => {
      const values = icon.getAttribute('viewBox')?.trim().split(/\s+/) || [];
      return values.length !== 4 || values.some((value) => !Number.isFinite(Number(value)));
    });
    expect(invalidIcons).toEqual([]);
  });

  it('allows remote document images without relaxing scripts or connections', () => {
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');
    expect(policy).toContain("img-src 'self' app: local-file: https: http: data: blob:");
    expect(policy).toContain("connect-src 'self' app: local-file:");
    expect(policy).not.toMatch(/connect-src[^;]*https:/);
  });

  it('renders the outline without a redundant heading and highlights items on hover', () => {
    expect(document.querySelector('#outlineView > .panel-heading')).toBeNull();
    expect(document.querySelector('#outlineTree')).not.toBeNull();
    expect(css).toMatch(/\.outline-row:hover\s*\{[^}]*background:\s*var\(--hover\)/s);
    expect(rendererScript).toContain("toggle.className = 'outline-toggle'");
    expect(css).toContain('color-mix(in srgb, var(--text) 78%, var(--muted))');
    expect(rendererScript).toContain('function scrollHeadingIntoEditor');
    expect(vditorAdapterScript).toContain('sourceHeading: \'[data-type="heading-marker"]\'');
  });

  it('adds a dynamic bottom spacer to every Vditor editing surface', () => {
    expect(vditorAdapterScript).toContain('function setEditorBottomSpacer(host, height)');
    expect(rendererScript).toContain('function observeEditorBottomSpacer(tab)');
    expect(rendererScript).toContain('disconnectEditorBottomSpacer(tab)');
    expect(css).toMatch(
      /\.editor-host \.vditor-preview > \.vditor-reset::after\s*\{[^}]*height:\s*var\(--editor-bottom, 0px\)/s,
    );
    expect(css).toMatch(
      /\.editor-host \.vditor-preview > \.vditor-reset::after\s*\{[^}]*content:\s*'';[^}]*display:\s*block;/s,
    );
  });

  it('offers the built-in Monokai Pro Dark theme and remembers it for the status toggle', () => {
    expect(
      document.querySelectorAll('.theme-picker input[type="radio"][name="theme"]'),
    ).toHaveLength(3);
    expect(document.querySelector('[name="theme"][value="monokai-pro-dark"]')).not.toBeNull();
    expect(document.querySelectorAll('.theme-preview svg')).toHaveLength(3);
    expect(document.querySelector('.settings-right-edge')).not.toBeNull();
    expect(rendererScript).toContain("theme === 'dark' || theme === 'monokai-pro-dark'");
    expect(rendererScript).toContain('darkThemePreference()');
    expect(css).toMatch(
      /:root\[data-theme='monokai-pro-dark'\]\s*\{[^}]*--bg:\s*#2d2a2e[^}]*--accent:\s*#ffd866/s,
    );
    expect(css).toContain('--monokai-h1: #ff6188');
    expect(css).toContain('--monokai-h6: #fc9867');
    expect(css).toMatch(
      /\.theme-option-input:checked \+ \.theme-preview\s*\{[^}]*border-color:\s*var\(--accent\)/s,
    );
    expect(css).toMatch(
      /\.settings-right-edge\s*\{[^}]*width:\s*10px[^}]*background:\s*var\(--panel-2\)/s,
    );
  });

  it('separates light and dark code-block theme choices', () => {
    const codeThemes = Array.from(
      document.querySelectorAll<HTMLOptionElement>('[name="codeTheme"] option'),
    );
    expect(codeThemes.filter((option) => option.dataset.themeTone === 'light')).toHaveLength(81);
    expect(codeThemes.filter((option) => option.dataset.themeTone === 'dark')).toHaveLength(168);
    expect(codeThemes.map((option) => option.value)).toContain('monokai-sublime');
    expect(codeThemes.map((option) => option.value)).toContain('base16/atelier-cave-light');
    expect(rendererScript).toContain('lightCodeTheme');
    expect(rendererScript).toContain('darkCodeTheme');
    expect(vditorAdapterScript).toContain("name === 'ant-design'");
    expect(css).toMatch(/\.vditor-toolbar-mount button\[hidden\]\s*\{[^}]*display:\s*none/s);
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

  it('replaces Advanced with a localized About page and application logo', () => {
    expect(document.querySelector('.settings-nav [data-panel="advanced"]')).toBeNull();
    expect(document.querySelector('.settings-nav [data-panel="about"]')).not.toBeNull();
    expect(document.querySelector('.about-panel .about-logo')).not.toBeNull();
    expect(document.querySelector('.about-panel #resetSettings')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('[name="devToolsEnabled"]')?.type).toBe(
      'checkbox',
    );
    expect(document.querySelector('.about-devtools-setting')?.textContent).toContain(
      'Chrome DevTools',
    );
    expect(document.querySelectorAll('.about-panel [data-external]').length).toBeGreaterThan(3);
  });

  it('hides the WYSIWYG block popover and styles editable code blocks', () => {
    expect(css).toMatch(
      /\.editor-host \.vditor-wysiwyg > \.vditor-reset \+ \.vditor-panel\s*\{[^}]*display:\s*none/s,
    );
    expect(css).toMatch(/\[data-type='code-block'\][^{]*\{[^}]*font-family:\s*var\(--code-font\)/s);
    expect(css).toMatch(
      /\.editor-host\.vditor\.active\s*\{[^}]*--panel-background-color:\s*var\(--bg\)[^}]*--textarea-background-color:\s*var\(--bg\)/s,
    );
  });

  it('applies the configured rendered font to all preview heading levels', () => {
    expect(css).toMatch(
      /\.editor-host \.vditor-preview \.vditor-reset :is\(h1, h2, h3, h4, h5, h6\)\s*\{[^}]*font-family:\s*var\(--rendered-font\) !important/s,
    );
  });

  it('offers split-view indentation and whitespace controls', () => {
    expect(document.querySelector('[name="tabString"]')).toBeNull();
    expect(document.querySelector('[name="tabInsertSpaces"]')).not.toBeNull();
    expect(document.querySelectorAll('[name="tabSize"] option')).toHaveLength(4);
    expect(document.querySelector('[name="showWhitespace"]')).not.toBeNull();
    expect(document.querySelector('[name="autoIndent"]')).not.toBeNull();
    expect(rendererScript).toContain("document.createElement('canvas')");
    expect(rendererScript).toContain('canvas.whitespaceMarkerPositions = markerPositions');
    expect(rendererScript).toContain('if (tab.whitespaceFrame) return');
    expect(css).toMatch(
      /\.editor-host\.vditor:not\(\.active\)\s*\{[^}]*display:\s*none !important/s,
    );
    expect(css).not.toContain('.sv-whitespace-dot');
  });

  it('auto-hides the split editor scrollbar after interaction', () => {
    expect(rendererScript).toContain('setupAutoHideScrollbar(sv)');
    expect(rendererScript).toContain("element.classList.add('scrollbar-visible')");
    expect(rendererScript).toMatch(/timer = setTimeout\([\s\S]*?1000\)/);
    expect(rendererScript).toContain('rect.right - event.clientX <= 14');
    expect(css).toMatch(/\.app-scrollbar::-webkit-scrollbar-thumb\s*\{[^}]*transition:/s);
    expect(css).toContain("html[data-scrollbar-mode='always']");
    expect(css).toContain("html[data-scrollbar-mode='hidden']");
    expect(css).toContain('background-color 320ms');
  });

  it('adds theme-aware top shadows to the sidebar and editor toolbar boundaries', () => {
    expect(css).toContain('--top-surface-shadow:');
    expect(css).toMatch(/\.sidebar-tabs\s*\{[^}]*box-shadow:\s*var\(--top-surface-shadow\)/s);
    expect(css).toMatch(/\.titlebar\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/s);
  });

  it('prevents accidental text selection in settings while keeping fields selectable', () => {
    expect(css).toMatch(/\.settings-card\s*\{[^}]*user-select:\s*none/s);
    expect(css).toMatch(
      /\.settings-card input,[\s\S]*?\.settings-card textarea,[\s\S]*?user-select:\s*text/s,
    );
  });

  it('offers all localized global scrollbar visibility modes', () => {
    expect(
      Array.from(document.querySelectorAll('[name="scrollbarMode"] option')).map(
        (option) => (option as HTMLOptionElement).value,
      ),
    ).toEqual(['always', 'auto', 'hidden']);
    expect(localesScript).toContain("'settings.scrollbarMode': '滚动条显示状态'");
    expect(rendererScript).toContain('document.documentElement.dataset.scrollbarMode');
  });

  it('offers an opt-in multi-platform layout preview', () => {
    const setting = document.querySelector<HTMLInputElement>('[name="multiPlatformPreview"]');
    expect(setting).not.toBeNull();
    expect(setting?.type).toBe('checkbox');
  });

  it('distinguishes preview code-block line numbers from split editor line numbers', () => {
    expect(document.querySelector('[name="lineNumbers"] + span')?.textContent).toBe(
      'Code block preview line numbers',
    );
    expect(localesScript).toContain("'settings.lineNumbers': '代码块预览行号'");
  });

  it('does not expose the unfinished split-editor heading folding behavior', () => {
    expect(rendererScript).not.toContain('foldedHeadings');
    expect(rendererScript).not.toContain('data-folded-heading');
    expect(css).not.toContain('.sv-fold-toggle');
  });

  it('uses the reverse-domain Linux desktop name as WM_CLASS', () => {
    expect(packageMetadata.desktopName).toBe('com.github.studio-200a.vditor-electron');
    expect(
      (packageMetadata.build as { linux?: { syncDesktopName?: boolean } }).linux?.syncDesktopName,
    ).toBe(true);
  });

  it('lays out Markdown checkboxes as a compact aligned grid', () => {
    expect(
      document.querySelectorAll('[data-settings-panel="preview"] .check-grid label'),
    ).toHaveLength(12);
    expect(css).toMatch(/\.check-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/s);
    expect(css).toMatch(
      /\.settings-content \.check-grid label\s*\{[^}]*display:\s*flex[^}]*gap:\s*8px[^}]*margin:\s*0/s,
    );
  });

  it('separates tab and workspace restoration settings', () => {
    expect(document.querySelector('[name="sessionRestore"]')).toBeNull();
    expect(document.querySelector('[name="restoreTabs"]')).not.toBeNull();
    expect(document.querySelector('[name="restoreWorkspace"]')).not.toBeNull();
  });

  it('loads the Vditor compatibility adapter before the application renderer', () => {
    const scripts = Array.from(document.querySelectorAll('script')).map((script) => script.src);
    expect(scripts.at(-2)).toContain('vditor-adapter.js');
    expect(scripts.at(-1)).toContain('app.js');
    expect(rendererScript).toContain('window.VditorDesktopAdapter');
  });

  it('shows the configuration path and current-page reset in the settings footer', () => {
    expect(document.querySelector('.settings-card > footer #settingsPath')).not.toBeNull();
    expect(document.querySelector('#openSettingsFolder svg')).not.toBeNull();
    expect(document.querySelector('#resetSettingsPage')).not.toBeNull();
  });
});
