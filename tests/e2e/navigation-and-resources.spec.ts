import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatLocalResourceBase } from '../../src/main/local-resource';
import { closeApp, createNewTab, launchApp } from './support/app-harness';

function localResourceBase(directory: string, platform: 'posix' | 'win32'): string {
  return formatLocalResourceBase(directory, platform);
}

async function startRemoteSvgServer(): Promise<{
  url: string;
  requestCounts: Record<string, number>;
  close: () => Promise<void>;
}> {
  const requestCounts: Record<string, number> = {};
  const body =
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><rect width="2" height="1"/></svg>';
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    requestCounts[pathname] = (requestCounts[pathname] || 0) + 1;
    response.writeHead(200, {
      'Cache-Control': 'max-age=3600',
      'Content-Type': 'image/svg+xml; charset=utf-8',
    });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Remote SVG test server did not bind.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requestCounts,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

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

test('rejects malformed high-risk IPC arguments before they can create side effects', async () => {
  const running = await launchApp();
  try {
    const result = await running.page.evaluate(async () => {
      const rejectMessage = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
          return '';
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      const before = await window.appAPI.getSettings();
      const messages = await Promise.all([
        rejectMessage(() => window.fileAPI.deleteItem('relative.md')),
        rejectMessage(() =>
          window.fileAPI.writeDocument(
            '/tmp/vditor-ipc-validation.md',
            'content',
            'baseline',
            true,
          ),
        ),
        rejectMessage(() =>
          window.fileAPI.writeBinaryFile('/tmp/vditor-ipc-validation.bin', {
            byteLength: 1,
          } as unknown as Uint8Array),
        ),
        rejectMessage(() => window.appAPI.saveSettings({ editMode: 'source' })),
        rejectMessage(() => window.appAPI.setZoomFactor(250)),
        rejectMessage(() => window.fileAPI.setResourceRoots(['relative'])),
      ]);
      const after = await window.appAPI.getSettings();
      return {
        messages,
        localeUnchanged: after.locale === before.locale,
        modeUnchanged: after.editMode === before.editMode,
      };
    });
    expect(result.messages).toEqual(
      Array.from({ length: 6 }, () => expect.stringContaining('IPC_INVALID_ARGUMENT')),
    );
    expect(result.localeUnchanged).toBe(true);
    expect(result.modeUnchanged).toBe(true);
  } finally {
    await closeApp(running);
  }
});

test('does not authorize privileged IPC from a trusted-origin child frame', async () => {
  const running = await launchApp();
  try {
    await running.page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.src = 'app://app/index.html';
      frame.id = 'ipc-child-frame';
      document.body.append(frame);
    });
    await expect
      .poll(
        () => running.page.frames().filter((frame) => frame !== running.page.mainFrame()).length,
      )
      .toBe(1);
    const childFrame = running.page.frames().find((frame) => frame !== running.page.mainFrame());
    if (!childFrame) throw new Error('Child frame did not load.');
    const outcome = await childFrame.evaluate(async () => {
      if (!window.appAPI) return 'bridge-unavailable';
      try {
        await window.appAPI.getSettings();
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome === 'bridge-unavailable' || outcome.includes('IPC_UNTRUSTED_RENDERER')).toBe(
      true,
    );
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

test('keeps the main renderer isolated and blocks malicious Markdown HTML by default', async () => {
  const maliciousMarkdown = [
    '<img data-batch11="default" src="missing.png" onerror="window.__batch11HtmlExecuted = true">',
    '<script>window.__batch11ScriptExecuted = true</script>',
  ].join('\n');
  const running = await launchApp({ editMode: 'wysiwyg' }, { 'unsafe.md': maliciousMarkdown });
  try {
    const { app, page } = running;
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window?.webContents.getLastWebPreferences();
    });
    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    });
    await page.waitForSelector('.editor-host.active .vditor-wysiwyg');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __batch11HtmlExecuted?: boolean;
                __batch11ScriptExecuted?: boolean;
              }
            ).__batch11HtmlExecuted === true ||
            (window as typeof window & { __batch11ScriptExecuted?: boolean })
              .__batch11ScriptExecuted === true,
        ),
      )
      .toBe(false);
    expect(await page.locator('[data-batch11="default"]').count()).toBe(0);
    expect(
      await page.locator('script').filter({ hasText: '__batch11ScriptExecuted' }).count(),
    ).toBe(0);
  } finally {
    await closeApp(running);
  }
});

