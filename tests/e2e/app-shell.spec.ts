import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  closeApp,
  createNewTab,
  launchApp,
  readSetting,
  selectThemeMode,
} from './support/app-harness';

test('forwards Markdown files from a second application invocation', async () => {
  const running = await launchApp();
  try {
    const { app, page, testRoot } = running;
    const filePath = path.join(testRoot, 'second invocation.md');
    fs.writeFileSync(filePath, '# Opened by second instance');
    await app.evaluate(
      ({ app: electronApp }, payload) => {
        electronApp.emit(
          'second-instance',
          {} as Electron.Event,
          [process.execPath, payload.filePath],
          payload.workingDirectory,
          {},
        );
      },
      { filePath, workingDirectory: testRoot },
    );
    await expect(page.locator('.document-tab.active > span')).toHaveText('second invocation.md');
    await expect(page.locator('.editor-host.active')).toContainText('Opened by second instance');
  } finally {
    await closeApp(running);
  }
});

test('creates numbered tabs and shows the empty state after closing all tabs', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await expect(page.locator('#noTabs')).toBeVisible();
    await expect(page.locator('#app')).not.toHaveClass(/toolbar-unavailable/);
    await expect(page.locator('#vditorToolbarMount > .vditor-toolbar')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('#vditorToolbarMount > .vditor-toolbar button')
          .evaluateAll(
            (buttons) => buttons.length > 0 && buttons.every((button) => button.disabled),
          ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const save = document.querySelector('#saveFile');
          const buttons = Array.from(
            document.querySelectorAll(
              '#vditorToolbarMount > .vditor-toolbar .vditor-toolbar__item button',
            ),
          );
          if (!(save instanceof HTMLElement) || !buttons.length) return false;
          const saveColor = getComputedStyle(save).color;
          return buttons.every((button) => getComputedStyle(button).color === saveColor);
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator('#tabBar .tabbar-drag-fill')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
      )
      .toBe('drag');
    await page.locator('[data-menu="main"]').click();
    await expect(page.locator('.app-menu-popup button', { hasText: 'Close Tab' })).toHaveCount(0);
    const editModeMenu = page.locator('.app-menu-popup button.has-submenu', {
      hasText: 'Editing Mode',
    });
    await expect(editModeMenu).toBeDisabled();
    await editModeMenu.hover();
    await expect(page.locator('.app-menu-popup.submenu')).toHaveCount(0);
    await page.locator('.app-menu-popup button.has-submenu', { hasText: 'Layout' }).click();
    const toolbarItem = page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' });
    await expect(toolbarItem).toBeEnabled();
    await expect(toolbarItem.locator('.checkmark')).toHaveText('✓');
    await toolbarItem.click();
    await expect(page.locator('#vditorToolbarMount')).toBeHidden();
    await page.locator('[data-menu="main"]').click();
    await page.locator('[data-menu="main"]').click();
    await page.locator('.app-menu-popup button.has-submenu', { hasText: 'Layout' }).click();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' }).click();
    await expect(page.locator('#vditorToolbarMount > .vditor-toolbar')).toBeVisible();
    await page.locator('[data-menu="main"]').click();
    await expect(page.locator('.app-menu-popup')).toHaveCount(0);

    await page.locator('#addTab').click();
    await expect(page.locator('.document-tab span')).toHaveText(['Untitled 1']);
    await expect(page.locator('#app')).not.toHaveClass(/toolbar-unavailable/);
    await expect(page.locator('#vditorToolbarMount')).toBeVisible();
    await page.locator('[data-menu="main"]').click();
    await expect(page.locator('.app-menu-popup button', { hasText: 'Close Tab' })).toBeVisible();
    await page.locator('[data-menu="main"]').click();
    await page.locator('#addTab').click();
    await expect(page.locator('.document-tab span')).toHaveText(['Untitled 1', 'Untitled 2']);

    await page.locator('.document-tab').last().locator('b').click();
    await page.locator('.document-tab').last().locator('b').click();
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await expect(page.locator('#noTabs')).toBeVisible();
    await expect(page.locator('#emptyNewFile')).toBeVisible();
    await expect(page.locator('#emptyOpenFile')).toBeVisible();
    await page.locator('[data-menu="main"]').click();
    await expect(page.locator('.app-menu-popup button', { hasText: 'Close Tab' })).toHaveCount(0);
  } finally {
    await closeApp(running);
  }
});

test('uses a unified workbench bar and links sidebar visibility to file actions', async () => {
  const running = await launchApp({ sidebarVisible: true });
  try {
    const { page } = running;
    await createNewTab(page);
    await expect(page.locator('#windowTitlebar #tabBar')).toBeVisible();
    await expect(page.locator('.main-area > #tabBar')).toHaveCount(0);
    await expect(page.locator('#windowTitlebar .titlebar-file-actions')).toBeVisible();
    await expect(page.locator('header.titlebar .toolbar-sidebar-tabs')).toBeVisible();
    await expect(page.locator('#appMenuBar [data-menu="main"]')).toHaveCount(1);
    await expect(page.locator('#appMenuBar .app-menu-logo')).toBeVisible();
    await expect(page.locator('.titlebar-drag-region')).toHaveCSS('width', '44px');
    await expect
      .poll(() =>
        page
          .locator('.toolbar-sidebar-tabs [data-view="files"]')
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .not.toBe('rgba(0, 0, 0, 0)');
    const alignedDividers = await page.evaluate(() => {
      const tabs = document.querySelector('#tabBar').getBoundingClientRect();
      const sidebarTabs = document.querySelector('.toolbar-sidebar-tabs').getBoundingClientRect();
      return Math.abs(tabs.left - sidebarTabs.right);
    });
    expect(alignedDividers).toBeLessThan(1);
    await page.locator('#sidebar').evaluate((node) => (node.style.width = '440px'));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const sidebar = document.querySelector('#sidebar').getBoundingClientRect();
          const tabs = document.querySelector('#tabBar').getBoundingClientRect();
          const sidebarTabs = document
            .querySelector('.toolbar-sidebar-tabs')
            .getBoundingClientRect();
          return Math.max(
            Math.abs(sidebar.right - tabs.left),
            Math.abs(sidebar.right - sidebarTabs.right),
          );
        }),
      )
      .toBeLessThan(1);
    await expect(page.locator('.toolbar-sidebar-tabs button').first()).toHaveCSS(
      'white-space',
      'nowrap',
    );
    for (let index = 0; index < 8; index += 1) await page.locator('#addTab').click();
    const chromeLayout = await page.evaluate(() => {
      const menu = document.querySelector('#appMenuBar').getBoundingClientRect();
      const actions = document.querySelector('.titlebar-file-actions').getBoundingClientRect();
      const tabs = document.querySelector('#tabBar').getBoundingClientRect();
      const controls = document.querySelector('.window-controls').getBoundingClientRect();
      const tabBar = document.querySelector('#tabBar');
      return {
        menuRight: menu.right,
        actionsLeft: actions.left,
        actionsRight: actions.right,
        tabsLeft: tabs.left,
        tabsRight: tabs.right,
        controlsLeft: controls.left,
        scrollHeight: tabBar.scrollHeight,
        clientHeight: tabBar.clientHeight,
      };
    });
    expect(chromeLayout.actionsLeft).toBeGreaterThanOrEqual(chromeLayout.menuRight - 1);
    expect(chromeLayout.tabsLeft).toBeGreaterThanOrEqual(chromeLayout.actionsRight - 1);
    expect(chromeLayout.tabsRight).toBeLessThanOrEqual(chromeLayout.controlsLeft + 1);
    expect(chromeLayout.scrollHeight).toBe(chromeLayout.clientHeight);

    const editorBefore = await page.locator('#editorArea').boundingBox();
    await page.locator('#toggleSidebar').click();
    await expect(page.locator('#app')).toHaveClass(/sidebar-collapsed/);
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
    await expect(
      page.locator('#windowTitlebar .titlebar-file-actions > #toggleSidebar'),
    ).toBeVisible();
    await expect
      .poll(async () => (await page.locator('#windowTitlebar #newFile').boundingBox())?.width || 0)
      .toBeLessThan(2);
    await expect
      .poll(
        async () =>
          (await page.locator('header.titlebar .toolbar-sidebar-tabs').boundingBox())?.width || 0,
      )
      .toBeLessThan(2);
    await expect
      .poll(async () => (await page.locator('#editorArea').boundingBox())?.width || 0)
      .toBeGreaterThan(editorBefore?.width || 0);

    await page.locator('#toggleSidebar').click();
    await expect(page.locator('#app')).not.toHaveClass(/sidebar-collapsed/);
    await expect(page.locator('#windowTitlebar .titlebar-file-actions')).toBeVisible();
    await expect(page.locator('header.titlebar .toolbar-sidebar-tabs')).toBeVisible();
  } finally {
    await closeApp(running);
  }
});

