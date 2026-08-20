import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as TOML from '@iarna/toml';
import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import type { AppSettings } from '../../src/main/services/app-state';
import { SettingsStore } from '../../src/main/services/settings-store';

const projectRoot = path.resolve(__dirname, '../..');

interface RunningApp {
  app: ElectronApplication;
  page: Page;
  testRoot: string;
}

async function launchApp(
  settings: Record<string, unknown> = {},
  startupFiles: Record<string, string> = {},
): Promise<RunningApp> {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-e2e-'));
  const configDir = path.join(testRoot, 'config');
  fs.mkdirSync(configDir);
  new SettingsStore(configDir).update({
    locale: 'en_US',
    systemTheme: false,
    restoreTabs: false,
    restoreWorkspace: false,
    autoSave: false,
    ...settings,
  } as Partial<AppSettings>);
  const startupPaths = Object.entries(startupFiles).map(([name, content]) => {
    const filePath = path.join(testRoot, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  });

  const app = await electron.launch({
    args: ['.', ...startupPaths],
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VDITOR_DESKTOP_CONFIG_DIR: configDir,
      VDITOR_DESKTOP_DATA_DIR: path.join(testRoot, 'chromium'),
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#appMenuBar[data-ready="true"]');
  return { app, page, testRoot };
}

function readSettings(testRoot: string): Record<string, unknown> {
  return TOML.parse(
    fs.readFileSync(path.join(testRoot, 'config', 'config.toml'), 'utf8'),
  ) as Record<string, unknown>;
}

function readSetting(testRoot: string, section: string, key: string): unknown {
  return (readSettings(testRoot)[section] as Record<string, unknown>)[key];
}

async function closeApp(running: RunningApp): Promise<void> {
  if (!running.page.isClosed()) {
    const closed = running.app.waitForEvent('close');
    await running.page.evaluate(() => window.appAPI.closeWindow());
    try {
      const discard = running.page.locator('#confirmActions [data-action="discard"]');
      await discard.waitFor({ state: 'visible', timeout: 1000 });
      await discard.click();
    } catch {
      // A clean window closes immediately and destroys the page before a dialog can appear.
    }
    await closed;
  }
  fs.rmSync(running.testRoot, { recursive: true, force: true });
}

async function createNewTab(page: Page): Promise<void> {
  await page.locator('#addTab').click();
  await page.waitForSelector('.editor-host.active .vditor-content');
}

test('isolates TOML configuration and Chromium data in the configured directories', async () => {
  const running = await launchApp();
  try {
    const { app, page, testRoot } = running;
    const configPath = path.join(testRoot, 'config', 'config.toml');
    const chromiumPath = path.join(testRoot, 'chromium');
    await expect.poll(() => fs.existsSync(configPath)).toBe(true);
    await expect.poll(() => fs.existsSync(chromiumPath)).toBe(true);
    await expect(page.evaluate(() => window.appAPI.getSettingsPath())).resolves.toBe(configPath);
    await expect(
      app.evaluate(({ app: electronApp }) => ({
        userData: electronApp.getPath('userData'),
        sessionData: electronApp.getPath('sessionData'),
      })),
    ).resolves.toEqual({ userData: chromiumPath, sessionData: chromiumPath });
  } finally {
    await closeApp(running);
  }
});

test('opens a Markdown file supplied by the desktop launcher on cold start', async () => {
  const running = await launchApp({}, { 'launcher target.md': '# Opened from desktop' });
  try {
    const { page } = running;
    await expect(page.locator('.document-tab.active > span')).toHaveText('launcher target.md');
    await expect(page.locator('#windowTitle')).toHaveText('launcher target.md - Vditor Desktop');
    await expect(page.locator('.editor-host.active')).toContainText('Opened from desktop');
  } finally {
    await closeApp(running);
  }
});

test('finds, navigates, and replaces text in the active document', async () => {
  const running = await launchApp({}, { 'find.md': 'alpha beta alpha\nalpha' });
  try {
    const { page, testRoot } = running;
    await page.keyboard.press('Control+f');
    await expect(page.locator('#findWidget')).toBeVisible();
    await expect(page.locator('#findInput')).toBeFocused();
    await page.locator('#findInput').fill('alpha');
    await expect(page.locator('#findInput')).toBeFocused();
    await expect(page.locator('#findInput')).toHaveValue('alpha');
    await expect(page.locator('#findCount')).toHaveText('1 / 3');
    await expect
      .poll(() =>
        page.evaluate(() => ({
          active: CSS.highlights.has('vditor-desktop-find-active'),
          matches: CSS.highlights.has('vditor-desktop-find'),
          activeText: Array.from(CSS.highlights.get('vditor-desktop-find-active') || []).map(
            (range) => range.toString(),
          ),
        })),
      )
      .toEqual({ active: true, matches: true, activeText: ['alpha'] });
    await page.locator('#findInput').press('Enter');
    await expect(page.locator('#findCount')).toHaveText('2 / 3');
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(CSS.highlights.get('vditor-desktop-find-active') || []).map((range) =>
            range.toString(),
          ),
        ),
      )
      .toEqual(['alpha']);

    await page.locator('#findInput').press('Escape');
    await expect(page.locator('#findWidget')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('alpha');
    await page.keyboard.press('Control+f');
    await expect(page.locator('#findInput')).toHaveValue('alpha');

    await page.locator('#findToggleReplace').click();
    await page.locator('#replaceInput').fill('omega');
    await page.locator('#replaceOne').click();
    await expect(page.locator('#findCount')).toHaveText('1 / 2');
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(CSS.highlights.get('vditor-desktop-find-active') || []).map((range) =>
            range.toString(),
          ),
        ),
      )
      .toEqual(['alpha']);
    await expect(page.locator('.document-tab.active .dirty')).toHaveText('●');
    await page.locator('#replaceAll').click();
    await expect(page.locator('#findCount')).toHaveText('0 / 0');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => fs.readFileSync(path.join(testRoot, 'find.md'), 'utf8'))
      .toBe('omega beta omega\nomega\n');
  } finally {
    await closeApp(running);
  }
});

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
    await expect(page.locator('#app')).toHaveClass(/toolbar-unavailable/);
    await expect(page.locator('#vditorToolbarMount')).toBeHidden();
    await expect
      .poll(() =>
        page
          .locator('#tabBar .tabbar-drag-fill')
          .evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
      )
      .toBe('drag');
    await page.locator('[data-menu="main"]').click();
    await expect(page.locator('.app-menu-popup button', { hasText: 'Close Tab' })).toHaveCount(0);
    await page.locator('.app-menu-popup button.has-submenu', { hasText: 'Layout' }).click();
    const toolbarItem = page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' });
    await expect(toolbarItem).toBeDisabled();
    await expect(toolbarItem.locator('.checkmark')).toHaveText('');
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