test('warns before disabling sanitization and CSP still blocks inline HTML handlers', async () => {
  const running = await launchApp(
    { editMode: 'wysiwyg', sanitize: false },
    { 'safe.md': '# Ready' },
  );
  try {
    const { page } = running;
    await page.waitForSelector('.editor-host.active .vditor-wysiwyg');
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.dataset.batch11 = 'disabled';
      image.src = 'missing.png';
      image.setAttribute('onerror', 'window.__batch11HtmlExecuted = true');
      document.body.append(image);
    });
    await expect(page.locator('[data-batch11="disabled"]')).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __batch11HtmlExecuted?: boolean })
              .__batch11HtmlExecuted === true,
        ),
      )
      .toBe(false);

    await page.locator('#statusSettings').click();
    await page.locator('.settings-nav button[data-panel="editor"]').click();
    const sanitize = page.locator('#settingsForm [name="sanitize"]');
    const securityCard = page.locator('.settings-security-card:has([name="sanitize"])');
    await expect(securityCard).toBeVisible();
    const securityLayout = await securityCard.evaluate((card) => {
      const toggle = card.querySelector('.theme-switch');
      const copy = card.querySelector('.settings-security-copy');
      if (!(toggle instanceof HTMLElement) || !(copy instanceof HTMLElement))
        throw new Error('Security card is incomplete.');
      const cardBounds = card.getBoundingClientRect();
      const toggleBounds = toggle.getBoundingClientRect();
      return {
        rightInset: cardBounds.right - toggleBounds.right,
        cardWidth: cardBounds.width,
        copyWidth: copy.getBoundingClientRect().width,
      };
    });
    expect(securityLayout.rightInset).toBeLessThanOrEqual(22);
    expect(securityLayout.copyWidth / securityLayout.cardWidth).toBeGreaterThan(0.7);
    await expect(sanitize).not.toBeChecked();
    await securityCard.locator('.settings-security-copy').click();
    await expect(sanitize).not.toBeChecked();
    await expect(page.locator('#confirmModal')).toBeHidden();
    await sanitize.evaluate((input: HTMLInputElement) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(sanitize).toBeChecked();
    await page.waitForTimeout(100);
    await securityCard.locator('.theme-switch').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    const confirmCard = page.locator('#confirmModal .confirm-card');
    await expect(confirmCard).toHaveClass(/confirm-card-draggable/);
    await expect(page.locator('#confirmModal .confirm-content')).toHaveCSS('user-select', 'none');
    await expect(page.locator('#confirmMessage')).toHaveText(
      'Turning it off may retain more raw HTML from trusted documents.',
    );
    await expect(page.locator('#confirmActions [data-action="confirm"]')).toHaveText(
      'Disable filtering anyway',
    );
    await page.locator('#confirmActions [data-action="cancel"]').click();
    await expect(sanitize).toBeChecked();
  } finally {
    await closeApp(running);
  }
});