test('reorders tabs by dragging within the unified workbench bar', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    await createNewTab(page);
    await createNewTab(page);
    await expect(page.locator('#windowTitlebar .document-tab span')).toHaveText([
      'Untitled 1',
      'Untitled 2',
      'Untitled 3',
    ]);
    const first = page.locator('#windowTitlebar .document-tab').first();
    const third = page.locator('#windowTitlebar .document-tab').nth(2);
    await first.dragTo(third);
    await expect(page.locator('#windowTitlebar .document-tab span')).toHaveText([
      'Untitled 2',
      'Untitled 1',
      'Untitled 3',
    ]);
    await expect(page.locator('#windowTitlebar .document-tab.active span')).toHaveText(
      'Untitled 3',
    );
  } finally {
    await closeApp(running);
  }
});

test('scrolls overflowing document tabs with the mouse wheel', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    for (let index = 0; index < 5; index += 1) await createNewTab(page);
    const tabBar = page.locator('#tabBar');
    await tabBar.evaluate((node) => {
      node.style.flex = '0 0 240px';
    });
    const before = await tabBar.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollLeft: node.scrollLeft,
      scrollWidth: node.scrollWidth,
    }));
    expect(before.scrollLeft).toBe(0);
    expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
    await tabBar.hover();
    await page.mouse.wheel(0, 160);
    await expect.poll(() => tabBar.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  } finally {
    await closeApp(running);
  }
});

test('opens the View > Layout submenu and toggles the unified toolbar', async () => {
  const running = await launchApp({ sidebarVisible: true });
  try {
    const { page } = running;
    await createNewTab(page);
    const layoutMenu = () =>
      page.locator('.app-menu-popup:not(.submenu) button.has-submenu', { hasText: 'Layout' });
    await page.locator('[data-menu="main"]').click();
    await layoutMenu().click();
    await expect(page.locator('.app-menu-popup.submenu')).toBeVisible();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' }).click();
    await expect(page.locator('#app')).toHaveClass(/toolbar-hidden/);
    await expect(page.locator('header.titlebar .toolbar-sidebar-tabs')).toBeVisible();
    await expect(page.locator('#vditorToolbarMount')).toBeHidden();
    const titlebarBox = await page.locator('#windowTitlebar').boundingBox();
    const editorBox = await page.locator('#editorArea').boundingBox();
    expect(editorBox?.y || 0).toBeCloseTo((titlebarBox?.y || 0) + (titlebarBox?.height || 0), 0);

    await expect(page.locator('#appMenuBar [data-menu="file"]')).toHaveCount(0);
    await expect(page.locator('#appMenuBar [data-menu="view"]')).toHaveCount(0);
  } finally {
    await closeApp(running);
  }
});

test('keeps wrapped toolbar menus out of editor geometry and retains the hidden-toolbar shadow', async () => {
  const running = await launchApp({ sidebarVisible: true });
  try {
    const { app, page } = running;
    await createNewTab(page);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700));
    await expect(page.locator('#app')).toHaveClass(/toolbar-wrapped/);
    const codeTheme = page.locator('#vditorToolbarMount button[data-type="code-theme"]');
    const geometry = () =>
      page.evaluate(() => {
        const toolbar = document.querySelector('#vditorToolbarMount > .vditor-toolbar');
        const main = document.querySelector('.main-area');
        if (!toolbar || !main) throw new Error('Toolbar layout is unavailable');
        return {
          toolbarHeight: toolbar.getBoundingClientRect().height,
          mainTop: main.getBoundingClientRect().top,
          mainPaddingTop: getComputedStyle(main).paddingTop,
        };
      });
    const beforeMenu = await geometry();

    await codeTheme.click();
    await expect(page.locator('#vditorToolbarMount .vditor-hint:visible')).toHaveCount(1);
    expect(await geometry()).toEqual(beforeMenu);

    const layoutMenu = () =>
      page.locator('.app-menu-popup:not(.submenu) button.has-submenu', { hasText: 'Layout' });
    await page.locator('[data-menu="main"]').click();
    await layoutMenu().click();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' }).click();
    await expect(page.locator('#app')).toHaveClass(/toolbar-hidden/);
    const titlebarShadow = () =>
      page.locator('#windowTitlebar').evaluate((node) => {
        const style = getComputedStyle(node, '::after');
        return {
          height: Number.parseFloat(style.height),
          left: Number.parseFloat(style.left),
          shadow: style.boxShadow,
        };
      });
    await expect
      .poll(async () => {
        const shadow = await titlebarShadow();
        return shadow.shadow !== 'none' && shadow.shadow !== '' && shadow.height > 30;
      })
      .toBe(true);
    const visibleSidebarShadow = await titlebarShadow();
    const sidebarWidth = await page
      .locator('#sidebar')
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(visibleSidebarShadow.left).toBeCloseTo(sidebarWidth, 0);

    await page.locator('#toggleSidebar').click();
    await expect(page.locator('#app')).toHaveClass(/sidebar-collapsed/);
    await expect.poll(async () => (await titlebarShadow()).left).toBe(0);
    expect((await titlebarShadow()).height).toBeGreaterThan(30);
  } finally {
    await closeApp(running);
  }
});

test('keeps the sidebar tab boundary stable while toggling a wrapped toolbar across themes', async () => {
  const running = await launchApp({ sidebarVisible: true });
  try {
    const { app, page } = running;
    await createNewTab(page);

    const themes = [
      'classic',
      'dark',
      'monokai-pro-light',
      'monokai-pro-dark',
      'claude-light',
      'claude-dark',
    ];
    const readBoundary = () =>
      page.evaluate(() => {
        const tabs = document.querySelector('.toolbar-sidebar-tabs');
        const titlebar = document.querySelector('header.titlebar');
        if (!(tabs instanceof HTMLElement) || !(titlebar instanceof HTMLElement))
          throw new Error('Shared toolbar boundary is unavailable');
        const read = (node: HTMLElement) => {
          const style = getComputedStyle(node);
          return {
            borderBottom: style.borderBottom,
            boxShadow: style.boxShadow,
            overflow: style.overflow,
          };
        };
        return { tabs: read(tabs), titlebar: read(titlebar) };
      });
    const toggleToolbar = async () => {
      let toolbarItem = page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' });
      if (!(await toolbarItem.count())) {
        await page.locator('[data-menu="main"]').click();
        await page
          .locator('.app-menu-popup:not(.submenu) button.has-submenu', { hasText: 'Layout' })
          .click();
        toolbarItem = page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' });
      }
      await toolbarItem.click();
    };

    const assertStableBoundaryAcrossThemes = async () => {
      for (const theme of themes) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const visible = await readBoundary();

        await toggleToolbar();
        await expect(page.locator('#app')).toHaveClass(/toolbar-hidden/);
        await expect
          .poll(() =>
            page.locator('#app').evaluate((node) => node.classList.contains('toolbar-wrapped')),
          )
          .toBe(false);
        expect(await readBoundary()).toEqual(visible);

        await toggleToolbar();
        expect(await readBoundary()).toEqual(visible);
      }
    };

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 700));
    await expect(page.locator('#app')).not.toHaveClass(/toolbar-wrapped/);
    await assertStableBoundaryAcrossThemes();

    await page.locator('[data-menu="main"]').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700));
    await expect(page.locator('#app')).toHaveClass(/toolbar-wrapped/);
    await assertStableBoundaryAcrossThemes();
  } finally {
    await closeApp(running);
  }
});

