import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './support/app-harness';

for (const editMode of ['ir', 'wysiwyg', 'sv']) {
  for (const lineNumbers of [false, true]) {
    test(`keeps the ${editMode} code header outside content with line numbers ${lineNumbers}`, async () => {
      const content = 'print("hello") # ' + 'long content '.repeat(80) + '\nprint("world")';
      const markdown = '```python\n' + content + '\n```\n';
      const running = await launchApp(
        { editMode, lineNumbers, windowMaximized: false },
        { 'header.md': markdown },
      );
      try {
        const { page, app, testRoot } = running;
        const pane = page.locator(
          `.editor-host.active .vditor-${editMode === 'sv' ? 'preview' : editMode}`,
        );
        const header = pane.locator('.app-code-block-header').first();
        const button = header.locator('.app-code-block-copy');
        const code = header.locator('xpath=following-sibling::code').first();
        await expect(header).toBeVisible();
        await expect(header).toHaveAttribute('data-language', 'Python');
        await expect(code).toHaveClass(/hljs/);
        await expect
          .poll(() =>
            header.evaluate((node) => {
              const code = node.nextElementSibling;
              return (
                code &&
                getComputedStyle(node).backgroundColor === getComputedStyle(code).backgroundColor &&
                getComputedStyle(node).backgroundImage === getComputedStyle(code).backgroundImage
              );
            }),
          )
          .toBe(true);
        if (lineNumbers) await expect(code.locator('.vditor-linenumber__rows')).toBeAttached();
        await page.mouse.move(0, 0);
        await expect(button).toBeHidden();
        const before = await code.boundingBox();
        await header.hover();
        await expect(button).toBeVisible();
        expect(await code.boundingBox()).toEqual(before);
        const assertSeparation = async () => {
          const copyBox = await button.boundingBox();
          const codeBox = await code.boundingBox();
          if (!copyBox || !codeBox) throw new Error('Code header has no bounds');
          expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(codeBox.y);
        };
        await assertSeparation();
        await expect
          .poll(() => code.evaluate((node) => node.scrollWidth > node.clientWidth))
          .toBe(true);
        const headerBounds = await header.boundingBox();
        await code.evaluate((node) => {
          node.scrollLeft = 200;
        });
        expect(await header.boundingBox()).toEqual(headerBounds);
        await assertSeparation();
        await header.hover();
        await button.click({ timeout: 5000 });
        await expect
          .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
          .toBe(content);
        // The header remains separate even when code typography changes substantially.
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--code-size', '28px');
          document.documentElement.style.setProperty('--preview-code-size', '28px');
        });
        await header.hover();
        await assertSeparation();
        const switchMode = async (mode: string) => {
          await page.locator('#vditorToolbarMount button[data-type="edit-mode"]').click();
          await page.locator(`#vditorToolbarMount button[data-mode="${mode}"]`).click();
          await page.waitForTimeout(700);
        };
        if (editMode !== 'sv') await switchMode('sv');
        const changed = markdown.replace('```python', '```js');
        await page.locator('.editor-host.active .vditor-sv').evaluate((source) => {
          const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const offset = node.textContent?.indexOf('python') ?? -1;
            if (offset < 0) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 6);
            (source as HTMLElement).focus();
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            return;
          }
          throw new Error('Python fence is unavailable');
        });
        await page.keyboard.insertText('js');
        await page.waitForTimeout(700);
        if (editMode !== 'sv') await switchMode(editMode);
        await expect(header).toHaveAttribute('data-language', 'JavaScript');
        await page.keyboard.press('Control+s');
        await expect
          .poll(() => fs.readFileSync(path.join(testRoot, 'header.md'), 'utf8').trimEnd())
          .toBe(changed.trimEnd());
      } finally {
        await closeApp(running);
      }
    });
  }
}

for (const theme of ['classic', 'dark', 'monokai-pro-light']) {
  test(`shares the ${theme} code background when highlighting is disabled`, async () => {
    const running = await launchApp(
      {
        editMode: 'sv',
        theme,
        codeTheme: theme === 'dark' ? 'github-dark' : 'github',
        enableHighlight: false,
      },
      { 'plain.md': '```python\nprint(1)\n```\n' },
    );
    try {
      const header = running.page.locator('.editor-host.active .app-code-block-header').first();
      await expect(header).toBeVisible();
      await expect
        .poll(() =>
          header.evaluate((node) => {
            const code = node.nextElementSibling;
            const color = getComputedStyle(node).backgroundColor;
            return (
              color !== 'rgba(0, 0, 0, 0)' &&
              code &&
              color === getComputedStyle(code).backgroundColor
            );
          }),
        )
        .toBe(true);
    } finally {
      await closeApp(running);
    }
  });
}