test('keeps local and remote SVG images blocked until the unified setting is confirmed', async () => {
  const server = await startRemoteSvgServer();
  const running = await launchApp(
    { editMode: 'sv' },
    {
      'remote-images.md': [
        `![named SVG](${server.url}/named.svg)`,
        `![extensionless SVG](${server.url}/extensionless)`,
      ].join('\n\n'),
    },
  );
  try {
    const { page } = running;
    const images = page.locator('.editor-host.active .vditor-preview img');
    await expect(images).toHaveCount(2);
    await expect
      .poll(() => images.evaluateAll((nodes) => nodes.map((node) => node.naturalWidth)))
      .toEqual([0, 0]);
    expect(server.requestCounts['/named.svg'] || 0).toBe(0);
    await expect.poll(() => server.requestCounts['/extensionless'] || 0).toBeGreaterThan(0);

    await page.locator('#statusSettings').click();
    await page.locator('.settings-nav button[data-panel="editor"]').click();
    const allowSvgImages = page.locator('#settingsForm [name="allowSvgImages"]');
    await allowSvgImages.locator('xpath=..').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await expect(page.locator('#confirmMessage')).toHaveText(
      'SVG is a programmable image format and can contain scripts, external resources, or malicious constructs. Rendering an untrusted SVG may create security or privacy risks.',
    );
    await page.locator('#confirmActions [data-action="confirm"]').click();
    await expect(allowSvgImages).toBeChecked();
    await expect
      .poll(() => images.evaluateAll((nodes) => nodes.map((node) => node.naturalWidth)))
      .toEqual([2, 2]);
    await allowSvgImages.locator('xpath=..').click();
    await expect(allowSvgImages).not.toBeChecked();
    await expect
      .poll(() => images.evaluateAll((nodes) => nodes.map((node) => node.naturalWidth)))
      .toEqual([0, 0]);
    await page.waitForTimeout(1_500);
    await expect(
      images.evaluateAll((nodes) => nodes.map((node) => node.naturalWidth)),
    ).resolves.toEqual([0, 0]);
    await expect(page.evaluate(() => window.appAPI.getSettings())).resolves.toMatchObject({
      allowSvgImages: false,
    });
  } finally {
    await closeApp(running);
    await server.close();
  }
});