test('hides the custom titlebar while Electron is fullscreen', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await page.keyboard.press('F11');
    await expect(page.locator('#app')).toHaveClass(/fullscreen/);
    await expect(page.locator('#windowTitlebar')).toBeHidden();
    await page.keyboard.press('Alt');
    await expect(page.locator('#app')).toHaveClass(/fullscreen-menu-visible/);
    await expect(page.locator('#windowTitlebar')).toBeVisible();
    await page.keyboard.press('Alt');
    await expect(page.locator('#app')).not.toHaveClass(/fullscreen-menu-visible/);
    await expect(page.locator('#windowTitlebar')).toBeHidden();
    await page.keyboard.press('F11');
    await expect(page.locator('#app')).not.toHaveClass(/fullscreen/);
    await expect(page.locator('#windowTitlebar')).toBeVisible();
  } finally {
    await closeApp(running);
  }
});

test('keeps the active edit mode after saving settings', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expect(page.locator('.editor-host.active .vditor-wysiwyg')).toBeVisible();

    await page.locator('#statusSettings').click();
    await page.locator('.settings-nav button[data-panel="fonts"]').click();
    await page.locator('[name="uiFontFamily"]').fill('system-ui, sans-serif');
    await page.locator('#saveSettings').click();

    await expect(page.locator('.editor-host.active .vditor-wysiwyg')).toBeVisible();
    await expect(page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]')).toHaveClass(
      /vditor-menu--current/,
    );
  } finally {
    await closeApp(running);
  }
});

test('hides multi-platform preview actions by default and exposes them from settings', async () => {
  const running = await launchApp({ editMode: 'sv' });
  try {
    const { page } = running;
    await createNewTab(page);
    const actions = page.locator('.editor-host.active .vditor-preview__action');
    await expect(actions).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator('.editor-host.active .vditor-preview > .vditor-reset')
          .evaluate((node) => node.style.width),
      )
      .toMatch(/^(|auto)$/);

    await page.locator('#statusSettings').click();
    await page.locator('.settings-nav [data-panel="preview"]').click();
    const markdownChecks = page.locator('[data-settings-panel="preview"] .check-grid label');
    await expect(markdownChecks).toHaveCount(12);
    await expect(page.locator('[name="lineNumbers"] + span')).toHaveText(
      'Code block preview line numbers',
    );
    const checkLayout = await markdownChecks.evaluateAll((labels) => ({
      rows: new Set(labels.map((label) => Math.round(label.getBoundingClientRect().top))).size,
      aligned: labels.every((label) => {
        const style = getComputedStyle(label);
        return (
          style.display === 'flex' && style.alignItems === 'center' && style.marginTop === '0px'
        );
      }),
    }));
    expect(checkLayout.rows).toBeLessThanOrEqual(4);
    expect(checkLayout.aligned).toBe(true);
    const setting = page.locator('[name="multiPlatformPreview"]');
    await expect(setting).not.toBeChecked();
    await setting.check();

    await expect(actions).toBeVisible();
    await expect(actions.locator('button')).toHaveCount(5);
    await expect(actions.locator('[data-type="desktop"]')).toHaveClass(
      /vditor-preview__action--current/,
    );

    await setting.uncheck();
    await expect(actions).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator('.editor-host.active .vditor-preview > .vditor-reset')
          .evaluate((node) => node.style.width),
      )
      .toMatch(/^(|auto)$/);
  } finally {
    await closeApp(running);
  }
});

test('links Light and Dark content themes to the application theme', async () => {
  const running = await launchApp({ theme: 'classic', contentTheme: 'light' });
  try {
    const { page, testRoot } = running;
    await createNewTab(page);

    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('dark');

    await selectThemeMode(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('light');

    await page.locator('#statusSettings').click();
    await expect(page.locator('.settings-card > header h2')).toHaveText('Vditor Desktop Settings');
    await expect(page.locator('.settings-nav button > .settings-nav-icon')).toHaveCount(6);
    await page.locator('[name="contentTheme"]').selectOption('ant-design');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('ant-design');
    await page.locator('#saveSettings').click();

    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('ant-design');
  } finally {
    await closeApp(running);
  }
});

test('offers three theme modes from the status bar and removes the settings checkbox', async () => {
  const running = await launchApp({
    theme: 'claude-light',
    lightTheme: 'claude-light',
    darkTheme: 'monokai-pro-dark',
  });
  try {
    const { page, testRoot } = running;
    const trigger = page.locator('#statusThemeMode');
    const menu = page.locator('#statusThemeMenu');
    await expect(trigger).toHaveAttribute('data-theme-mode', 'light');

    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-theme-mode]')).toHaveCount(3);
    await expect(menu.locator('[data-theme-mode]')).toHaveText(['', '', '']);
    await expect(menu.locator('[data-theme-mode="light"]')).toHaveAttribute('aria-checked', 'true');
    await expect(menu.locator('[data-theme-mode="system"]')).toHaveAttribute(
      'aria-label',
      'Follow system theme',
    );

    await menu.locator('[data-theme-mode="dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-dark');
    await expect(trigger).toHaveAttribute('data-theme-mode', 'dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'systemTheme')).toBe(false);
    await expect.poll(() => readSetting(testRoot, 'appearance', 'theme')).toBe('monokai-pro-dark');

    await selectThemeMode(page, 'system');
    const systemTheme = await page.evaluate(() => window.appAPI.getSystemTheme());
    const expectedTheme = systemTheme === 'dark' ? 'monokai-pro-dark' : 'claude-light';
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    await expect(trigger).toHaveAttribute('data-theme-mode', 'system');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'systemTheme')).toBe(true);

    await page.locator('#statusSettings').click();
    await expect(
      page.locator('[data-settings-panel="appearance"] [name="systemTheme"]'),
    ).toHaveCount(0);
    await page.locator('.theme-option-monokai-light').click();
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'lightTheme'))
      .toBe('monokai-pro-light');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'theme')).toBe('monokai-pro-dark');
    await page.locator('#saveSettings').click();
    await selectThemeMode(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-light');
    await selectThemeMode(page, 'system');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'systemTheme')).toBe(true);
  } finally {
    await closeApp(running);
  }
});

for (const appTheme of ['dark', 'monokai-pro-dark'] as const) {
  for (const contentTheme of ['ant-design', 'wechat'] as const) {
    test(`keeps ${contentTheme} content readable in ${appTheme}`, async () => {
      const running = await launchApp({
        theme: appTheme,
        darkTheme: appTheme,
        contentTheme,
        editMode: 'ir',
      });
      try {
        const { page } = running;
        await createNewTab(page);
        await page
          .locator('.editor-host.active .vditor-ir .vditor-reset')
          .fill('Inline `code`\n\n| Head | Value |\n| --- | --- |\n| A | B |');
        await expect(page.locator('#vditorContentTheme')).toHaveAttribute(
          'href',
          new RegExp(`${contentTheme}\\.css$`),
        );

        const assertReadable = async (modeSelector: string) => {
          const colors = await page.locator(`${modeSelector} .vditor-reset`).evaluate((root) => {
            const code = root.querySelector('code:not(.hljs):not(.highlight-chroma)');
            const cell = root.querySelector('td');
            const heading = root.querySelector('h1');
            const read = (node: Element | null) =>
              node
                ? {
                    color: getComputedStyle(node).color,
                    background: getComputedStyle(node).backgroundColor,
                  }
                : null;
            return { code: read(code), cell: read(cell), heading: read(heading) };
          });
          expect(colors.code?.color).not.toBe('rgb(51, 51, 51)');
          expect(colors.cell?.color).not.toBe('rgb(255, 255, 255)');
          expect(colors.cell?.background).not.toBe('rgb(255, 255, 255)');
          expect(colors.heading?.color).not.toBe('rgb(0, 0, 0)');
        };

        await assertReadable('.editor-host.active .vditor-ir');
        const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
        await modeTrigger.click();
        await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
        await assertReadable('.editor-host.active .vditor-wysiwyg');
        await modeTrigger.click();
        await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
        await assertReadable('.editor-host.active .vditor-preview');
      } finally {
        await closeApp(running);
      }
    });
  }
}

