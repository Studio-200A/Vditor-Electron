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
    expect(css).toContain('.titlebar-file-actions');
    expect(css).toContain('.toolbar-sidebar-tabs');
    expect(document.querySelectorAll('.titlebar-file-actions svg')).toHaveLength(0);
    expect(css).toContain('.titlebar-file-actions .icon-btn::before');
    expect(document.querySelector('.app-menu-logo use')).not.toBeNull();
    expect(document.querySelector('.app-menu-logo use')?.getAttribute('href')).toBe(
      'assets/app-icon/app-menu-logo.svg#app-menu-logo',
    );
    expect(css).toContain("mask-image: url('../assets/symbolic/titlebar-sidebar.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/titlebar-new.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/titlebar-open.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/titlebar-save.svg')");
    expect(document.querySelector('.workspace-heading-icon')).not.toBeNull();
    expect(css).toContain("mask: url('../assets/symbolic/titlebar-open.svg') center / contain");
    expect(document.querySelector('#statusSettings .status-settings-icon')).not.toBeNull();
    expect(css).toContain("mask: url('../assets/symbolic/settings.svg') center / contain");
    expect(document.querySelector('#openSettingsFolder .settings-path-icon')).not.toBeNull();
    expect(css).toMatch(
      /\.settings-path-icon\s*\{[^}]*mask:\s*url\('\.\.\/assets\/symbolic\/settings-files\.svg'\) center \/ contain/s,
    );
    for (const asset of [
      'app-icon/app-menu-logo.svg',
      'app-icon/vditor-desktop.svg',
      'notification/notification.svg',
      'notification/warning.svg',
    ]) {
      expect(fs.existsSync(path.resolve('src/renderer/assets', asset))).toBe(true);
    }
    const sourceSymbolicDir = path.resolve('src/renderer/assets/symbolic');
    expect(
      !fs.existsSync(sourceSymbolicDir) || fs.readdirSync(sourceSymbolicDir).length === 0,
    ).toBe(true);
    expect(packageMetadata.devDependencies).toEqual(
      expect.objectContaining({ 'lucide-static': expect.any(String) }),
    );
    for (const icon of [
      'moon',
      'sun',
      'rotate-cw',
      'info',
      'palette',
      'square-text',
      'folder',
      'type',
      'eye',
      'settings',
      'monitor',
      'file-plus-corner',
      'folder-open',
      'save',
      'panel-left',
      'replace',
      'replace-all',
      'file',
      'folder-symlink',
    ]) {
      expect(fs.existsSync(path.resolve('node_modules/lucide-static/icons', `${icon}.svg`))).toBe(
        true,
      );
    }
    for (const asset of [
      'vditor-desktop.svg',
      'warning.svg',
      'notification.svg',
      'dark-symbolic.svg',
      'light-symbolic.svg',
      'system-symbolic.svg',
      'settings.svg',
      'titlebar-new.svg',
      'titlebar-open.svg',
      'titlebar-save.svg',
      'titlebar-sidebar.svg',
      'replace.svg',
      'replace-all.svg',
      'symlink.svg',
    ]) {
      expect(fs.existsSync(path.resolve('src/renderer/assets', asset))).toBe(false);
    }
    expect(css).toMatch(/background:\s*linear-gradient\(\s*120deg/s);
    expect(css).toContain('.tabbar.app-scrollbar::-webkit-scrollbar');
    expect(css).toMatch(/\.window-controls button:hover\s*\{[^}]*background:/s);
    expect(css).toMatch(
      /\.window-controls button\s*\{[^}]*transition:[^}]*color 0\.16s ease[^}]*background-color 0\.16s ease/s,
    );
    expect(css).toMatch(/\.window-titlebar\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s);
    expect(css).toMatch(/#app\.toolbar-hidden \.window-titlebar\s*\{[^}]*box-shadow:\s*none/s);
    expect(document.querySelector('#toolbarSkeleton[aria-hidden="true"]')).not.toBeNull();
    expect(css).toContain(".vditor-toolbar-mount[data-toolbar-pending='true'] .toolbar-skeleton");
    expect(css).toMatch(
      /\.titlebar-sidebar-toggle\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s,
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
    expect(releaseScript).toContain("'--no-appstream'");
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
    expect(mainScript).toContain('send(IPC_CHANNELS.appOpenFiles, paths)');
    expect(preloadScript).toContain('onOpenFiles: (callback: (paths: string[]) => void)');
    expect(preloadScript).toContain('ipcRenderer.send(IPC_CHANNELS.appRendererReady)');
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
    expect(css).toMatch(/\.confirm-content\s*\{[^}]*user-select:\s*none/s);
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

  it('uses one persistent document banner structure for recovery and external file states', () => {
    const recoveryBanner = document.querySelector('#recoveryBanner');
    const externalBanner = document.querySelector('#externalChangeBanner');
    const externalFileStateBanner = document.querySelector('#externalFileStateBanner');
    expect(recoveryBanner).not.toBeNull();
    expect(externalBanner).not.toBeNull();
    expect(externalFileStateBanner).not.toBeNull();
    expect(recoveryBanner?.classList.contains('external-change-banner')).toBe(true);
    expect(externalBanner?.classList.contains('external-change-banner')).toBe(true);
    expect(recoveryBanner?.classList.contains('persistent-banner')).toBe(true);
    expect(externalBanner?.classList.contains('persistent-banner')).toBe(true);
    expect(externalFileStateBanner?.classList.contains('persistent-banner')).toBe(true);
    expect(recoveryBanner?.querySelector('.persistent-banner-content')).not.toBeNull();
    expect(externalBanner?.querySelector('.persistent-banner-content')).not.toBeNull();
    expect(externalFileStateBanner?.querySelector('.persistent-banner-content')).not.toBeNull();
    expect(
      recoveryBanner?.querySelector('img[src="assets/notification/warning.svg"]'),
    ).not.toBeNull();
    expect(
      externalBanner?.querySelector('img[src="assets/notification/warning.svg"]'),
    ).not.toBeNull();
    expect(
      externalFileStateBanner?.querySelector('img[src="assets/notification/warning.svg"]'),
    ).not.toBeNull();
    expect(recoveryBanner?.querySelector('#recoverySave')).not.toBeNull();
    expect(recoveryBanner?.querySelector('#recoverySaveAs')).not.toBeNull();
    expect(recoveryBanner?.querySelector('#recoveryDiscard')).not.toBeNull();
    expect(externalBanner?.querySelector('#externalSaveAs')).not.toBeNull();
    expect(externalBanner?.querySelector('#externalOverwrite')).not.toBeNull();
    expect(externalFileStateBanner?.querySelector('#externalFileReload')).not.toBeNull();
    expect(externalFileStateBanner?.querySelector('#externalFileSaveAs')).not.toBeNull();
    expect(externalFileStateBanner?.querySelector('#externalFileKeepUntitled')).not.toBeNull();
    expect(externalFileStateBanner?.querySelector('#externalFileRecreate')).not.toBeNull();
    expect(externalFileStateBanner?.querySelector('#externalFileClose')).not.toBeNull();
    expect(document.querySelector('#temporaryDocumentNotice.hidden')).not.toBeNull();
    expect(document.querySelector('#temporaryDocumentNoticeMessage')).not.toBeNull();
    expect(
      document.querySelector(
        '#temporaryDocumentNotice img[src="assets/notification/notification.svg"]',
      ),
    ).not.toBeNull();
    expect(css).toContain('.temporary-document-notice');
    expect(rendererScript).toContain('showTemporaryDocumentNotice');
    expect(rendererScript).toContain("preserveUnavailableTab(tab, 'deleted'");
    expect(rendererScript).toContain("kind: 'reappeared'");
    expect(rendererScript).toContain("preserveUnavailableTab(tab, 'unreadable'");
    expect(css).toContain('.persistent-banner');
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
    expect(css).toContain("mask-image: url('../assets/symbolic/replace.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/replace-all.svg')");
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

  it('keeps application accelerators separate from Vditor formatting and table shortcuts', () => {
    const nativeMenu = fs.readFileSync(path.resolve('src/main/menu.ts'), 'utf8');
    expect(nativeMenu).toContain("accelerator: 'CmdOrCtrl+Alt+O'");
    expect(nativeMenu).toContain("accelerator: 'CmdOrCtrl+Alt+K'");
    expect(nativeMenu).toContain("accelerator: 'CmdOrCtrl+Alt+B'");
    expect(nativeMenu).not.toContain("role: 'zoomIn'");
    expect(nativeMenu).not.toContain("role: 'zoomOut'");
    expect(nativeMenu).not.toContain("role: 'resetZoom'");
    expect(rendererScript).toContain("key === 'k' && event.altKey && !event.shiftKey");
    expect(rendererScript).toContain('if (event.defaultPrevented) return;');
    expect(mainScript).toContain("if (input.key !== 'F12') return;");
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

  it('keeps explorer controls fixed and shortens names at the available width', () => {
    expect(css).toMatch(/\.tree\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(css).toMatch(/\.chevron\s*\{[^}]*flex:\s*0 0 12px/s);
    expect(css).toMatch(
      /\.tree-name\s*\{[^}]*flex:\s*1 1 auto[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    );
    expect(rendererScript).not.toContain('function middleEllipsis');
    expect(rendererScript).not.toContain('data-full-name');
  });

  it('labels settings navigation with localized text and category icons', () => {
    expect(document.querySelector('.settings-card > header h2')?.textContent).toBe(
      'Vditor Desktop Settings',
    );
    expect(document.querySelectorAll('.settings-nav button > .settings-nav-icon')).toHaveLength(6);
    expect(document.querySelectorAll('.settings-nav button > span[data-i18n]')).toHaveLength(6);
    expect(css).toContain("mask-image: url('../assets/symbolic/settings-appearance.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/settings-fonts.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/settings-editor.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/settings-preview.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/settings-files.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/settings-about.svg')");
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
    expect(document.querySelector('#statusThemeMode')).not.toBeNull();
    expect(document.querySelector('#statusThemeIcon')).not.toBeNull();
    expect(document.querySelector('#statusThemeMenu')).not.toBeNull();
    expect(document.querySelectorAll('#statusThemeMenu [data-theme-mode]')).toHaveLength(3);
    expect(document.querySelector('#statusThemeToggle')).toBeNull();
    expect(document.querySelector('[name="systemTheme"]')).toBeNull();
    expect(rendererScript).not.toContain('statusThemeToggle');
    expect(localesScript).not.toContain('settings.followSystemTheme');
    expect(localesScript).not.toContain('status.toggleTheme');
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
    expect(policy).toContain(
      "script-src 'self' app: 'sha256-qR4U4J3Ne5n0m3uNzGMB/tZ3TWJUf89OlxdXqjqALDM='",
    );
    expect(policy).not.toMatch(/script-src[^;]*unsafe-(?:inline|eval)/);
    // Vditor 3.11.3 creates runtime style attributes for its editing surfaces.
    expect(policy).toContain("style-src 'self' app: 'unsafe-inline'");
    expect(mainScript).toContain('contextIsolation: true');
    expect(mainScript).toContain('nodeIntegration: false');
    expect(mainScript).toContain('sandbox: false');
    expect(document.querySelector('.settings-security-card [name="sanitize"]')).not.toBeNull();
    expect(document.querySelector('[data-settings-panel="preview"] [name="sanitize"]')).toBeNull();
    expect(css).toMatch(
      /\.settings-security-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s,
    );
    expect(css).toMatch(
      /\.settings-content section > \.settings-security-card\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 42px/s,
    );
    expect(css).toMatch(/\.settings-security-card \.theme-switch\s*\{[^}]*justify-self:\s*end/s);
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

  it('offers separately selectable light and dark application theme preferences', () => {
    expect(
      document.querySelectorAll('.theme-picker input[type="radio"][name="lightTheme"]'),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll('.theme-picker input[type="radio"][name="darkTheme"]'),
    ).toHaveLength(3);
    expect(document.querySelector('[name="lightTheme"][value="claude-light"]')).not.toBeNull();
    expect(document.querySelector('[name="lightTheme"][value="monokai-pro-light"]')).not.toBeNull();
    expect(document.querySelector('[name="darkTheme"][value="claude-dark"]')).not.toBeNull();
    expect(document.querySelector('[name="darkTheme"][value="monokai-pro-dark"]')).not.toBeNull();
    expect(document.querySelector('.theme-picker-light')).not.toBeNull();
    expect(document.querySelector('.theme-picker-dark')).not.toBeNull();
    expect(document.querySelectorAll('.theme-preview svg')).toHaveLength(6);
    expect(document.querySelector('[name="systemTheme"]')).toBeNull();
    expect(document.querySelector('.settings-right-edge')).not.toBeNull();
    expect(rendererScript).toContain(
      "theme === 'dark' || theme === 'claude-dark' || theme === 'monokai-pro-dark'",
    );
    expect(rendererScript).toContain('darkThemePreference()');
    expect(rendererScript).toContain('lightThemePreference()');
    expect(rendererScript).toContain('function themeModeFromSettings()');
    expect(rendererScript).toContain('function selectStatusThemeMode(mode)');
    expect(css).toContain("mask-image: url('../assets/symbolic/light-symbolic.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/dark-symbolic.svg')");
    expect(css).toContain("mask-image: url('../assets/symbolic/system-symbolic.svg')");
    expect(css).toMatch(
      /:root\s*\{[^}]*--sidebar-surface:\s*#f0f1f3[^}]*--editor-surface:\s*#fff/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='dark'\]\s*\{[^}]*--sidebar-surface:\s*#202124[^}]*--editor-surface:\s*#18191c/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='claude-light'\]\s*\{[^}]*--sidebar-surface:\s*#f5f4ed[^}]*--editor-surface:\s*#faf9f5[^}]*--border:\s*rgb\(31 30 29 \/ 11%\)[^}]*--accent:\s*#d97757[^}]*--brand-accent:\s*#d97757/s,
    );
    expect(css).toMatch(/\.settings-content\s*\{[^}]*background:\s*var\(--editor-surface\)/s);
    expect(css).toMatch(
      /#settingsForm :is\(input\[type='text'\], input\[type='number'\], select, textarea\)\s*\{[^}]*background:\s*var\(--settings-control-surface\) !important/s,
    );
    expect(css).toMatch(
      /:root\s*\{[^}]*--editor-surface:\s*#fff[^}]*--settings-control-surface:\s*#f7f7f8/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='dark'\]\s*\{[^}]*--editor-surface:\s*#18191c[^}]*--settings-control-surface:\s*#202124/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='claude-light'\]\s*\{[^}]*--editor-surface:\s*#faf9f5[^}]*--settings-control-surface:\s*#fff/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='claude-dark'\]\s*\{[^}]*--editor-surface:\s*#262624[^}]*--settings-control-surface:\s*#30302e/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='claude-light'\] \.modal-close:hover\s*\{[^}]*background:\s*#e8e6dc[^}]*color:\s*var\(--text\)/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='claude-dark'\]\s*\{[^}]*--bg:\s*#141413[^}]*--sidebar-surface:\s*#30302e[^}]*--editor-surface:\s*#262624[^}]*--accent:\s*#d97757[^}]*--brand-accent:\s*#d97757/s,
    );
    expect(css).toMatch(/\.sidebar\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s);
    expect(css).toMatch(/\.editor-area\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s);
    expect(css).toMatch(
      /\.no-tabs-actions button\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s,
    );
    expect(css).toMatch(/\.window-titlebar\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s);
    expect(css).toMatch(/\.titlebar\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s);
    expect(css).toMatch(
      /\.vditor-toolbar-mount > \.vditor-toolbar\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s,
    );
    expect(css).toMatch(
      /\.toolbar-sidebar-tabs\.sidebar-tabs\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s,
    );
    expect(css).toMatch(/\.document-tab:hover\s*\{[^}]*background:\s*var\(--hover\)/s);
    expect(css).toMatch(/\.document-tab\.active:hover\s*\{[^}]*background:\s*var\(--hover\)/s);
    expect(css).not.toContain('.document-tab:hover {\n  background: #d9dde3;');
    expect(css).toMatch(
      /\.app-menu-bar > button\[data-menu='main'\]\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s,
    );
    expect(css).toMatch(/\.app-menu-popup\s*\{[^}]*background:\s*var\(--sidebar-surface\)/s);
    expect(css).toMatch(
      /\.editor-host\.vditor\.active\s*\{[^}]*--panel-background-color:\s*var\(--editor-surface\)[^}]*--textarea-background-color:\s*var\(--editor-surface\)/s,
    );
    expect(css).toMatch(
      /\.editor-host,[\s\S]*\.vditor-reset\s*\{[^}]*background-color:\s*var\(--editor-surface\)/,
    );
    expect(css).not.toMatch(/data-theme='claude-(?:light|dark)'[^}]*--ui-font/s);
    expect(css).toMatch(
      /:root\[data-theme='monokai-pro-dark'\]\s*\{[^}]*--bg:\s*#2d2a2e[^}]*--editor-surface:\s*#272428[^}]*--settings-control-surface:\s*#2d2a2e[^}]*--accent:\s*#ffd866/s,
    );
    expect(css).toMatch(
      /:root\[data-theme='monokai-pro-light'\]\s*\{[^}]*--bg:\s*#faf4f2[^}]*--settings-control-surface:\s*#fefaf9[^}]*--border:\s*#d8d3d1[^}]*--accent:\s*#e14775/s,
    );
    expect(css).toContain('--monokai-h1: #ff6188');
    expect(css).toContain('--monokai-h6: #fc9867');
    expect(css).toContain('--monokai-h1: #d40045');
    expect(css).toContain('--monokai-h6: #373530');
    expect(css).toMatch(
      /\.theme-option-input:checked \+ \.theme-preview\s*\{[^}]*border-color:\s*var\(--accent\)/s,
    );
    expect(css).toMatch(
      /\.settings-right-edge\s*\{[^}]*width:\s*10px[^}]*background:\s*var\(--sidebar-surface\)/s,
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

  it('groups font and editor security settings under secondary headings', () => {
    expect(document.querySelectorAll('.settings-subheading')).toHaveLength(5);
    expect(document.querySelector('.settings-nav [data-panel="fonts"]')).not.toBeNull();
    expect(
      document.querySelector('[data-settings-panel="fonts"] [name="uiFontFamily"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-settings-panel="editor"] .settings-security-card'),
    ).not.toBeNull();
  });

  it('uses a compact workspace-name explorer header', () => {
    expect(document.querySelector('#workspaceName')).not.toBeNull();
    expect(document.querySelector('#refreshTree')).not.toBeNull();
    expect(document.querySelector('#refreshTree .refresh-tree-icon')).not.toBeNull();
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
    expect(document.querySelector('.about-panel .about-logo')?.getAttribute('src')).toBe(
      'app://app/assets/app-icon/vditor-desktop.svg',
    );
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
      /\.editor-host\.vditor\.active\s*\{[^}]*--panel-background-color:\s*var\(--editor-surface\)[^}]*--textarea-background-color:\s*var\(--editor-surface\)/s,
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

  it('assigns stable theme-aware boundaries to each top toolbar surface', () => {
    expect(css).toContain('--top-surface-shadow:');
    expect(css).toMatch(/\.sidebar-tabs\s*\{[^}]*box-shadow:\s*var\(--top-surface-shadow\)/s);
    expect(css).toMatch(/\.titlebar\s*\{[^}]*border-bottom:\s*0;[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(
      /\.toolbar-sidebar-tabs\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)[^}]*box-shadow:\s*var\(--top-surface-shadow\)/s,
    );
    expect(css).toMatch(
      /\.vditor-toolbar-mount > \.vditor-toolbar\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)[^}]*box-shadow:\s*var\(--top-surface-shadow\)/s,
    );
    expect(css).toMatch(
      /\.toolbar-skeleton\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)[^}]*box-shadow:\s*var\(--top-surface-shadow\)/s,
    );
    expect(css).toMatch(
      /#app\.sidebar-transitioning \.vditor-toolbar-mount::before\s*\{[^}]*box-shadow:\s*var\(--top-surface-shadow\)/s,
    );
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
    ).toHaveLength(11);
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

  it('provides a bounded workspace directory read-depth setting', () => {
    const input = document.querySelector('[name="workspaceReadDepth"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('range');
    expect(input.min).toBe('7');
    expect(input.max).toBe('12');
    expect(input.step).toBe('1');
    expect(document.querySelector('#workspaceReadDepthValue')).not.toBeNull();
    expect(rendererScript).toContain('syncWorkspaceReadDepthValue');
    expect(css).toMatch(/\.tree-depth-notice\s*\{[^}]*user-select:\s*none/s);
  });

  it('loads the Vditor compatibility adapter before the application renderer', () => {
    const scripts = Array.from(document.querySelectorAll('script')).map((script) => script.src);
    expect(scripts.at(-3)).toContain('vditor-adapter.js');
    expect(scripts.at(-2)).toContain('app.js');
    expect(scripts.at(-1)).toContain('main.js');
    expect(rendererScript).toContain('window.VditorDesktopAdapter');
  });

  it('shows the configuration path and current-page reset in the settings footer', () => {
    expect(document.querySelector('.settings-card > footer #settingsPath')).not.toBeNull();
    expect(document.querySelector('#openSettingsFolder .settings-path-icon')).not.toBeNull();
    expect(document.querySelector('#resetSettingsPage')).not.toBeNull();
  });
});