test('allows only the pinned MathJax inline loader required by Vditor', async () => {
  const running = await launchApp(
    { editMode: 'wysiwyg', mathEngine: 'MathJax' },
    { 'math.md': '$$x^2$$' },
  );
  try {
    const { page } = running;
    await page.waitForSelector('.editor-host.active .vditor-wysiwyg');
    await expect(page.locator('#protyleMathJaxScript')).toHaveCount(1);
    await expect(
      page.locator('.editor-host.active mjx-container, .editor-host.active svg'),
    ).not.toHaveCount(0);
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

test('limits local resources to open roots and returns safe image responses', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-local-resource-policy-'));
  const workspace = path.join(fixture, 'workspace');
  const outsideDocumentDirectory = path.join(fixture, 'outside-document');
  const unopenedDirectory = path.join(fixture, 'unopened');
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  fs.mkdirSync(path.join(workspace, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(outsideDocumentDirectory, 'assets'), { recursive: true });
  fs.mkdirSync(unopenedDirectory, { recursive: true });
  const workspaceDocument = path.join(workspace, 'workspace.md');
  const outsideDocument = path.join(outsideDocumentDirectory, 'outside.md');
  fs.writeFileSync(workspaceDocument, '![workspace](assets/pixel.png)');
  fs.writeFileSync(outsideDocument, '![outside](assets/pixel.png)');
  fs.writeFileSync(path.join(workspace, 'assets', 'pixel.png'), pixel);
  fs.writeFileSync(path.join(outsideDocumentDirectory, 'assets', 'pixel.png'), pixel);
  fs.writeFileSync(path.join(workspace, 'script.js'), 'window.__batch10ScriptExecuted = true;');
  fs.writeFileSync(
    path.join(workspace, 'page.html'),
    '<script>window.__batch10ScriptExecuted = true;</script>',
  );
  fs.writeFileSync(
    path.join(workspace, 'data.xml'),
    '<script>window.__batch10ScriptExecuted = true;</script>',
  );
  fs.writeFileSync(
    path.join(workspace, 'vector.svg'),
    '<svg><script>window.__batch10ScriptExecuted = true;</script></svg>',
  );
  fs.writeFileSync(path.join(unopenedDirectory, 'secret.png'), pixel);

  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    session: {
      workspacePath: workspace,
      activeFilePath: outsideDocument,
      openFiles: [workspaceDocument, outsideDocument],
    },
  });
  try {
    const { page } = running;
    const platform =
      (await page.evaluate(() => window.appAPI.platform)) === 'win32' ? 'win32' : 'posix';
    const workspaceTab = page.locator('.document-tab').filter({ hasText: 'workspace.md' });
    const outsideTab = page.locator('.document-tab').filter({ hasText: 'outside.md' });
    await expect(workspaceTab).toHaveCount(1);
    await expect(outsideTab).toHaveCount(1);

    await outsideTab.click();
    const outsideBase = await page
      .locator('.editor-host.active')
      .getAttribute('data-local-resource-base');
    if (!outsideBase) throw new Error('The outside-document resource base is unavailable.');
    await expect(page.locator('.editor-host.active .vditor-preview img')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.editor-host.active .vditor-preview img')
          .evaluate((node: HTMLImageElement) => node.naturalWidth),
      )
      .toBe(1);

    await workspaceTab.click();
    const workspaceBase = await page
      .locator('.editor-host.active')
      .getAttribute('data-local-resource-base');
    if (!workspaceBase) throw new Error('The workspace resource base is unavailable.');
    await expect(page.locator('.editor-host.active .vditor-preview img')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.editor-host.active .vditor-preview img')
          .evaluate((node: HTMLImageElement) => node.naturalWidth),
      )
      .toBe(1);

    const inspect = async (url: string) =>
      page.evaluate(async (resourceUrl) => {
        const response = await fetch(resourceUrl);
        return {
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
          contentType: response.headers.get('content-type'),
          noSniff: response.headers.get('x-content-type-options'),
          bodyLength: (await response.arrayBuffer()).byteLength,
        };
      }, url);
    const allowed = await inspect(new URL('assets/pixel.png', workspaceBase).href);
    const missing = await inspect(new URL('assets/missing.png', workspaceBase).href);
    const outside = await inspect(
      new URL('secret.png', localResourceBase(unopenedDirectory, platform)).href,
    );
    const script = await inspect(new URL('script.js', workspaceBase).href);
    const html = await inspect(new URL('page.html', workspaceBase).href);
    const xml = await inspect(new URL('data.xml', workspaceBase).href);
    const svg = await inspect(new URL('vector.svg', workspaceBase).href);

    expect(allowed).toEqual({
      status: 200,
      cacheControl: 'no-store',
      contentType: 'image/png',
      noSniff: 'nosniff',
      bodyLength: pixel.length,
    });
    for (const response of [missing, outside, script, html, xml, svg]) {
      expect(response).toEqual({
        status: 404,
        cacheControl: 'no-store',
        contentType: 'text/plain; charset=utf-8',
        noSniff: 'nosniff',
        bodyLength: 'Not found'.length,
      });
    }

    await outsideTab.click();
    const outsideImageUrl = new URL('assets/pixel.png', outsideBase).href;
    await outsideTab.locator('b').click();
    await expect(page.locator('.document-tab')).toHaveCount(1);
    const revoked = await inspect(outsideImageUrl);
    expect(revoked).toEqual(missing);
  } finally {
    await closeApp(running);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('stores uploaded images beside the saved document and previews the generated relative link', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-upload-resource-'));
  const assetsDirectory = path.join(testRoot, 'assets');
  const markdownPath = path.join(testRoot, 'notes.md');
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(markdownPath, '');

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
    const uploadInput = page.locator(
      '.vditor-toolbar__item [data-type="upload"] input[type="file"]',
    );
    await expect(uploadInput).toHaveCount(1);
    await uploadInput.setInputFiles({
      name: 'pasted.png',
      mimeType: 'image/png',
      buffer: pixel,
    });

    await expect
      .poll(() => {
        if (!fs.existsSync(assetsDirectory)) return 0;
        return fs.readdirSync(assetsDirectory).filter((name) => name.endsWith('-pasted.png'))
          .length;
      })
      .toBe(1);
    await page.keyboard.press('Control+s');
    await expect(page.locator('#statusMessage')).toContainText('Saved');
    const saved = fs.readFileSync(markdownPath, 'utf8');
    expect(saved).toMatch(/!\[pasted\.png\]\(assets\/\d+-pasted\.png\)/);
    expect(saved).not.toContain('local-file://');

    const image = page.locator('.editor-host.active .vditor-preview img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
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