test('selects manual light and dark modes using each configured theme', async () => {
  const running = await launchApp({
    theme: 'monokai-pro-dark',
    darkTheme: 'monokai-pro-dark',
    contentTheme: 'dark',
  });
  try {
    const { page, testRoot } = running;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-dark');
    await expect(page.locator('#statusThemeMode')).toHaveAttribute('data-theme-mode', 'dark');

    await selectThemeMode(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'darkTheme'))
      .toBe('monokai-pro-dark');

    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'theme')).toBe('monokai-pro-dark');

    await page.locator('#statusSettings').click();
    await page.locator('.theme-option-dark').click();
    await expect.poll(() => readSetting(testRoot, 'appearance', 'darkTheme')).toBe('dark');
    await page.locator('#saveSettings').click();
    await selectThemeMode(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally {
    await closeApp(running);
  }
});

test('switches between separately selected application themes without changing editor font settings', async () => {
  const running = await launchApp({
    theme: 'claude-light',
    lightTheme: 'claude-light',
    darkTheme: 'dark',
    contentTheme: 'light',
  });
  try {
    const { page, testRoot } = running;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-light');
    await expect(page.locator('#app')).toHaveCSS('background-color', 'rgb(250, 249, 245)');

    await createNewTab(page);
    const editor = page.locator('.editor-host.active .vditor-content');
    await editor.evaluate((node) => node.setAttribute('data-theme-test-editor', 'true'));
    await page.locator('#statusSettings').click();
    await expect(page.locator('[name="lightTheme"][value="claude-light"]')).toBeChecked();
    await expect(page.locator('[name="darkTheme"][value="dark"]')).toBeChecked();
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(245, 244, 237)');
    await expect(page.locator('.settings-content')).toHaveCSS(
      'background-color',
      'rgb(250, 249, 245)',
    );
    await expect(page.locator('#saveSettings')).toHaveCSS('background-color', 'rgb(217, 119, 87)');
    await page.locator('.theme-option-monokai').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-light');
    await expect(page.locator('[name="darkTheme"][value="monokai-pro-dark"]')).toBeChecked();
    await expect(
      page.locator('.editor-host.active .vditor-content[data-theme-test-editor="true"]'),
    ).toBeVisible();
    await page.locator('#saveSettings').click();

    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-dark');
    await expect(page.locator('#app')).toHaveCSS('background-color', 'rgb(45, 42, 46)');
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'darkTheme'))
      .toBe('monokai-pro-dark');

    await selectThemeMode(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude-light');
    await expect(page.locator('#app')).toHaveCSS('background-color', 'rgb(250, 249, 245)');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'lightTheme')).toBe('claude-light');
  } finally {
    await closeApp(running);
  }
});

test('colors all six rendered heading levels in Monokai Pro Dark', async () => {
  const running = await launchApp({
    theme: 'monokai-pro-dark',
    darkTheme: 'monokai-pro-dark',
    editMode: 'ir',
  });
  try {
    const { page } = running;
    await createNewTab(page);
    const markdown = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const expected = [
      'rgb(255, 97, 136)',
      'rgb(255, 216, 102)',
      'rgb(169, 220, 118)',
      'rgb(120, 220, 232)',
      'rgb(171, 157, 242)',
      'rgb(252, 152, 103)',
    ];
    const headingColors = (root: string, prefix = '.') =>
      page.evaluate(
        ({ rootSelector, classPrefix }) =>
          Array.from({ length: 6 }, (_, index) => {
            const level = index + 1;
            const heading = document.querySelector(`${rootSelector} ${classPrefix}h${level}`);
            return heading ? getComputedStyle(heading).color : null;
          }),
        { rootSelector: root, classPrefix: prefix },
      );

    await page.locator('.editor-host.active .vditor-ir .vditor-reset').fill(markdown);
    await expect.poll(() => headingColors('.editor-host.active .vditor-ir', '')).toEqual(expected);

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expect
      .poll(() => headingColors('.editor-host.active .vditor-wysiwyg', ''))
      .toEqual(expected);

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
    await expect
      .poll(() => headingColors('.editor-host.active .vditor-preview', ''))
      .toEqual(expected);
  } finally {
    await closeApp(running);
  }
});

