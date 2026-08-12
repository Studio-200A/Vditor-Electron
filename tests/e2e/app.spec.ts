import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

const projectRoot = path.resolve(__dirname, '../..');

interface RunningApp {
  app: ElectronApplication;
  page: Page;
  testRoot: string;
}

async function launchApp(settings: Record<string, unknown> = {}): Promise<RunningApp> {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-e2e-'));
  const configDir = path.join(testRoot, 'config');
  fs.mkdirSync(configDir);
  fs.writeFileSync(
    path.join(configDir, 'settings.json'),
    JSON.stringify({
      locale: 'en_US',
      systemTheme: false,
      restoreTabs: false,
      restoreWorkspace: false,
      autoSave: false,
      ...settings,
    }),
  );

  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VDITOR_DESKTOP_CONFIG_DIR: configDir,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#appMenuBar[data-ready="true"]');
  return { app, page, testRoot };
}

async function closeApp(running: RunningApp): Promise<void> {
  await running.app.close();
  fs.rmSync(running.testRoot, { recursive: true, force: true });
}

async function createNewTab(page: Page): Promise<void> {
  await page.locator('#addTab').click();
  await page.waitForSelector('.editor-host.active .vditor-content');
}

async function typeMarkdown(source: ReturnType<Page['locator']>, lines: string[]): Promise<void> {
  await source.click();
  for (const [index, line] of lines.entries()) {
    if (index) await source.press('Enter');
    await source.pressSequentially(line);
  }
}

test('creates numbered tabs and shows the empty state after closing all tabs', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await expect(page.locator('#noTabs')).toBeVisible();

    await page.locator('#addTab').click();
    await expect(page.locator('.document-tab span')).toHaveText(['Untitled 1']);
    await page.locator('#addTab').click();
    await expect(page.locator('.document-tab span')).toHaveText(['Untitled 1', 'Untitled 2']);

    await page.locator('.document-tab').last().locator('b').click();
    await page.locator('.document-tab').last().locator('b').click();
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await expect(page.locator('#noTabs')).toBeVisible();
    await expect(page.locator('#emptyNewFile')).toBeVisible();
    await expect(page.locator('#emptyOpenFile')).toBeVisible();
  } finally {
    await closeApp(running);
  }
});

test('opens the View > Layout submenu and toggles the unified toolbar', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    await page.locator('[data-menu="view"]').click();
    await page.locator('.app-menu-popup button.has-submenu').hover();
    await expect(page.locator('.app-menu-popup.submenu')).toBeVisible();
    await page.locator('.app-menu-popup:not(.submenu) button', { hasText: 'Settings' }).hover();
    await expect(page.locator('.app-menu-popup.submenu')).toHaveCount(0);
    await page.locator('.app-menu-popup button.has-submenu').hover();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' }).click();
    await expect(page.locator('#app')).toHaveClass(/toolbar-hidden/);

    await page.locator('[data-menu="view"]').click();
    await page.locator('.app-menu-popup button.has-submenu').hover();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'Show Toolbar' }).click();
    await expect(page.locator('#app')).not.toHaveClass(/toolbar-hidden/);

    await page.locator('[data-menu="file"]').click();
    await expect(page.locator('.app-menu-popup button', { hasText: 'New File' })).toBeVisible();
    await page.locator('[data-menu="edit"]').hover();
    await expect(page.locator('[data-menu="edit"]')).toHaveClass(/active/);
    await expect(page.locator('.app-menu-popup button', { hasText: 'Undo' })).toBeVisible();
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
    const settingsPath = path.join(running.testRoot, 'config', 'settings.json');
    await expect
      .poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).splitRatio)
      .not.toBe(50);
    const contentBox = await page.locator('.editor-host.active .vditor-content').boundingBox();
    if (!contentBox) throw new Error('Split content has no bounding box');
    await page.mouse.move(resizerBox.x + 92, resizerBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(contentBox.x + contentBox.width / 2 + 1, resizerBox.y + 20);
    await page.mouse.up();
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).splitRatio).toBe(50);
    await expect(resizer).toHaveClass(/snapped/);

    await page.locator('.editor-host.active .sv-fold-toggle').first().click();
    await expect(page.locator('.editor-host.active .vditor-sv [data-folded-heading]')).toHaveCount(
      1,
    );
    await expect(page.locator('.editor-host.active .sv-line-number')).toHaveCount(1);

    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="ir"]').click();
    await expect(page.locator('.editor-host.active .vditor-ir')).toBeVisible();
    await expect(page.locator('.editor-host.active .sv-line-numbers')).toBeHidden();
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
    await page.keyboard.press('F11');
    await expect(page.locator('#app')).not.toHaveClass(/fullscreen/);
    await expect(page.locator('#windowTitlebar')).toBeVisible();
  } finally {
    await closeApp(running);
  }
});

