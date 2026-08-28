import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeApp, createNewTab, launchApp } from './support/app-harness';

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
    for (const value of [
      'javascript:alert(1)',
      ' data:text/html,unsafe',
      'https://example.com/\njavascript:alert(1)',
    ]) {
      const message = await running.page.evaluate(async (url) => {
        try {
          await window.appAPI.openExternal(url);
          return '';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }, value);
      expect(message).toContain('Unsupported URL protocol');
    }
  } finally {
    await closeApp(running);
  }
});

test('keeps top-level navigation inside the trusted app page and denies app popups', async () => {
  const running = await launchApp();
  try {
    const { page, app } = running;
    const initialUrl = page.url();

    const popupCreated = await page.evaluate(() => {
      const popup = window.open('app://evil/index.html', '_blank');
      return Boolean(popup);
    });
    expect(popupCreated).toBe(false);

    for (const target of ['app://evil/index.html', 'app://app/vditor/dist/index.css']) {
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.href = href;
        link.click();
      }, target);
      await expect.poll(() => page.url()).toBe(initialUrl);
    }

    expect(app.windows()).toHaveLength(1);
  } finally {
    await closeApp(running);
  }
});

test('does not execute unsupported schemes from rendered document links', async () => {
  const running = await launchApp({ editMode: 'wysiwyg' }, { 'unsafe.md': '# Ready' });
  try {
    const { page } = running;
    await page.waitForSelector('.editor-host.active .vditor-wysiwyg');
    await page.evaluate(() => {
      (window as typeof window & { __unsafeLinkExecuted?: boolean }).__unsafeLinkExecuted = false;
      const editor = document.querySelector('.editor-host.active .vditor-wysiwyg');
      if (!editor) throw new Error('WYSIWYG editor surface is unavailable');
      const link = document.createElement('a');
      link.href = 'javascript:window.__unsafeLinkExecuted = true';
      link.textContent = 'Unsafe';
      editor.append(link);
    });
    const link = page.locator('.editor-host.active .vditor-wysiwyg a[href^="javascript:"]');
    await expect(link).toHaveCount(1);
    await link.click();
    expect(
      await page.evaluate(
        () => (window as typeof window & { __unsafeLinkExecuted?: boolean }).__unsafeLinkExecuted,
      ),
    ).toBe(false);
  } finally {
    await closeApp(running);
  }
});

test('keeps the empty outline message below controls and non-selectable in fullscreen', async () => {
  const running = await launchApp({ sidebarVisible: true });
  try {
    const { page } = running;
    await page.locator('.sidebar-tabs [data-view="outline"]').click();
    const empty = page.locator('#outlineTree > .empty');
    await expect(empty).toHaveText('Open a document first');
    await expect(empty).toHaveCSS('user-select', 'none');

    await page.keyboard.press('F11');
    await expect(page.locator('#app')).toHaveClass(/fullscreen/);
    await expect(page.locator('#windowTitlebar')).toBeHidden();
    const tabsBox = await page.locator('header.titlebar .toolbar-sidebar-tabs').boundingBox();
    const emptyBox = await empty.boundingBox();
    if (!tabsBox || !emptyBox) throw new Error('Fullscreen outline controls have no bounds');
    expect(emptyBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);

    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(emptyBox.x + 12, emptyBox.y + emptyBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(emptyBox.x + emptyBox.width - 12, emptyBox.y + emptyBox.height / 2);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || '')).toBe('');
    await page.keyboard.press('F11');
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