test('uses the sidebar surface for the custom main menu in light themes', async () => {
  const running = await launchApp({
    theme: 'claude-light',
    lightTheme: 'claude-light',
    darkTheme: 'dark',
  });
  try {
    const { page } = running;
    const mainMenu = page.locator('.app-menu-bar > button[data-menu="main"]');
    await expect(mainMenu).toHaveCSS('background-color', 'rgb(245, 244, 237)');
    await mainMenu.click();
    await expect(page.locator('.app-menu-popup').first()).toHaveCSS(
      'background-color',
      'rgb(245, 244, 237)',
    );

    await page.locator('#statusSettings').click();
    await page.locator('.theme-option-monokai-light').click();
    await page.locator('#saveSettings').click();
    await selectThemeMode(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-light');
    await expect(mainMenu).toHaveCSS('background-color', 'rgb(237, 231, 229)');
    await mainMenu.click();
    await expect(page.locator('.app-menu-popup').first()).toHaveCSS(
      'background-color',
      'rgb(237, 231, 229)',
    );
  } finally {
    await closeApp(running);
  }
});

test('uses consistent navigation and document surfaces across all application themes', async () => {
  const themes = [
    { theme: 'classic', sidebar: 'rgb(240, 241, 243)', editor: 'rgb(255, 255, 255)' },
    { theme: 'dark', sidebar: 'rgb(32, 33, 36)', editor: 'rgb(24, 25, 28)' },
    { theme: 'claude-light', sidebar: 'rgb(245, 244, 237)', editor: 'rgb(250, 249, 245)' },
    { theme: 'claude-dark', sidebar: 'rgb(48, 48, 46)', editor: 'rgb(38, 38, 36)' },
    { theme: 'monokai-pro-light', sidebar: 'rgb(237, 231, 229)', editor: 'rgb(250, 244, 242)' },
    { theme: 'monokai-pro-dark', sidebar: 'rgb(45, 42, 46)', editor: 'rgb(39, 36, 40)' },
  ] as const;

  for (const { theme, sidebar, editor } of themes) {
    const running = await launchApp({ theme, systemTheme: false });
    try {
      const { page } = running;
      await expect(page.locator('.sidebar')).toHaveCSS('background-color', sidebar);
      await expect(page.locator('.editor-area')).toHaveCSS('background-color', sidebar);
      await expect(page.locator('#emptyNewFile')).toHaveCSS('background-color', sidebar);
      await expect(page.locator('#emptyOpenFile')).toHaveCSS('background-color', sidebar);
      await expect(page.locator('.window-titlebar')).toHaveCSS('background-color', sidebar);
      await createNewTab(page);
      await expect(page.locator('#vditorToolbarMount > .vditor-toolbar')).toHaveCSS(
        'background-color',
        sidebar,
      );
      await expect(page.locator('.editor-host.active .vditor-content')).toHaveCSS(
        'background-color',
        editor,
      );
      const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
      await modeTrigger.click();
      await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
      await expect(page.locator('.editor-host.active .sv-line-numbers')).toHaveCSS(
        'background-color',
        editor,
      );
      if (theme === 'claude-dark') {
        const tab = page.locator('.document-tab').first();
        await tab.hover();
        await expect(tab).toHaveCSS('background-color', 'rgb(61, 61, 58)');
      }
    } finally {
      await closeApp(running);
    }
  }
});

test('colors all six rendered heading levels in Monokai Pro Light', async () => {
  const running = await launchApp({
    theme: 'monokai-pro-light',
    lightTheme: 'monokai-pro-light',
    editMode: 'ir',
  });
  try {
    const { page } = running;
    await createNewTab(page);
    const markdown = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const expected = [
      'rgb(212, 0, 69)',
      'rgb(255, 127, 0)',
      'rgb(102, 184, 43)',
      'rgb(9, 63, 134)',
      'rgb(52, 12, 129)',
      'rgb(55, 53, 48)',
    ];
    const headingColors = (root: string, prefix = '.') =>
      page.evaluate(
        ({ rootSelector, classPrefix }) =>
          Array.from({ length: 6 }, (_, index) => {
            const level = index + 1;
            const heading = document.querySelector(`${rootSelector} ${classPrefix}h${level}`);
            return heading ? getComputedStyle(heading).color : null;
          }),
        { rootSelector: root, classPrefix: prefix },
      );

    await page.locator('.editor-host.active .vditor-ir .vditor-reset').fill(markdown);
    await expect.poll(() => headingColors('.editor-host.active .vditor-ir', '')).toEqual(expected);

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expect
      .poll(() => headingColors('.editor-host.active .vditor-wysiwyg', ''))
      .toEqual(expected);

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
    await expect
      .poll(() => headingColors('.editor-host.active .vditor-preview', ''))
      .toEqual(expected);
  } finally {
    await closeApp(running);
  }
});

for (const theme of ['classic', 'dark', 'monokai-pro-dark'] as const) {
  test(`keeps editor backgrounds stable across focus changes in ${theme}`, async () => {
    const running = await launchApp({
      theme,
      darkTheme: theme === 'monokai-pro-dark' ? 'monokai-pro-dark' : 'dark',
      contentTheme: theme === 'classic' ? 'light' : 'dark',
      editMode: 'sv',
    });
    try {
      const { page } = running;
      await createNewTab(page);
      await page.locator('.editor-host.active .vditor-sv').fill('# Stable background');

      const assertStableBackground = async (surfaceSelector: string) => {
        const surface = page.locator(surfaceSelector);
        await expect(surface).toBeVisible();
        await page.locator('.document-tab.active').click();
        const blurred = await surface.evaluate((node) => getComputedStyle(node).backgroundColor);
        await surface.click();
        const focused = await surface.evaluate((node) => getComputedStyle(node).backgroundColor);
        const editorSurface = await page.evaluate(() => {
          const probe = document.createElement('div');
          probe.style.backgroundColor = 'var(--editor-surface)';
          document.body.appendChild(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        });
        expect({ blurred, focused }).toEqual({
          blurred: editorSurface,
          focused: editorSurface,
        });
      };

      await assertStableBackground('.editor-host.active .vditor-sv');
      const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
      await modeTrigger.click();
      await page.locator('#vditorToolbarMount button[data-mode="ir"]').click();
      await assertStableBackground('.editor-host.active .vditor-ir > .vditor-reset');
      await modeTrigger.click();
      await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
      await assertStableBackground('.editor-host.active .vditor-wysiwyg > .vditor-reset');
    } finally {
      await closeApp(running);
    }
  });
}

test('saves settings live and keeps the enlarged settings dialog draggable', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await page.locator('#statusSettings').click();
    const card = page.locator('.settings-card');
    await expect(page.locator('.theme-preview')).toHaveCount(6);
    await expect(page.locator('[name="lightTheme"][value="classic"]')).toBeChecked();
    await expect(page.locator('[name="darkTheme"][value="dark"]')).toBeChecked();
    const themePreviewWidths = await page
      .locator('.theme-preview')
      .evaluateAll((previews) =>
        previews.map((preview) => Math.round(preview.getBoundingClientRect().width)),
      );
    expect(new Set(themePreviewWidths).size).toBe(1);
    await expect
      .poll(() => card.evaluate((node) => getComputedStyle(node).transform))
      .toBe('matrix(1, 0, 0, 1, 0, 0)');
    const edgeChrome = await page.evaluate(() => {
      const edge = document.querySelector('.settings-right-edge');
      const header = document.querySelector('.settings-card > header');
      if (!edge || !header) throw new Error('Settings chrome is incomplete');
      return {
        edge: getComputedStyle(edge).backgroundColor,
        header: getComputedStyle(header).backgroundColor,
        width: edge.getBoundingClientRect().width,
      };
    });
    expect(edgeChrome.edge).toBe(edgeChrome.header);
    expect(edgeChrome.width).toBe(10);
    const initial = await card.boundingBox();
    expect(initial?.width).toBeGreaterThan(900);
    const header = card.locator(':scope > header');
    const headerBox = await header.boundingBox();
    if (!initial || !headerBox) throw new Error('Settings dialog has no bounding box');
    await page.mouse.move(headerBox.x + 80, headerBox.y + 15);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 120, headerBox.y + 45);
    await page.mouse.up();
    const moved = await card.boundingBox();
    expect(moved?.x).not.toBe(initial.x);

    await page.locator('.theme-option-dark').click();
    await expect.poll(() => readSetting(running.testRoot, 'appearance', 'darkTheme')).toBe('dark');
    await expect.poll(() => readSetting(running.testRoot, 'appearance', 'theme')).toBe('classic');
    await expect(page.locator('[name="darkTheme"][value="dark"]')).toBeChecked();
    await expect(page.locator('.theme-option-dark .theme-preview')).toHaveCSS(
      'border-color',
      'rgb(53, 120, 229)',
    );
    await expect(page.locator('#settingsModal')).toBeVisible();
    await page.locator('#saveSettings').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally {
    await closeApp(running);
  }
});

test('resizes the settings dialog within its minimum size and 90% window limit', async () => {
  const running = await launchApp({
    settingsDialogSize: { width: 900, height: 600, customized: true },
  });
  try {
    const { page } = running;
    await page.locator('#statusSettings').click();
    const card = page.locator('.settings-card');
    const dragHandle = async (edge: string, deltaX: number, deltaY: number) => {
      const handle = card.locator(`[data-settings-resize="${edge}"]`);
      const box = await handle.boundingBox();
      if (!box) throw new Error(`Settings ${edge} resize handle has no bounding box`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + deltaX, y + deltaY, { steps: 5 });
      await page.mouse.up();
    };

    await expect(card.locator('[data-settings-resize]')).toHaveCount(8);
    await expect(card.locator('[data-settings-resize="se"]')).toHaveCSS('cursor', 'nwse-resize');
    await expect
      .poll(() => card.evaluate((node) => getComputedStyle(node).transform))
      .toBe('matrix(1, 0, 0, 1, 0, 0)');
    const initial = await card.boundingBox();
    expect(initial?.width).toBeCloseTo(900, 0);
    expect(initial?.height).toBeCloseTo(600, 0);
    await dragHandle('se', -180, -120);
    const smaller = await card.boundingBox();
    expect(smaller && initial ? smaller.width : 0).toBeLessThan(initial?.width || 0);
    expect(smaller && initial ? smaller.height : 0).toBeLessThan(initial?.height || 0);
    await expect
      .poll(() => readSetting(running.testRoot, 'window', 'settingsDialog'))
      .toMatchObject({
        width: Math.round(smaller?.width || 0),
        height: Math.round(smaller?.height || 0),
      });

    await page.locator('[data-close="settingsModal"]').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
    await page.locator('#statusSettings').click();
    await expect
      .poll(() => card.evaluate((node) => getComputedStyle(node).transform))
      .toBe('matrix(1, 0, 0, 1, 0, 0)');
    const restored = await card.boundingBox();
    expect(restored?.width).toBeCloseTo(smaller?.width || 0, 0);
    expect(restored?.height).toBeCloseTo(smaller?.height || 0, 0);

    await dragHandle('se', 2000, 2000);
    const maximum = await card.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if (!maximum) throw new Error('Settings dialog has no bounds');
    expect(maximum.width).toBeLessThanOrEqual(viewport.width * 0.9 + 1);
    expect(maximum.height).toBeLessThanOrEqual(viewport.height * 0.9 + 1);

    await dragHandle('nw', 2000, 2000);
    const minimum = await card.boundingBox();
    if (!minimum) throw new Error('Resized settings dialog has no bounds');
    expect(minimum.width).toBeGreaterThanOrEqual(619);
    expect(minimum.height).toBeGreaterThanOrEqual(419);
    expect(minimum.x).toBeGreaterThanOrEqual(0);
    expect(minimum.y).toBeGreaterThanOrEqual(0);
    expect(minimum.x + minimum.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(minimum.y + minimum.height).toBeLessThanOrEqual(viewport.height + 1);
  } finally {
    await closeApp(running);
  }
});

test('animates the settings dialog with platform-aware native-style transitions', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await page.locator('#statusSettings').click();
    const modal = page.locator('#settingsModal');
    const card = modal.locator('.settings-card');
    await expect(modal).toHaveClass(/modal-open/);
    await expect(page.locator('body')).toHaveAttribute('data-platform', /^(linux|win32|darwin)$/);
    const motion = await card.evaluate((node) => ({
      property: getComputedStyle(node).transitionProperty,
      duration: getComputedStyle(node).transitionDuration,
    }));
    expect(motion.property).toContain('opacity');
    expect(motion.property).toContain('transform');
    expect(motion.duration).not.toBe('0s');

    await modal.locator('[data-close="settingsModal"]').click();
    await expect(modal).toHaveClass(/modal-closing/);
    await expect(modal).toBeHidden();

    await page.locator('#statusSettings').click();
    await page.locator('#saveSettings').click();
    await expect(modal).toHaveClass(/modal-closing/);
    await expect(modal).toBeHidden();
  } finally {
    await closeApp(running);
  }
});