test('switches among all three modes from the View > Editing Mode submenu', async () => {
  const running = await launchApp({ editMode: 'ir' });
  try {
    const { page, testRoot } = running;
    await createNewTab(page);
    const openEditingMode = async () => {
      await page.locator('[data-menu="main"]').click();
      await page
        .locator('.app-menu-popup:not(.submenu) button.has-submenu', { hasText: 'Editing Mode' })
        .hover();
      await expect(page.locator('.app-menu-popup.submenu')).toBeVisible();
    };

    await openEditingMode();
    await expect(
      page.locator('.app-menu-popup.submenu button', { hasText: 'Instant Rendering Mode' }),
    ).toContainText('✓');
    await page.locator('.app-menu-popup.submenu button', { hasText: 'WYSIWYG Mode' }).click();
    await expect(page.locator('.editor-host.active .vditor-wysiwyg')).toBeVisible();
    await expect.poll(() => readSetting(testRoot, 'editor', 'editMode')).toBe('ir');

    await openEditingMode();
    await page
      .locator('.app-menu-popup.submenu button', { hasText: 'Instant Rendering Mode' })
      .click();
    await expect(page.locator('.editor-host.active .vditor-ir')).toBeVisible();

    await openEditingMode();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'Split Preview Mode' }).click();
    await expect(page.locator('.editor-host.active .vditor-sv')).toBeVisible();
    await expect(page.locator('.editor-host.active .vditor-preview')).toBeVisible();
    await expect.poll(() => readSetting(testRoot, 'editor', 'editMode')).toBe('ir');
  } finally {
    await closeApp(running);
  }
});

test('switches to split view and renders source line numbers', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();

    await expect(page.locator('.editor-host.active .vditor-sv')).toBeVisible();
    await expect(page.locator('.editor-host.active .sv-line-numbers')).toBeVisible();
    const source = page.locator('.editor-host.active .vditor-sv');
    await source.fill(`## Heading\n${'long-line '.repeat(80)}\nlast`);
    await expect(page.locator('.editor-host.active .sv-line-number')).toHaveCount(3);
    await expect
      .poll(() =>
        source.evaluate((node) => {
          const heading = node.querySelector('.h2');
          return heading
            ? Number.parseFloat(getComputedStyle(heading).fontSize) >
                Number.parseFloat(getComputedStyle(node).fontSize)
            : false;
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const heading = document.querySelector('.editor-host.active .vditor-sv .h2');
          const number = document.querySelector('.editor-host.active .sv-line-number');
          if (!heading || !number) return Number.POSITIVE_INFINITY;
          const headingRect = heading.getBoundingClientRect();
          const numberRect = number.getBoundingClientRect();
          return Math.abs(
            headingRect.top + headingRect.height / 2 - (numberRect.top + numberRect.height / 2),
          );
        }),
      )
      .toBeLessThan(4);

    const resizer = page.locator('.editor-host.active .sv-split-resizer');
    await expect(resizer).toBeVisible();
    const resizerBox = await resizer.boundingBox();
    if (!resizerBox) throw new Error('Split resizer has no bounding box');
    await page.mouse.move(resizerBox.x + 2, resizerBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x + 90, resizerBox.y + 20);
    await page.mouse.up();
    await expect.poll(() => readSetting(running.testRoot, 'editor', 'splitRatio')).not.toBe(50);
    const contentBox = await page.locator('.editor-host.active .vditor-content').boundingBox();
    const movedResizerBox = await resizer.boundingBox();
    if (!contentBox || !movedResizerBox) throw new Error('Split content has no bounding box');
    await page.mouse.move(movedResizerBox.x + movedResizerBox.width / 2, movedResizerBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(contentBox.x + contentBox.width / 2 + 1, movedResizerBox.y + 20);
    await page.mouse.up();
    await expect.poll(() => readSetting(running.testRoot, 'editor', 'splitRatio')).toBe(50);
    await expect(resizer).toHaveClass(/snapped/);

    const content = page.locator('.editor-host.active .vditor-content');
    const both = page.locator('#vditorToolbarMount button[data-type="both"]');
    await both.click();
    await expect(page.locator('.editor-host.active')).toHaveClass(/sv-editor-only/);
    await expect(page.locator('.editor-host.active .vditor-preview')).toBeHidden();
    await expect(resizer).toBeHidden();
    await expect
      .poll(async () => {
        const sourceBox = await source.boundingBox();
        const contentArea = await content.boundingBox();
        return sourceBox && contentArea ? sourceBox.width / contentArea.width : 0;
      })
      .toBeGreaterThan(0.98);

    await both.click();
    await expect(page.locator('.editor-host.active')).toHaveClass(/sv-both/);
    const previewToggle = page.locator('#vditorToolbarMount button[data-type="preview"]');
    await previewToggle.click();
    await expect(page.locator('.editor-host.active')).toHaveClass(/sv-preview-only/);
    await expect(source).toBeHidden();
    await expect(page.locator('.editor-host.active .sv-line-numbers')).toBeHidden();
    await expect(resizer).toBeHidden();
    await expect
      .poll(async () => {
        const previewBox = await page.locator('.editor-host.active .vditor-preview').boundingBox();
        const contentArea = await content.boundingBox();
        return previewBox && contentArea ? previewBox.width / contentArea.width : 0;
      })
      .toBeGreaterThan(0.98);
    await previewToggle.click();
    await expect(page.locator('.editor-host.active')).toHaveClass(/sv-both/);

    await source.click();
    await page.keyboard.press('Control+Alt+8');
    await expect(page.locator('.editor-host.active .vditor-ir')).toBeVisible();
    await expect(page.locator('.editor-host.active .sv-line-numbers')).toBeHidden();
  } finally {
    await closeApp(running);
  }
});