test('folds only the selected heading section and restores its content', async () => {
  const running = await launchApp({ editMode: 'sv' });
  try {
    const { page } = running;
    await createNewTab(page);
    const source = page.locator('.editor-host.active .vditor-sv');
    await typeMarkdown(source, [
      '# Parent',
      'intro',
      '## Child A',
      'hidden A',
      '## Child B',
      'visible B',
    ]);
    const toggles = page.locator('.editor-host.active .sv-fold-toggle');
    await expect(toggles).toHaveCount(3);
    const expandedLineCount = await page.locator('.editor-host.active .sv-line-number').count();
    await toggles.nth(1).click();
    await expect(source.locator('.h1[data-folded-heading]')).toHaveCount(0);
    await expect(source.locator('.h2[data-folded-heading]')).toHaveCount(1);
    await expect
      .poll(() => page.locator('.editor-host.active .sv-line-number').count())
      .toBeLessThan(expandedLineCount);
    expect(await source.textContent()).toContain('hidden A');
    await toggles.nth(1).click();
    await expect(source.locator('[data-folded-heading]')).toHaveCount(0);
    await expect(page.locator('.editor-host.active .sv-line-number')).toHaveCount(
      expandedLineCount,
    );
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
    await expect(page.locator('.editor-host.active .sv-whitespace-layer')).toContainText('··');
    await source.press('End');
    await source.press('Tab');
    await source.type('y');
    await expect.poll(() => source.textContent()).toMatch(/indented\s{4}y/);
    await source.fill('- item');
    await source.press('End');
    await source.press('Enter');
    await source.type('next');
    await expect.poll(() => source.textContent()).toMatch(/- item\s+- next/);
  } finally {
    await closeApp(running);
  }
});

test('shows only the workspace name and refresh action in the explorer header', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-'));
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

test('saves settings live and keeps the enlarged settings dialog draggable', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await page.locator('#statusSettings').click();
    const card = page.locator('.settings-card');
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

    await page.locator('[name="theme"]').selectOption('dark');
    const settingsPath = path.join(running.testRoot, 'config', 'settings.json');
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).theme).toBe('dark');
    await expect(page.locator('#settingsModal')).toBeVisible();
    await page.locator('#saveSettings').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
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

    const settingsPath = path.join(running.testRoot, 'config', 'settings.json');
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).editorTextWidth).toBe(60);
  } finally {
    await closeApp(running);
  }
});

test('persists a code-block theme selected from the Vditor toolbar', async () => {
  const running = await launchApp();
  try {
    const { page } = running;
    await createNewTab(page);
    const trigger = page.locator('#vditorToolbarMount button[data-type="code-theme"]');
    await trigger.click();
    await trigger
      .locator('xpath=..')
      .locator('button')
      .filter({ hasText: /^monokai$/ })
      .click();

    const settingsPath = path.join(running.testRoot, 'config', 'settings.json');
    await expect
      .poll(() => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).codeTheme)
      .toBe('monokai');

    await page.reload();
    await page.waitForSelector('#appMenuBar[data-ready="true"]');
    await page.locator('#statusSettings').click();
    await expect(page.locator('[name="codeTheme"]')).toHaveValue('monokai');
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

    await page.locator('.theme-switch span').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#statusSettings').click();
    await expect(page.locator('#settingsModal')).toBeVisible();
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