test('preserves the editor scroll position when settings rebuild the editor', async () => {
  const running = await launchApp({ editMode: 'ir' });
  try {
    const { page } = running;
    await createNewTab(page);
    const markdown = Array.from({ length: 100 }, (_, index) => `paragraph ${index + 1}`).join('\n');
    const reset = page.locator('.editor-host.active .vditor-ir .vditor-reset');
    await reset.fill(markdown);
    await expect(reset).toContainText('paragraph 100');
    await reset.evaluate((node) => {
      node.scrollTop = 420;
      node.parentElement.scrollTop = 420;
    });
    const before = await reset.evaluate((node) =>
      Math.max(node.scrollTop, node.parentElement?.scrollTop || 0),
    );
    expect(before).toBeGreaterThan(300);

    await page.locator('#statusSettings').click();
    await page.locator('.settings-nav [data-panel="fonts"]').click();
    await page.locator('[name="editorFontSize"]').fill('18');
    await page.locator('#saveSettings').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
    await expect
      .poll(() =>
        page
          .locator('.editor-host.active .vditor-ir .vditor-reset')
          .evaluate((node) => Math.max(node.scrollTop, node.parentElement?.scrollTop || 0)),
      )
      .toBeGreaterThan(300);
  } finally {
    await closeApp(running);
  }
});

test('restores the editor scroll position before the first paint after changing modes', async () => {
  const running = await launchApp({ editMode: 'ir' });
  try {
    const { page } = running;
    await createNewTab(page);
    const markdown = Array.from({ length: 100 }, (_, index) => `paragraph ${index + 1}`).join('\n');
    const reset = page.locator('.editor-host.active .vditor-ir .vditor-reset');
    await reset.fill(markdown);
    await expect(reset).toContainText('paragraph 100');
    await reset.evaluate((node) => {
      node.scrollTop = 420;
      node.parentElement!.scrollTop = 420;
    });
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    const switchTo = async (mode: 'wysiwyg' | 'sv') => {
      await modeTrigger.click();
      await page.locator(`#vditorToolbarMount button[data-mode="${mode}"]`).click();
      return page.evaluate(
        (currentMode) =>
          new Promise<number>((resolve) =>
            requestAnimationFrame(() => {
              const selector =
                currentMode === 'sv'
                  ? '.editor-host.active .vditor-sv'
                  : '.editor-host.active .vditor-wysiwyg .vditor-reset';
              const scroller = document.querySelector(selector);
              resolve(scroller instanceof HTMLElement ? scroller.scrollTop : 0);
            }),
          ),
        mode,
      );
    };

    expect(await switchTo('wysiwyg')).toBeGreaterThan(100);
    expect(await switchTo('sv')).toBeGreaterThan(100);
  } finally {
    await closeApp(running);
  }
});

test('applies the editor paragraph-width slider in WYSIWYG mode', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await page
      .locator('.editor-host.active .vditor-wysiwyg .vditor-reset')
      .fill('Paragraph width test');
    await page.locator('#statusSettings').click();
    await page.locator('.settings-nav [data-panel="editor"]').click();
    await page.locator('#editorTextWidth').fill('60');
    await expect(page.locator('#editorTextWidthValue')).toHaveText('60%');
    await page.locator('#saveSettings').click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = document.querySelector('.editor-host.active .vditor-wysiwyg');
          const block = editor?.querySelector(':scope > .vditor-reset');
          if (!editor || !block) return 0;
          const style = getComputedStyle(block);
          return (
            (block.clientWidth -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight)) /
            editor.getBoundingClientRect().width
          );
        }),
      )
      .toBeCloseTo(0.6, 1);

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="ir"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = document.querySelector('.editor-host.active .vditor-ir');
          const block = editor?.querySelector(':scope > .vditor-reset');
          if (!editor || !block) return 0;
          const style = getComputedStyle(block);
          return (
            (block.clientWidth -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight)) /
            editor.getBoundingClientRect().width
          );
        }),
      )
      .toBeCloseTo(0.6, 1);

    expect(readSetting(running.testRoot, 'editor', 'editorTextWidth')).toBe(60);
  } finally {
    await closeApp(running);
  }
});

test('filters and remembers code-block themes separately for light and dark modes', async () => {
  const running = await launchApp({
    theme: 'classic',
    codeTheme: 'github',
    lightCodeTheme: 'github',
    darkCodeTheme: 'monokai',
  });
  try {
    const { page, testRoot } = running;
    await createNewTab(page);
    await expect(page.locator('.editor-host.active')).toHaveAttribute('data-editor-ready', 'true');
    const codeThemeButton = (name: RegExp) =>
      page
        .locator('#vditorToolbarMount button[data-type="code-theme"]')
        .locator('xpath=..')
        .locator('button')
        .filter({ hasText: name });

    await page.locator('#vditorToolbarMount button[data-type="code-theme"]').click();
    await expect(codeThemeButton(/^github$/)).toBeVisible();
    await expect(codeThemeButton(/^monokai$/)).toBeHidden();
    await codeThemeButton(/^atom-one-light$/).click();

    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'lightCodeTheme'))
      .toBe('atom-one-light');

    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'codeTheme')).toBe('monokai');
    await page.locator('#vditorToolbarMount button[data-type="code-theme"]').click();
    await expect(codeThemeButton(/^github$/)).toBeHidden();
    await expect(codeThemeButton(/^monokai$/)).toBeVisible();
    await codeThemeButton(/^monokai-sublime$/).click();
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'darkCodeTheme'))
      .toBe('monokai-sublime');

    await selectThemeMode(page, 'light');
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'codeTheme'))
      .toBe('atom-one-light');
    await selectThemeMode(page, 'dark');
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'codeTheme'))
      .toBe('monokai-sublime');

    await page.locator('#statusSettings').click();
    await expect(page.locator('[name="codeTheme"]')).toHaveValue('monokai-sublime');
    await expect(page.locator('[name="codeTheme"] option[value="github"]')).toHaveAttribute(
      'disabled',
      '',
    );
    await expect(page.locator('[name="codeTheme"] option[value="monokai"]')).not.toHaveAttribute(
      'disabled',
      '',
    );
  } finally {
    await closeApp(running);
  }
});

test('keeps theme menus singular and clears their tooltip state after selection', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    const codeTrigger = page.locator('#vditorToolbarMount button[data-type="code-theme"]');
    const contentTrigger = page.locator('#vditorToolbarMount button[data-type="content-theme"]');
    await codeTrigger.click();
    await contentTrigger.click();
    const visiblePanels = page.locator('#vditorToolbarMount .vditor-hint:visible');
    await expect(visiblePanels).toHaveCount(1);
    await visiblePanels.locator('button:visible').first().click();
    await expect(page.locator('#vditorToolbarMount .vditor-hint:visible')).toHaveCount(0);
    await expect(page.locator('#vditorToolbarMount .app-submenu-open')).toHaveCount(0);
  } finally {
    await closeApp(running);
  }
});