test('satisfies the Vditor DOM integration contract', async () => {
  const running = await launchApp({ editMode: 'sv' });
  try {
    const { page } = running;
    await createNewTab(page);
    const contract = await page.locator('.editor-host.active').evaluate((host) => {
      const adapter = window.VditorDesktopAdapter;
      const mountedToolbar = document.querySelector('#vditorToolbarMount > .vditor-toolbar');
      return adapter.validateHost(host, mountedToolbar);
    });
    expect(contract).toEqual({ valid: true, missing: [] });

    const source = page.locator('.editor-host.active .vditor-sv');
    await source.fill('- item\nnext');
    await expect
      .poll(() =>
        source.evaluate((editor) => {
          const adapter = window.VditorDesktopAdapter;
          return (
            adapter.sourceNewlines(editor).length >= 1 &&
            Boolean(editor.querySelector(adapter.selectors.listMarker))
          );
        }),
      )
      .toBe(true);
  } finally {
    await closeApp(running);
  }
});

test('navigates outline headings in instant, WYSIWYG, and both split panes', async () => {
  const running = await launchApp({ editMode: 'ir', sidebarVisible: true });
  try {
    const { page } = running;
    await createNewTab(page);
    const markdown = [
      '# Top',
      '[Jump to target](#target)',
      ...Array.from({ length: 70 }, (_, index) => `paragraph ${index + 1}`),
      '## Target',
      'target body',
    ].join('\n');
    const ir = page.locator('.editor-host.active .vditor-ir');
    const linkModifier = (
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control'
    ) as 'Control' | 'Meta';
    const modifierLabel = linkModifier === 'Meta' ? 'Cmd' : 'Ctrl';
    const scrollTop = (editor: ReturnType<Page['locator']>) =>
      editor.evaluate((node) =>
        Math.max(node.scrollTop, node.querySelector(':scope > .vditor-reset')?.scrollTop || 0),
      );
    await ir.locator('.vditor-reset').fill(markdown);
    await expect(ir.locator('h2')).toHaveCount(1);
    const irLink = ir.locator('[data-type="a"] .vditor-ir__link');
    await irLink.hover();
    await expect(irLink.locator('..')).not.toHaveAttribute('title');
    await expect(page.locator('#documentLinkTooltip')).toBeVisible();
    await expect(page.locator('#documentLinkTooltip')).toHaveText(
      `${modifierLabel}+Click to follow link`,
    );
    await expect(irLink).toHaveCSS('cursor', 'text');
    await page.keyboard.down(linkModifier);
    await expect(irLink).toHaveCSS('cursor', 'pointer');
    await page.keyboard.up(linkModifier);
    await irLink.click();
    await expect.poll(() => scrollTop(ir)).toBe(0);
    await irLink.click({ modifiers: [linkModifier] });
    await expect.poll(() => scrollTop(ir)).toBeGreaterThan(0);
    await ir.evaluate((node) => {
      node.scrollTop = 0;
      const reset = node.querySelector(':scope > .vditor-reset');
      if (reset) reset.scrollTop = 0;
    });
    await page.locator('.sidebar-tabs [data-view="outline"]').click();
    await expect(page.locator('#outlineView > .panel-heading')).toHaveCount(0);
    const target = page.locator('#outlineTree button', { hasText: 'Target' });
    await expect(target).toBeVisible();
    const topOutline = page.locator('#outlineTree > .outline-node').first();
    const topToggle = topOutline.locator(':scope > .outline-row > .outline-toggle');
    await expect(topToggle).toHaveAttribute('aria-expanded', 'true');
    await topToggle.click();
    await expect(target).toBeHidden();
    await expect(topToggle).toHaveAttribute('aria-expanded', 'false');
    await topToggle.click();
    await expect(target).toBeVisible();
    await target.click();
    await expect.poll(() => scrollTop(ir)).toBeGreaterThan(0);

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    const wysiwyg = page.locator('.editor-host.active .vditor-wysiwyg');
    await expect(wysiwyg.locator('h2')).toHaveCount(1);
    await wysiwyg.evaluate((node) => {
      node.scrollTop = 0;
      const reset = node.querySelector(':scope > .vditor-reset');
      if (reset) reset.scrollTop = 0;
    });
    await wysiwyg.locator('a[href="#target"]').click({ modifiers: [linkModifier] });
    await expect.poll(() => scrollTop(wysiwyg)).toBeGreaterThan(0);
    await wysiwyg.evaluate((node) => {
      node.scrollTop = 0;
      const reset = node.querySelector(':scope > .vditor-reset');
      if (reset) reset.scrollTop = 0;
    });
    await target.click();
    await expect.poll(() => scrollTop(wysiwyg)).toBeGreaterThan(0);

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
    const source = page.locator('.editor-host.active .vditor-sv');
    const preview = page.locator('.editor-host.active .vditor-preview');
    await expect(source.locator('[data-type="heading-marker"]')).toHaveCount(2);
    await expect(preview.locator('h2')).toHaveCount(1);
    await source.evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.locator('a[href="#target"]').click({ modifiers: [linkModifier] });
    await expect.poll(() => preview.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await source.evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.evaluate((node) => {
      node.scrollTop = 0;
    });
    await target.click();
    await expect.poll(() => source.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => preview.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

    await source.evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.evaluate((node) => {
      const heading = node.querySelector('h2');
      if (!heading?.id) throw new Error('Vditor preview heading is missing its target id');
      const toc = document.createElement('div');
      toc.className = 'vditor-toc';
      const tocTarget = document.createElement('span');
      tocTarget.dataset.targetId = heading.id;
      tocTarget.textContent = heading.textContent || '';
      toc.append(tocTarget);
      node.prepend(toc);
    });
    const tocTarget = preview.locator('.vditor-toc [data-target-id]');
    await expect(tocTarget).toBeVisible();
    await tocTarget.hover();
    await expect(page.locator('#documentLinkTooltip')).toHaveText(
      `${modifierLabel}+Click to follow link`,
    );
    await tocTarget.click();
    await expect.poll(() => preview.evaluate((node) => node.scrollTop)).toBe(0);
    await tocTarget.click({ modifiers: [linkModifier] });
    await expect.poll(() => source.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => preview.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  } finally {
    await closeApp(running);
  }
});

test('opens relative Markdown links from every editor mode and follows their fragments', async () => {
  const running = await launchApp(
    { editMode: 'ir' },
    { 'source.md': '[Open target](target.md#target)' },
  );
  try {
    const { page, testRoot } = running;
    fs.writeFileSync(
      path.join(testRoot, 'target.md'),
      [
        '# Top',
        ...Array.from({ length: 70 }, (_, index) => `paragraph ${index + 1}`),
        '## Target',
      ].join('\n'),
    );
    await page.waitForSelector('.editor-host.active .vditor-ir');
    const linkModifier = (
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control'
    ) as 'Control' | 'Meta';
    const targetScrollTop = () =>
      page.locator('.editor-host.active .vditor-ir').evaluate((node) => {
        const reset = node.querySelector(':scope > .vditor-reset');
        return Math.max(node.scrollTop, reset?.scrollTop || 0);
      });
    const follow = async (link: ReturnType<Page['locator']>) => {
      await link.click({ modifiers: [linkModifier] });
      await expect(page.locator('.document-tab', { hasText: 'target.md' })).toHaveCount(1);
      await expect(page.locator('.editor-host.active .vditor-ir h2')).toHaveText(/Target$/);
      await expect.poll(targetScrollTop).toBeGreaterThan(0);
      await page.locator('.document-tab', { hasText: 'source.md' }).click();
    };

    await follow(page.locator('.editor-host.active .vditor-ir .vditor-ir__link'));

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await follow(page.locator('.editor-host.active .vditor-wysiwyg a[href="target.md#target"]'));

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
    await follow(page.locator('.editor-host.active .vditor-preview a[href="target.md#target"]'));
  } finally {
    await closeApp(running);
  }
});

test('rejects unsafe external URL protocols at the privileged IPC boundary', async () => {
  const running = await launchApp();
  try {
    const message = await running.page.evaluate(async () => {
      try {
        await window.appAPI.openExternal('javascript:alert(1)');
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(message).toContain('Unsupported URL protocol');
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

test('shows the split editor scrollbar only at its edge or while scrolling', async () => {
  const running = await launchApp({ editMode: 'sv' });
  try {
    const { page } = running;
    await createNewTab(page);
    const source = page.locator('.editor-host.active .vditor-sv');

    const sourceBox = await source.boundingBox();
    if (!sourceBox) throw new Error('Split source editor has no bounds');
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + 80);
    await expect(source).not.toHaveClass(/scrollbar-visible/);
    await page.mouse.move(sourceBox.x + sourceBox.width - 3, sourceBox.y + 80);
    await expect(source).toHaveClass(/scrollbar-visible/);
    await expect(source).not.toHaveClass(/scrollbar-visible/, { timeout: 1500 });

    await source.evaluate((node) => {
      node.dispatchEvent(new Event('scroll'));
    });
    await expect(source).toHaveClass(/scrollbar-visible/);
    await expect(source).not.toHaveClass(/scrollbar-visible/, { timeout: 1500 });
  } finally {
    await closeApp(running);
  }
});

test('shows the outline scrollbar only at its edge or while scrolling', async () => {
  const running = await launchApp({ editMode: 'ir', sidebarVisible: true });
  try {
    const { page } = running;
    await createNewTab(page);
    const ir = page.locator('.editor-host.active .vditor-ir .vditor-reset');
    await ir.fill(Array.from({ length: 60 }, (_, index) => `## Section ${index + 1}`).join('\n'));
    await page.locator('.sidebar-tabs [data-view="outline"]').click();
    const outline = page.locator('#outlineTree');
    await expect(outline.locator('.outline-item')).toHaveCount(60);
    const box = await outline.boundingBox();
    if (!box) throw new Error('Outline has no bounds');
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await expect(outline).not.toHaveClass(/scrollbar-visible/);
    await page.mouse.move(box.x + box.width - 8, box.y + 80);
    await expect(outline).toHaveClass(/scrollbar-visible/);
    await expect(outline).not.toHaveClass(/scrollbar-visible/, { timeout: 1500 });
    await outline.evaluate((node) => {
      node.scrollTop = 100;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect(outline).toHaveClass(/scrollbar-visible/);
    await expect(outline).not.toHaveClass(/scrollbar-visible/, { timeout: 1500 });
  } finally {
    await closeApp(running);
  }
});

test('applies always, automatic, and hidden scrollbar modes across the application', async () => {
  const running = await launchApp({ editMode: 'sv', scrollbarMode: 'auto' });
  try {
    const { page, testRoot } = running;
    await createNewTab(page);
    const source = page.locator('.editor-host.active .vditor-sv');
    await expect(page.locator('html')).toHaveAttribute('data-scrollbar-mode', 'auto');
    await expect(source).toHaveClass(/app-scrollbar/);
    await expect(page.locator('#fileTree')).toHaveClass(/app-scrollbar/);
    await expect(page.locator('#outlineTree')).toHaveClass(/app-scrollbar/);
    await page.locator('#statusSettings').click();
    const setting = page.locator('[name="scrollbarMode"]');
    await expect(setting).toHaveValue('auto');

    await setting.selectOption('always');
    await expect(page.locator('html')).toHaveAttribute('data-scrollbar-mode', 'always');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'scrollbarMode')).toBe('always');
    await expect
      .poll(() => source.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar').width))
      .toBe('9px');

    await setting.selectOption('hidden');
    await expect(page.locator('html')).toHaveAttribute('data-scrollbar-mode', 'hidden');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'scrollbarMode')).toBe('hidden');
    await expect
      .poll(() => source.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar').width))
      .toBe('0px');

    await setting.selectOption('auto');
    await expect(page.locator('html')).toHaveAttribute('data-scrollbar-mode', 'auto');
    await page.locator('#saveSettings').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
    const box = await source.boundingBox();
    if (!box) throw new Error('Split source editor has no bounds');
    await page.mouse.move(box.x + box.width - 8, box.y + 80);
    await expect(source).toHaveClass(/scrollbar-visible/);
    await expect(source).not.toHaveClass(/scrollbar-visible/, { timeout: 1500 });
  } finally {
    await closeApp(running);
  }
});

test('keeps list indentation actions available in split-view mode', async () => {
  const running = await launchApp({ editMode: 'sv' });
  try {
    const { page } = running;
    await createNewTab(page);
    const source = page.locator('.editor-host.active .vditor-sv');
    const outdent = page.locator('#vditorToolbarMount button[data-type="outdent"]');
    const indent = page.locator('#vditorToolbarMount button[data-type="indent"]');
    await expect(outdent).toBeVisible();
    await expect(indent).toBeVisible();
    await source.fill('- item');
    await source.press('Home');
    await source.press('ArrowRight');
    await source.press('ArrowRight');
    await indent.click();
    await expect.poll(() => source.textContent()).toMatch(/^\s+- item/);
    await outdent.click();
    await expect.poll(() => source.textContent()).toMatch(/^- item/);
  } finally {
    await closeApp(running);
  }
});

test('shows whitespace and applies Tab spaces and automatic indentation in split view', async () => {
  const running = await launchApp({
    editMode: 'sv',
    showWhitespace: true,
    tabInsertSpaces: true,
    tabSize: 4,
    autoIndent: true,
  });
  try {
    const { page } = running;
    await createNewTab(page);
    const source = page.locator('.editor-host.active .vditor-sv');
    await source.fill('text  indented');
    const whitespaceCanvas = page.locator('.editor-host.active .sv-whitespace-canvas');
    await expect(whitespaceCanvas).toHaveAttribute('data-marker-count', '2');
    const firstPositions = await whitespaceCanvas.evaluate(
      (canvas) => canvas.whitespaceMarkerPositions,
    );
    expect(firstPositions[1].x - firstPositions[0].x).toBeGreaterThan(5);
    await source.press('End');
    await source.press('Tab');
    await source.type('y');
    await expect.poll(() => source.textContent()).toMatch(/indented\s{4}y/);
    await expect(whitespaceCanvas).toHaveAttribute('data-marker-count', '6');
    await source.fill('## 1.1 Linux and Windows');
    await expect(whitespaceCanvas).toHaveAttribute('data-marker-count', '4');
    const canvasLeft = await whitespaceCanvas.evaluate(
      (canvas) => canvas.getBoundingClientRect().left,
    );
    const markerCenters = await whitespaceCanvas.evaluate((canvas) =>
      canvas.whitespaceMarkerPositions.map((marker) => marker.x),
    );
    const spaceCenters = await source.evaluate((node) => {
      const centers = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        for (let index = 0; index < textNode.data.length; index += 1) {
          if (textNode.data[index] !== ' ') continue;
          const range = document.createRange();
          range.setStart(textNode, index);
          range.setEnd(textNode, index + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0) centers.push(rect.left + rect.width / 2);
        }
        textNode = walker.nextNode();
      }
      return centers;
    });
    expect(markerCenters).toHaveLength(spaceCenters.length);
    markerCenters.forEach((center, index) =>
      expect(center + canvasLeft).toBeCloseTo(spaceCenters[index], 0),
    );
    await source.fill(
      Array.from({ length: 80 }, (_value, index) => `line ${index + 1} value`).join('\n'),
    );
    await expect.poll(() => source.textContent()).toContain('line 80 value');
    await source.evaluate((node) => {
      node.style.flex = '0 0 160px';
      node.style.height = '160px';
    });
    await expect
      .poll(() => source.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(0);
    const liveTransforms = await source.evaluate((node) => {
      const canvas = node.parentElement?.querySelector('.sv-whitespace-canvas');
      const maximum = node.scrollHeight - node.clientHeight;
      return [0.25, 0.5, 0.75, 1].map((ratio) => {
        node.scrollTop = maximum * ratio;
        node.dispatchEvent(new Event('scroll'));
        const delta = Number(canvas?.dataset.scrollTop || 0) - node.scrollTop;
        return { delta, transform: canvas?.style.transform || '' };
      });
    });
    expect(liveTransforms.some(({ delta }) => delta !== 0)).toBe(true);
    liveTransforms.forEach(({ delta, transform }) => {
      const renderedDelta = Number(transform.match(/translateY\((-?[\d.]+)px\)/)?.[1]);
      expect(renderedDelta).toBeCloseTo(delta, 2);
    });
    await expect
      .poll(() => whitespaceCanvas.evaluate((canvas) => Number(canvas.dataset.markerCount || 0)))
      .toBeGreaterThan(0);
    await expect
      .poll(() => whitespaceCanvas.evaluate((canvas) => canvas.style.transform))
      .toMatch(/translateY\(0(?:px)?\)/);
    const scrolledMarkers = await whitespaceCanvas.evaluate((canvas) => ({
      height: canvas.clientHeight,
      positions: canvas.whitespaceMarkerPositions,
    }));
    expect(
      scrolledMarkers.positions.every(
        (marker) => marker.y >= -30 && marker.y <= scrolledMarkers.height + 30,
      ),
    ).toBe(true);
    await source.fill('- item');
    await source.press('End');
    await source.press('Enter');
    await source.type('next');
    await expect.poll(() => source.textContent()).toMatch(/- item\s+- next/);
  } finally {
    await closeApp(running);
  }
});

test('keeps whitespace canvases isolated between tabs', async () => {
  const running = await launchApp({ editMode: 'sv', showWhitespace: true });
  try {
    const { page } = running;
    await createNewTab(page);
    await page.locator('.editor-host.active .vditor-sv').fill('first  tab');
    await expect(page.locator('.editor-host.active .sv-whitespace-canvas')).toHaveAttribute(
      'data-marker-count',
      '2',
    );

    await createNewTab(page);
    await page.locator('.editor-host.active .vditor-sv').fill('second   tab');
    await expect(page.locator('.editor-host.active .sv-whitespace-canvas')).toHaveAttribute(
      'data-marker-count',
      '3',
    );
    await expect(page.locator('.editor-host:not(.active)')).toBeHidden();
    await expect(page.locator('.editor-host:not(.active) .sv-whitespace-canvas')).toBeHidden();

    await page.locator('.document-tab').first().click();
    await expect(page.locator('.editor-host.active .sv-whitespace-canvas')).toHaveAttribute(
      'data-marker-count',
      '2',
    );
    await expect(page.locator('.editor-host:not(.active) .sv-whitespace-canvas')).toBeHidden();
  } finally {
    await closeApp(running);
  }
});

test('shows only the workspace name and refresh action in the explorer header', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-'));
  fs.mkdirSync(path.join(workspace, 'docs'));
  fs.writeFileSync(path.join(workspace, 'docs', 'inside.md'), '# Inside');
  const longFileName = 'abcdefghijklmnopqrstuvwx-document-ending.md';
  fs.writeFileSync(path.join(workspace, longFileName), '# Note');
  const running = await launchApp({
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: null, openFiles: [] },
  });
  try {
    await expect(running.page.locator('#workspaceName')).toHaveText(path.basename(workspace));
    await expect(running.page.locator('#workspaceHeading svg')).toBeVisible();
    await expect(running.page.locator('#refreshTree')).toBeVisible();
    await expect(running.page.locator('#fileSearch')).toHaveCount(0);
    await expect(running.page.locator('#newExplorerFile')).toHaveCount(0);
    await expect(running.page.locator('#workspaceLabel')).toHaveCount(0);
    const treeRows = running.page.locator('#fileTree .tree-row');
    await expect(treeRows).toHaveCount(2);
    const directory = running.page.locator('#fileTree > .tree-dir').first();
    await expect(directory).not.toHaveClass(/expanded/);
    await expect(directory).toHaveAttribute('aria-expanded', 'false');
    await directory.locator('.chevron').click();
    const nestedFile = running.page.locator('#fileTree > .tree-children .tree-file').first();
    await expect(directory).toHaveClass(/expanded/);
    await expect(nestedFile).toBeVisible();
    await directory.locator('.chevron').click();
    await expect(directory).not.toHaveClass(/expanded/);
    await expect(nestedFile).toBeHidden();
    await directory.locator('.chevron').click();
    await expect(directory).toHaveClass(/expanded/);
    await expect(nestedFile).toBeVisible();
    await expect(running.page.locator('#fileTree .tree-row[draggable="true"]')).toHaveCount(0);
    expect(
      await treeRows.evaluateAll((rows) =>
        rows.every((row) => !row.draggable && !row.hasAttribute('draggable')),
      ),
    ).toBe(true);
    const sidebar = running.page.locator('#sidebar');
    const topFile = running.page.locator('#fileTree > .tree-file').first();
    const chevronBefore = await topFile.locator('.chevron').boundingBox();
    const iconBefore = await topFile.locator('.file-icon').boundingBox();
    const sidebarBefore = await sidebar.boundingBox();
    const divider = await running.page.locator('#sidebarResize').boundingBox();
    if (!sidebarBefore || !divider) throw new Error('Sidebar resize handle has no bounds');
    await running.page.mouse.move(divider.x + divider.width / 2, divider.y + 80);
    await running.page.mouse.down();
    await running.page.mouse.move(divider.x - 90, divider.y + 80, { steps: 5 });
    await running.page.mouse.up();
    const sidebarAfter = await sidebar.boundingBox();
    expect(sidebarAfter?.width || 0).toBeLessThan(sidebarBefore.width);
    const chevronAfter = await topFile.locator('.chevron').boundingBox();
    const iconAfter = await topFile.locator('.file-icon').boundingBox();
    expect(chevronAfter?.x).toBeCloseTo(chevronBefore?.x || 0, 0);
    expect(iconAfter?.x).toBeCloseTo(iconBefore?.x || 0, 0);
    await expect(topFile.locator('.tree-name')).toHaveAttribute('title', longFileName);
    await expect
      .poll(() => topFile.locator('.tree-name').textContent())
      .toMatch(/^abc.+\.\.\..+\.md$/);
    expect(
      await treeRows.evaluateAll((rows) =>
        rows.every((row) => !row.draggable && !row.hasAttribute('draggable')),
      ),
    ).toBe(true);
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('restores directory expansion separately for each workspace after refreshes and switches', async () => {
  const workspaceA = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-a-'));
  const workspaceB = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-b-'));
  fs.mkdirSync(path.join(workspaceA, 'docs'));
  fs.mkdirSync(path.join(workspaceB, 'other'));
  fs.writeFileSync(path.join(workspaceA, 'docs', 'one.md'), '# One');
  fs.writeFileSync(path.join(workspaceB, 'other', 'two.md'), '# Two');
  const running = await launchApp({
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspaceA, activeFilePath: null, openFiles: [] },
  });
  const openFolderFromMenu = async () => {
    await running.page.locator('#appMenuBar [data-menu="main"]').click();
    await running.page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Open Folder/ })
      .click();
  };
  try {
    const directoryA = running.page.locator('#fileTree > .tree-dir').filter({ hasText: 'docs' });
    await expect(directoryA).not.toHaveClass(/expanded/);
    await directoryA.click();
    await expect(directoryA).toHaveClass(/expanded/);
    await expect(
      running.page.locator('#fileTree .tree-file').filter({ hasText: 'one.md' }),
    ).toBeVisible();
    await expect
      .poll(() => readSetting(running.testRoot, 'workspace', 'workspaceTreeStates'))
      .toEqual([{ workspacePath: workspaceA, expandedPaths: [path.join(workspaceA, 'docs')] }]);

    fs.writeFileSync(path.join(workspaceA, 'docs', 'added.md'), '# Added');
    await expect(
      running.page.locator('#fileTree .tree-file').filter({ hasText: 'added.md' }),
    ).toBeVisible();
    await expect(directoryA).toHaveClass(/expanded/);

    await running.app.evaluate(
      ({ dialog }, folders) => {
        let index = 0;
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folders[index++]],
        });
      },
      [workspaceB, workspaceA],
    );
    await openFolderFromMenu();
    await expect(running.page.locator('#workspaceName')).toHaveText(path.basename(workspaceB));
    await expect(
      running.page.locator('#fileTree > .tree-dir').filter({ hasText: 'other' }),
    ).not.toHaveClass(/expanded/);
    await openFolderFromMenu();
    await expect(running.page.locator('#workspaceName')).toHaveText(path.basename(workspaceA));
    await expect(directoryA).toHaveClass(/expanded/);
    await expect(
      running.page.locator('#fileTree .tree-file').filter({ hasText: 'added.md' }),
    ).toBeVisible();
  } finally {
    await closeApp(running);
    fs.rmSync(workspaceA, { recursive: true, force: true });
    fs.rmSync(workspaceB, { recursive: true, force: true });
  }
});

test('reveals the file explorer after opening a folder from the File menu', async () => {
  const running = await launchApp({ sidebarVisible: false });
  try {
    const { app, page, testRoot } = running;
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, testRoot);
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Open Folder/ })
      .click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#workspaceName')).toHaveText(path.basename(testRoot));
    await expect.poll(() => readSetting(testRoot, 'workspace', 'sidebarVisible')).toBe(true);
  } finally {
    await closeApp(running);
  }
});

