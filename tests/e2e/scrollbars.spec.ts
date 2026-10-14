import { expect, test } from '@playwright/test';
import { closeApp, createNewTab, launchApp } from './support/app-harness';

for (const editMode of ['ir', 'sv', 'wysiwyg']) {
  test(`reveals code block scrollbars independently of the ${editMode} pane`, async () => {
    const running = await launchApp(
      { editMode, scrollbarMode: 'auto' },
      { 'code.md': '```js\n' + 'const value = 123; '.repeat(100) + '\n```\n' },
    );
    try {
      const { page } = running;
      const pane = page.locator(
        `.editor-host.active .${editMode === 'sv' ? 'vditor-preview' : `vditor-${editMode}`}`,
      );
      const code = pane
        .locator(editMode === 'ir' ? 'pre.vditor-ir__preview > code' : 'pre > code:visible')
        .first();
      await expect(code).toBeVisible();
      await expect
        .poll(() => code.evaluate((node) => node.scrollWidth > node.clientWidth))
        .toBe(true);
      const colors = () => code.evaluate((node) => getComputedStyle(node).scrollbarColor);
      await page.mouse.move(0, 0);
      await expect.poll(colors).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      const box = await code.boundingBox();
      if (!box) throw new Error('Code block has no bounds');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3);
      await expect.poll(colors).not.toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      // Outlast the outer pane's auto-hide timeout while staying over the thumb.
      await page.waitForTimeout(1200);
      await expect.poll(colors).not.toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      const thumb = await code.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x + 24,
          y: rect.y + node.clientHeight + (node.offsetHeight - node.clientHeight) / 2,
        };
      });
      await page.mouse.move(thumb.x, thumb.y);
      await page.mouse.down();
      await page.mouse.move(thumb.x + 120, thumb.y, { steps: 10 });
      await page.mouse.up();
      await expect.poll(() => code.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      await page.mouse.move(0, 0);
      await expect.poll(colors).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      await createNewTab(page);
      await page.locator('.document-tab').filter({ hasText: 'code.md' }).click();
      await code.hover();
      await expect.poll(colors).not.toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      await page.locator('#statusSettings').click();
      await page.locator('[name="scrollbarMode"]').selectOption('always');
      await expect.poll(colors).not.toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      await page.locator('[name="scrollbarMode"]').selectOption('hidden');
      await expect
        .poll(() => code.evaluate((node) => getComputedStyle(node).scrollbarWidth))
        .toBe('none');
      await page.locator('[name="scrollbarMode"]').selectOption('auto');
      await expect.poll(colors).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
    } finally {
      await closeApp(running);
    }
  });
}

for (const pane of ['ir', 'sv', 'wysiwyg', 'preview']) {
  test(`reveals and auto-hides the ${pane} vertical scrollbar`, async () => {
    const running = await launchApp(
      { editMode: pane === 'preview' ? 'sv' : pane, scrollbarMode: 'auto' },
      { 'long.md': 'A paragraph.\n\n'.repeat(150) },
    );
    try {
      const { page } = running;
      const scroller = page.locator(
        `.editor-host.active .vditor-${pane}${pane === 'ir' || pane === 'wysiwyg' ? ' > .vditor-reset' : ''}`,
      );
      await expect
        .poll(() => scroller.evaluate((node) => node.scrollHeight > node.clientHeight))
        .toBe(true);
      const colors = () => scroller.evaluate((node) => getComputedStyle(node).scrollbarColor);
      await page.mouse.move(0, 0);
      await expect.poll(colors).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      const box = await scroller.boundingBox();
      if (!box) throw new Error('Vertical scroller has no bounds');
      await page.mouse.move(box.x + box.width - 3, box.y + 80);
      await expect.poll(colors).not.toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      await page.mouse.move(0, 0);
      await expect.poll(colors).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      await scroller.evaluate((node) => {
        node.scrollTop = 100;
      });
      await expect.poll(colors).not.toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
      await expect.poll(colors).toBe('rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)');
    } finally {
      await closeApp(running);
    }
  });
}

test('reveals the SV source horizontal scrollbar at the bottom edge', async () => {
  const running = await launchApp(
    { editMode: 'sv', scrollbarMode: 'auto', wordWrap: false },
    { 'code.md': '```js\n' + 'const value = 123; '.repeat(100) + '\n```\n' },
  );
  try {
    const { page } = running;
    const source = page.locator('.editor-host.active .vditor-sv');
    await expect
      .poll(() => source.evaluate((node) => node.scrollWidth > node.clientWidth))
      .toBe(true);
    await page.mouse.move(0, 0);
    await expect(source).not.toHaveClass(/scrollbar-visible/);
    const box = await source.boundingBox();
    if (!box) throw new Error('SV source has no bounds');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3);
    await expect(source).toHaveClass(/scrollbar-visible/);
  } finally {
    await closeApp(running);
  }
});