test('omits Vditor web fullscreen and applies the configured font to editable code blocks', async () => {
  const running = await launchApp({
    editMode: 'ir',
    previewCodeFontFamily: '"Courier New", monospace',
  });
  try {
    const { page } = running;
    await createNewTab(page);
    await expect(page.locator('#vditorToolbarMount button[data-type="fullscreen"]')).toHaveCount(0);
    const editor = page.locator('.editor-host.active .vditor-ir');
    await editor.locator('.vditor-reset').fill('```js\nconst value = 1;\n```');
    const code = editor.locator('[data-type="code-block"] code').first();
    await expect(code).toBeVisible();
    await expect
      .poll(() => code.evaluate((node) => getComputedStyle(node).fontFamily))
      .toContain('Courier New');

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expect(
      page.locator('.editor-host.active .vditor-wysiwyg > .vditor-reset + .vditor-panel'),
    ).toHaveCSS('display', 'none');
  } finally {
    await closeApp(running);
  }
});

test('uses the rendered text font for raw HTML previews in every rendered mode', async () => {
  const running = await launchApp(
    {
      editMode: 'ir',
      previewFontFamily: 'Georgia, serif',
      previewFontSize: 19,
      previewCodeFontFamily: 'Courier New, monospace',
      previewCodeFontSize: 13,
    },
    { 'raw-html-font.md': '<p>Rendered HTML text</p>' },
  );
  try {
    const { page } = running;
    const assertRenderedHTML = async (selector: string) => {
      const preview = page.locator(selector);
      await expect(preview).toBeVisible();
      await expect(preview).toHaveCSS('font-family', /Georgia/);
      await expect(preview).toHaveCSS('font-size', '19px');
    };
    const switchFromStatus = async (mode: 'wysiwyg' | 'sv') => {
      await page.locator('#statusMode').click();
      await page.locator(`#statusModeMenu button[data-status-mode="${mode}"]`).click();
    };

    await assertRenderedHTML(
      '.editor-host.active .vditor-ir [data-type="html-block"] > .vditor-ir__preview',
    );
    await expect(
      page.locator(
        '.editor-host.active .vditor-ir [data-type="html-block"] > .vditor-ir__marker--pre code',
      ),
    ).toHaveCSS('font-family', /Courier New/);

    await switchFromStatus('wysiwyg');
    await assertRenderedHTML(
      '.editor-host.active .vditor-wysiwyg [data-type="html-block"] > .vditor-wysiwyg__preview',
    );

    await switchFromStatus('sv');
    await assertRenderedHTML('.editor-host.active .vditor-preview > .vditor-reset');
  } finally {
    await closeApp(running);
  }
});

test('renders the redesigned status bar and scales titlebar menu text', async () => {
  const running = await launchApp({ uiZoom: 150 });
  try {
    const { page } = running;
    await expect(page.locator('#statusPath')).toHaveText('');
    await expect(page.locator('#statusLineEnding')).toHaveText('—');
    await expect(page.locator('#statusVersion')).toHaveText(/^v\d/);
    await expect
      .poll(() =>
        page
          .locator('#appMenuBar > button')
          .first()
          .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
      )
      .toBe(18);

    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#statusSettings').click();
    await expect(page.locator('#settingsModal')).toBeVisible();
    const widths = await page.evaluate(() => ({
      app: document.querySelector('#app').getBoundingClientRect().width,
      status: document.querySelector('.statusbar').getBoundingClientRect().width,
      font: getComputedStyle(document.querySelector('.statusbar')).fontFamily,
    }));
    expect(Math.abs(widths.status - widths.app)).toBeLessThan(3);
    expect(widths.font).toContain('Segoe UI');
  } finally {
    await closeApp(running);
  }
});

test('shows the localized About page with project links and reset at the bottom', async () => {
  const running = await launchApp({ locale: 'zh_Hans' });
  try {
    const { page } = running;
    await page.locator('#statusSettings').click();
    await expect(page.locator('.settings-card > header h2')).toHaveText('Vditor Desktop 设置');
    const fontsNav = page.locator('.settings-nav [data-panel="fonts"]');
    const navBackground = await fontsNav.evaluate((node) => getComputedStyle(node).backgroundColor);
    await fontsNav.hover();
    await expect
      .poll(() => fontsNav.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(navBackground);
    await page.locator('.settings-nav [data-panel="about"]').click();
    await expect(page.locator('#resetSettingsPage')).toBeHidden();
    const about = page.locator('.about-panel');
    await expect(about).toBeVisible();
    await expect(about.locator('.about-logo')).toBeVisible();
    await expect(about).toContainText('基于 Vditor 项目打造');
    await expect(about.locator('[data-external]')).toHaveCount(7);
    const panelBox = await about.boundingBox();
    const logoBox = await about.locator('.about-logo').boundingBox();
    const sourceBox = await about.locator('.about-source').boundingBox();
    const resetBox = await about.locator('.about-reset').boundingBox();
    const contentCenter =
      logoBox && sourceBox ? (logoBox.y + sourceBox.y + sourceBox.height) / 2 : 0;
    const availableCenter = panelBox && resetBox ? (panelBox.y + resetBox.y) / 2 : 0;
    expect(contentCenter).toBeCloseTo(availableCenter, -1);
    expect(panelBox && resetBox ? resetBox.y + resetBox.height : 0).toBeCloseTo(
      panelBox ? panelBox.y + panelBox.height : 0,
      0,
    );
    await page.locator('.settings-nav [data-panel="appearance"]').click();
    await expect(page.locator('#resetSettingsPage')).toBeVisible();
  } finally {
    await closeApp(running);
  }
});

test('only opens Chrome DevTools after enabling its persisted setting', async () => {
  const running = await launchApp();
  try {
    const { app, page, testRoot } = running;
    const devToolsOpen = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened(),
      );
    const sendShortcut = (keyCode: string, modifiers: string[] = []) =>
      app.evaluate(
        ({ BrowserWindow }, { keyCode, modifiers }) =>
          BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({
            type: 'keyDown',
            keyCode,
            modifiers,
          }),
        { keyCode, modifiers },
      );
    await page.evaluate(() =>
      (document.querySelector('#statusSettings') as HTMLButtonElement).click(),
    );
    await page.evaluate(() =>
      (document.querySelector('.settings-nav [data-panel="about"]') as HTMLButtonElement).click(),
    );
    const toggle = page.locator('[name="devToolsEnabled"]');
    await expect(toggle).not.toBeChecked();

    await sendShortcut('I', ['control', 'shift']);
    await expect.poll(devToolsOpen).toBe(false);

    await page.evaluate(() =>
      (document.querySelector('.about-devtools-setting') as HTMLLabelElement).click(),
    );
    await expect(toggle).toBeChecked();
    await expect.poll(() => readSetting(testRoot, 'application', 'devToolsEnabled')).toBe(true);
    await sendShortcut('I', ['control', 'shift']);
    await expect.poll(devToolsOpen).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.closeDevTools(),
    );
    await sendShortcut('F12');
    await expect.poll(devToolsOpen).toBe(false);

    await page.evaluate(() =>
      (document.querySelector('.about-devtools-setting') as HTMLLabelElement).click(),
    );
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => readSetting(testRoot, 'application', 'devToolsEnabled')).toBe(false);
    await sendShortcut('I', ['control', 'shift']);
    await expect.poll(devToolsOpen).toBe(false);
  } finally {
    await closeApp(running);
  }
});

test('shows the Traditional Chinese locale throughout settings', async () => {
  const running = await launchApp({ locale: 'zh_Hant' });
  try {
    const { page } = running;
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
    await page.locator('#statusSettings').click();
    await expect(page.locator('.settings-card > header h2')).toHaveText('Vditor Desktop 設定');
    await expect(page.locator('[name="locale"]')).toHaveValue('zh_Hant');
    await expect(page.locator('[data-settings-panel="appearance"]')).not.toContainText(
      '跟隨系統主題',
    );
    await expect(page.locator('#statusThemeMenu [data-theme-mode="system"]')).toHaveAttribute(
      'aria-label',
      '跟隨系統主題',
    );
  } finally {
    await closeApp(running);
  }
});