test('reloads clean workspace files and protects local edits from external changes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-external-change-'));
  const cleanPath = path.join(workspace, 'clean.md');
  const modifiedPath = path.join(workspace, 'modified.md');
  fs.writeFileSync(cleanPath, 'Initial content');
  fs.writeFileSync(modifiedPath, 'Original modified content');
  const running = await launchApp({
    autoSave: true,
    autoSaveDelay: 5_000,
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    session: {
      workspacePath: workspace,
      activeFilePath: cleanPath,
      openFiles: [cleanPath, modifiedPath],
    },
  });
  try {
    const { page } = running;
    const editor = page.locator('.editor-host.active .vditor-sv');
    await expect(editor).toContainText('Initial content');

    fs.writeFileSync(cleanPath, 'Reloaded from disk');
    await expect(editor).toContainText('Reloaded from disk');
    await expect(page.locator('#externalChangeBanner')).toBeHidden();

    await page.locator('.document-tab').filter({ hasText: 'modified.md' }).click();
    await editor.fill('Local changes');
    await expect(page.locator('.document-tab.active .dirty')).toHaveText('●');
    fs.writeFileSync(modifiedPath, 'External changes');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await expect(page.locator('.document-tab.active .conflict')).toHaveText('!');
    await expect.poll(() => fs.readFileSync(modifiedPath, 'utf8')).toBe('External changes');

    await page.locator('#externalIgnore').click();
    await expect(page.locator('#externalChangeBanner')).toBeHidden();
    await page.keyboard.press('Control+s');
    await expect.poll(() => fs.readFileSync(modifiedPath, 'utf8')).toContain('Local changes');
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('restores tabs and workspace independently', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-session-'));
  const markdownPath = path.join(workspace, 'restored.md');
  fs.writeFileSync(markdownPath, '# Restored');
  const session = {
    workspacePath: workspace,
    activeFilePath: markdownPath,
    openFiles: [markdownPath],
  };
  const workspaceOnly = await launchApp({
    restoreWorkspace: true,
    restoreTabs: false,
    sidebarVisible: true,
    session,
  });
  try {
    await expect(workspaceOnly.page.locator('#workspaceName')).toHaveText(path.basename(workspace));
    await expect(workspaceOnly.page.locator('.document-tab')).toHaveCount(0);
  } finally {
    await closeApp(workspaceOnly);
  }

  const tabsOnly = await launchApp({
    restoreWorkspace: false,
    restoreTabs: true,
    sidebarVisible: true,
    session,
  });
  try {
    await expect(tabsOnly.page.locator('.document-tab span')).toHaveText('restored.md');
    await expect(tabsOnly.page.locator('#workspaceName')).toHaveText('No workspace opened');
  } finally {
    await closeApp(tabsOnly);
    fs.rmSync(workspace, { recursive: true, force: true });
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

    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('dark');

    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('light');

    await page.locator('#statusSettings').click();
    await expect(page.locator('.settings-card > header h2')).toHaveText('Vditor Desktop Settings');
    await expect(page.locator('.settings-nav button > svg')).toHaveCount(6);
    await page.locator('[name="contentTheme"]').selectOption('ant-design');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('ant-design');
    await page.locator('#saveSettings').click();

    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'contentTheme')).toBe('ant-design');
  } finally {
    await closeApp(running);
  }
});