test('uses the file name in the title and matches the layered chrome surfaces', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    await expect(page.locator('#windowTitle')).toHaveText('Untitled 1 - Vditor Desktop');
    await expect(page).toHaveTitle('Untitled 1 - Vditor Desktop');

    const chromeColors = () =>
      page.evaluate(() => {
        const background = (selector: string) =>
          getComputedStyle(document.querySelector(selector) as Element).backgroundColor;
        return {
          windowTitlebar: background('#windowTitlebar'),
          titlebar: background('header.titlebar'),
          toolbar: background('#vditorToolbarMount > .vditor-toolbar'),
          sidebar: background('.sidebar'),
          statusbar: background('.statusbar'),
        };
      });
    const lightColors = await chromeColors();
    expect(lightColors.windowTitlebar).toBe(lightColors.sidebar);
    expect(lightColors.titlebar).toBe(lightColors.sidebar);
    expect(lightColors.toolbar).toBe(lightColors.sidebar);
    expect(lightColors.statusbar).toBe(lightColors.sidebar);
    await expect(page.locator('#tabBar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await selectThemeMode(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkColors = await chromeColors();
    expect(darkColors.windowTitlebar).toBe(darkColors.sidebar);
    expect(darkColors.titlebar).toBe(darkColors.sidebar);
    expect(darkColors.toolbar).toBe(darkColors.sidebar);
    expect(darkColors.statusbar).not.toBe(darkColors.sidebar);
    expect(darkColors.windowTitlebar).not.toBe(lightColors.windowTitlebar);
  } finally {
    await closeApp(running);
  }
});

test('shows a localized themed dialog when closing a window with unsaved changes', async () => {
  const running = await launchApp({ locale: 'zh_Hans', theme: 'dark', editMode: 'sv' });
  try {
    const { page } = running;
    await createNewTab(page);
    await page.locator('.editor-host.active .vditor-sv').fill('未保存内容');
    await page.locator('#appMenuBar [data-menu="main"]').click();
    const quit = page.locator('.app-menu-popup button').filter({ hasText: /^退出/ });
    await expect(quit).toBeVisible();
    await quit.click();

    const dialog = page.locator('#confirmModal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#confirmTitle')).toHaveText('未保存的更改');
    await expect(dialog.locator('#confirmMessage')).toHaveText('有 1 个文档包含未保存的更改。');
    await expect(dialog.locator('#confirmDetail')).toContainText('Untitled 1');
    await expect(dialog.locator('#confirmActions button')).toHaveText(['取消', '不保存', '保存']);
    const card = dialog.locator('.confirm-card');
    await expect(card.locator('[data-settings-resize]')).toHaveCount(0);
    const colors = await dialog.evaluate((node) =>
      ['header', '.confirm-content', 'footer'].map(
        (selector) => getComputedStyle(node.querySelector(selector)).backgroundColor,
      ),
    );
    expect(new Set(colors).size).toBe(1);
    const dialogBox = await dialog.boundingBox();
    const appBox = await page.locator('#app').boundingBox();
    expect(dialogBox).toEqual(appBox);
    const initialCardBox = await card.boundingBox();
    const headerBox = await card.locator(':scope > header').boundingBox();
    if (!dialogBox || !initialCardBox || !headerBox)
      throw new Error('Unsaved changes dialog has incomplete drag chrome');
    await page.mouse.move(headerBox.x + 40, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      dialogBox.x + dialogBox.width + 160,
      dialogBox.y + dialogBox.height + 160,
      {
        steps: 5,
      },
    );
    await page.mouse.up();
    const movedCardBox = await card.boundingBox();
    if (!movedCardBox) throw new Error('Unsaved changes dialog card disappeared while dragging');
    expect(movedCardBox.x).toBeGreaterThan(initialCardBox.x + 20);
    expect(movedCardBox.y).toBeGreaterThan(initialCardBox.y + 20);
    expect(movedCardBox.width).toBeCloseTo(initialCardBox.width, 0);
    expect(movedCardBox.height).toBeCloseTo(initialCardBox.height, 0);
    expect(movedCardBox.x).toBeGreaterThanOrEqual(dialogBox.x - 1);
    expect(movedCardBox.y).toBeGreaterThanOrEqual(dialogBox.y - 1);
    expect(movedCardBox.x + movedCardBox.width).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width + 1,
    );
    expect(movedCardBox.y + movedCardBox.height).toBeLessThanOrEqual(
      dialogBox.y + dialogBox.height + 1,
    );
    await dialog.locator('button', { hasText: '取消' }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await closeApp(running);
  }
});

test('keeps the native application window resizable', async () => {
  const running = await launchApp();
  try {
    const { app, page } = running;
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isResizable()),
      )
      .toBe(true);
    await expect(page.locator('[data-window-resize]')).toHaveCount(0);
  } finally {
    await closeApp(running);
  }
});

test('persists maximize and restored window states when they change', async () => {
  const running = await launchApp({
    windowMaximized: false,
    windowBounds: { x: 80, y: 70, width: 1000, height: 700 },
  });
  try {
    const { app, page, testRoot } = running;
    await expect.poll(() => readSetting(testRoot, 'window', 'windowMaximized')).toBe(false);
    await page.locator('#windowMaximize').click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      )
      .toBe(true);
    await expect.poll(() => readSetting(testRoot, 'window', 'windowMaximized')).toBe(true);
    await expect(page.locator('body')).toHaveClass(/window-maximized/);

    await page.locator('#windowMaximize').click();
    await expect.poll(() => readSetting(testRoot, 'window', 'windowMaximized')).toBe(false);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      )
      .toBe(false);
    await expect(page.locator('body')).not.toHaveClass(/window-maximized/);
  } finally {
    await closeApp(running);
  }
});

test('repairs maximized work-area bounds stored as a normal window', async () => {
  const running = await launchApp({
    windowMaximized: false,
    windowBounds: { x: 0, y: 0, width: 10000, height: 10000 },
  });
  try {
    const { app, testRoot } = running;
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    expect(bounds.width).toBeLessThanOrEqual(1200);
    expect(bounds.height).toBeLessThanOrEqual(800);
    expect(readSetting(testRoot, 'window', 'windowMaximized')).toBe(false);
    expect(readSetting(testRoot, 'window', 'bounds')).toMatchObject({
      width: bounds.width,
      height: bounds.height,
    });
  } finally {
    await closeApp(running);
  }
});

test('animates window control hover highlights', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    const titlebarMetrics = await page.locator('#windowTitlebar').evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      borderBottomWidth: parseFloat(getComputedStyle(node).borderBottomWidth),
    }));
    for (const selector of ['#windowMinimize', '#windowMaximize', '#windowClose']) {
      const transitions = await page.locator(selector).evaluate((node) => ({
        properties: getComputedStyle(node).transitionProperty,
        durations: getComputedStyle(node).transitionDuration,
        height: node.getBoundingClientRect().height,
      }));
      expect(transitions.properties).toContain('background-color');
      expect(transitions.properties).toContain('color');
      expect(transitions.durations).toContain('0.16s');
      expect(transitions.height).toBeCloseTo(
        titlebarMetrics.height - titlebarMetrics.borderBottomWidth,
        0,
      );
    }
  } finally {
    await closeApp(running);
  }
});

test('uses native Linux window shadow while preserving settings-card corners', async () => {
  const running = await launchApp();
  try {
    const { app, page } = running;
    const chrome = await page.locator('#app').evaluate((node) => ({
      radius: getComputedStyle(node).borderRadius,
      shadow: getComputedStyle(node).boxShadow,
      inset: node.getBoundingClientRect().left,
    }));
    expect(chrome).toEqual({ radius: '0px', shadow: 'none', inset: 0 });
    await expect(
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hasShadow()),
    ).resolves.toBe(true);
    await page.locator('#statusSettings').click();
    await expect(page.locator('.settings-card')).toHaveCSS('border-radius', '8px');
  } finally {
    await closeApp(running);
  }
});