for (const appTheme of ['dark', 'monokai-pro-dark'] as const) {
  for (const contentTheme of ['ant-design', 'wechat'] as const) {
    test(`keeps ${contentTheme} content readable in ${appTheme}`, async () => {
      const running = await launchApp({
        theme: appTheme,
        lastDarkTheme: appTheme,
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

test('remembers which dark theme the status toggle should restore', async () => {
  const running = await launchApp({
    theme: 'monokai-pro-dark',
    lastDarkTheme: 'monokai-pro-dark',
    contentTheme: 'dark',
  });
  try {
    const { page, testRoot } = running;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-dark');
    await expect(page.locator('#statusThemeToggle')).toBeChecked();

    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'lastDarkTheme'))
      .toBe('monokai-pro-dark');

    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'monokai-pro-dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'theme')).toBe('monokai-pro-dark');

    await page.locator('#statusSettings').click();
    await page.locator('.theme-option-dark').click();
    await expect.poll(() => readSetting(testRoot, 'appearance', 'lastDarkTheme')).toBe('dark');
    await page.locator('#saveSettings').click();
    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally {
    await closeApp(running);
  }
});

test('colors all six rendered heading levels in Monokai Pro Dark', async () => {
  const running = await launchApp({
    theme: 'monokai-pro-dark',
    lastDarkTheme: 'monokai-pro-dark',
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

for (const theme of ['classic', 'dark', 'monokai-pro-dark'] as const) {
  test(`keeps editor backgrounds stable across focus changes in ${theme}`, async () => {
    const running = await launchApp({
      theme,
      lastDarkTheme: theme === 'monokai-pro-dark' ? 'monokai-pro-dark' : 'dark',
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
        const application = await page
          .locator('#app')
          .evaluate((node) => getComputedStyle(node).backgroundColor);
        expect({ blurred, focused }).toEqual({ blurred: application, focused: application });
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
    await expect(page.locator('.theme-preview')).toHaveCount(3);
    await expect(page.locator('[name="theme"][value="classic"]')).toBeChecked();
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
    await expect.poll(() => readSetting(running.testRoot, 'appearance', 'theme')).toBe('dark');
    await expect(page.locator('[name="theme"][value="dark"]')).toBeChecked();
    await expect(page.locator('.theme-option-dark .theme-preview')).toHaveCSS(
      'border-color',
      'rgb(105, 162, 255)',
    );
    await expect(page.locator('#settingsModal')).toBeVisible();
    await page.locator('#saveSettings').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
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

    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => readSetting(testRoot, 'appearance', 'codeTheme')).toBe('monokai');
    await page.locator('#vditorToolbarMount button[data-type="code-theme"]').click();
    await expect(codeThemeButton(/^github$/)).toBeHidden();
    await expect(codeThemeButton(/^monokai$/)).toBeVisible();
    await codeThemeButton(/^monokai-sublime$/).click();
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'darkCodeTheme'))
      .toBe('monokai-sublime');

    await page.locator('#statusThemeToggle + span').click();
    await expect
      .poll(() => readSetting(testRoot, 'appearance', 'codeTheme'))
      .toBe('atom-one-light');
    await page.locator('#statusThemeToggle + span').click();
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

    await page.locator('#statusThemeToggle + span').click();
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
    await expect(page.locator('[data-settings-panel="appearance"]')).toContainText('跟隨系統主題');
  } finally {
    await closeApp(running);
  }
});

test('uses the file name in the title and matches all chrome background colors', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    await expect(page.locator('#windowTitle')).toHaveText('Untitled 1 - Vditor Desktop');
    await expect(page).toHaveTitle('Untitled 1 - Vditor Desktop');

    const chromeColors = () =>
      page.evaluate(() =>
        ['#windowTitlebar', 'header.titlebar', '.statusbar'].map(
          (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor,
        ),
      );
    const lightColors = await chromeColors();
    expect(new Set(lightColors).size).toBe(1);
    await expect(page.locator('#tabBar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await page.locator('#statusThemeToggle + span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkColors = await chromeColors();
    expect(new Set(darkColors).size).toBe(1);
    expect(darkColors[0]).not.toBe(lightColors[0]);
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
    const colors = await dialog.evaluate((node) =>
      ['header', '.confirm-content', 'footer'].map(
        (selector) => getComputedStyle(node.querySelector(selector)).backgroundColor,
      ),
    );
    expect(new Set(colors).size).toBe(1);
    const dialogBox = await dialog.boundingBox();
    const appBox = await page.locator('#app').boundingBox();
    expect(dialogBox).toEqual(appBox);
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
    const titlebarHeight = await page
      .locator('#windowTitlebar')
      .evaluate((node) => node.getBoundingClientRect().height);
    for (const selector of ['#windowMinimize', '#windowMaximize', '#windowClose']) {
      const transitions = await page.locator(selector).evaluate((node) => ({
        properties: getComputedStyle(node).transitionProperty,
        durations: getComputedStyle(node).transitionDuration,
        height: node.getBoundingClientRect().height,
      }));
      expect(transitions.properties).toContain('background-color');
      expect(transitions.properties).toContain('color');
      expect(transitions.durations).toContain('0.16s');
      expect(Math.abs(transitions.height - titlebarHeight)).toBeLessThan(1);
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

test('loads a relative local image from a restored Markdown document', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-image-fixture-'));
  const markdownPath = path.join(testRoot, 'image.md');
  const imagePath = path.join(testRoot, 'pixel.png');
  fs.writeFileSync(markdownPath, '![pixel](pixel.png)\r\n\r\ntext');
  fs.writeFileSync(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );

  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    session: {
      workspacePath: '',
      activeFilePath: markdownPath,
      openFiles: [markdownPath],
    },
  });
  try {
    const image = running.page.locator('.editor-host.active .vditor-preview img');
    await expect(running.page.locator('.document-tab span')).toHaveText(['image.md']);
    await expect(running.page.locator('#statusPath')).toHaveText(markdownPath);
    await expect(running.page.locator('#statusLineEnding')).toHaveText('CRLF');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
    await running.page.keyboard.press('Control+s');
    await expect(running.page.locator('#statusMessage')).toContainText('Saved');
    expect(fs.readFileSync(markdownPath, 'utf8')).toContain('\r\n');
  } finally {
    await closeApp(running);
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('loads relative images in raw HTML without changing the Markdown source', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-html-image-fixture-'));
  const assetsDir = path.join(testRoot, 'assets');
  const markdownPath = path.join(testRoot, 'README.md');
  const markdown = [
    '<div style="display: flex">',
    '  <img src="assets/light.png" alt="Light">',
    '  <img src="assets/dark.png" alt="Dark">',
    '</div>',
  ].join('\n');
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  fs.mkdirSync(assetsDir);
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(path.join(assetsDir, 'light.png'), pixel);
  fs.writeFileSync(path.join(assetsDir, 'dark.png'), pixel);

  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    session: {
      workspacePath: '',
      activeFilePath: markdownPath,
      openFiles: [markdownPath],
    },
  });
  try {
    const { page } = running;
    const expectImagesLoaded = async (selector: string) => {
      const images = page.locator(selector);
      await expect(images).toHaveCount(2);
      await expect
        .poll(() =>
          images.evaluateAll((nodes: HTMLImageElement[]) =>
            nodes.every((image) => image.naturalWidth === 1),
          ),
        )
        .toBe(true);
    };
    await expectImagesLoaded('.editor-host.active .vditor-preview img');

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="ir"]').click();
    await expectImagesLoaded('.editor-host.active .vditor-ir img');

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expectImagesLoaded('.editor-host.active .vditor-wysiwyg img');
    await page.keyboard.press('Control+s');
    await expect(page.locator('#statusMessage')).toContainText('Saved');
    const saved = fs.readFileSync(markdownPath, 'utf8');
    expect(saved.trimEnd()).toBe(markdown);
    expect(saved).not.toContain('local-file://');
  } finally {
    await closeApp(running);
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('loads HTTPS document images in IR, WYSIWYG, and split preview modes', async () => {
  const running = await launchApp({ editMode: 'ir' });
  try {
    const { page } = running;
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('https://images.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: pixel }),
    );
    await createNewTab(page);
    await page
      .locator('.editor-host.active .vditor-ir .vditor-reset')
      .fill('![online](https://images.test/pixel.png)');

    const expectLoaded = async (selector: string) => {
      const image = page.locator(selector);
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
        .toBe(1);
    };
    await expectLoaded('.editor-host.active .vditor-ir img');

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expectLoaded('.editor-host.active .vditor-wysiwyg img');

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
    await expectLoaded('.editor-host.active .vditor-preview img');
  } finally {
    await closeApp(running);
  }
});
