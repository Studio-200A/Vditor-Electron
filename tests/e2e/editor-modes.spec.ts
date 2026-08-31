import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeApp, createNewTab, launchApp, projectRoot, readSetting } from './support/app-harness';

test('finds, navigates, and replaces text in the active document', async () => {
  const running = await launchApp({}, { 'find.md': 'alpha beta alpha\nalpha' });
  try {
    const { page, testRoot } = running;
    await page.locator('.editor-host.active .vditor-content').click();
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

test('synchronizes status and preserves document position for Vditor mode shortcuts', async () => {
  const markdown = Array.from(
    { length: 180 },
    (_, index) => `## Section ${index + 1}\n\n${'long document content '.repeat(12)}`,
  ).join('\n\n');
  const running = await launchApp({ editMode: 'sv' }, { 'mode-shortcuts.md': markdown });
  try {
    const { page } = running;
    const host = page.locator('.editor-host.active');
    const progressFor = (mode: 'wysiwyg' | 'ir' | 'sv') =>
      host.evaluate((node, currentMode) => {
        const scroller = window.VditorDesktopAdapter.editorScrollContainer(node, currentMode);
        if (!scroller) throw new Error(`Missing ${currentMode} scroll container`);
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        return maximum ? scroller.scrollTop / maximum : 0;
      }, mode);
    const scrollToProgress = (mode: 'wysiwyg' | 'ir' | 'sv', progress: number) =>
      host.evaluate(
        (node, state) => {
          const scroller = window.VditorDesktopAdapter.editorScrollContainer(node, state.mode);
          if (!scroller) throw new Error(`Missing ${state.mode} scroll container`);
          const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = maximum * state.progress;
          scroller.dispatchEvent(new Event('scroll'));
          const editor = window.VditorDesktopAdapter.activeEditor(node, state.mode);
          editor?.focus({ preventScroll: true });
        },
        { mode, progress },
      );
    const modifier =
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
    const switchWithShortcut = async (
      shortcut: '7' | '8' | '9',
      mode: 'wysiwyg' | 'ir' | 'sv',
      label: string,
      expectedProgress: number,
    ) => {
      await page.keyboard.press(`${modifier}+Alt+${shortcut}`);
      await expect(
        page.locator(`.editor-host.active .vditor-${mode === 'wysiwyg' ? 'wysiwyg' : mode}`),
      ).toBeVisible();
      await expect(page.locator('#statusMode')).toHaveText(label);
      await expect.poll(() => progressFor(mode)).toBeGreaterThan(0.25);
      expect(Math.abs((await progressFor(mode)) - expectedProgress)).toBeLessThan(0.2);
    };

    await scrollToProgress('sv', 0.62);
    const sourceProgress = await progressFor('sv');
    await expect(sourceProgress).toBeGreaterThan(0.5);

    await switchWithShortcut('8', 'ir', 'IR', sourceProgress);
    const instantRenderingProgress = await progressFor('ir');
    await scrollToProgress('ir', instantRenderingProgress);
    await switchWithShortcut('7', 'wysiwyg', 'WYSIWYG', instantRenderingProgress);
    const wysiwygProgress = await progressFor('wysiwyg');
    await scrollToProgress('wysiwyg', wysiwygProgress);
    await switchWithShortcut('9', 'sv', 'SV', wysiwygProgress);
  } finally {
    await closeApp(running);
  }
});

test('applies a changed default editor mode only to later tabs', async () => {
  const running = await launchApp({ editMode: 'sv' });
  try {
    const { page, testRoot } = running;
    await createNewTab(page);
    const originalEditor = page.locator('.editor-host.active .vditor-content');
    await expect(page.locator('.editor-host.active .vditor-sv')).toBeVisible();
    await originalEditor.evaluate((node) => node.setAttribute('data-test-editor', 'existing'));

    await page.locator('#statusSettings').click();
    await page.locator('.settings-nav [data-panel="editor"]').click();
    await page.locator('[name="editMode"]').selectOption('wysiwyg');
    await page.locator('#saveSettings').click();

    await expect(page.locator('#settingsModal')).toBeHidden();
    await expect(originalEditor).toHaveAttribute('data-test-editor', 'existing');
    await expect(page.locator('.editor-host.active .vditor-sv')).toBeVisible();
    await expect.poll(() => readSetting(testRoot, 'editor', 'editMode')).toBe('wysiwyg');

    await createNewTab(page);
    await expect(page.locator('.editor-host.active .vditor-wysiwyg')).toBeVisible();
  } finally {
    await closeApp(running);
  }
});

test('switches to split view and renders source line numbers', async () => {
  const markdown = `## Heading\n\n${'long-line '.repeat(80)}\n\nlast`;
  const running = await launchApp({ editMode: 'ir' }, { 'line-numbers.md': markdown });
  try {
    const { page } = running;
    await expect(page.locator('.document-tab.active > span')).toHaveText('line-numbers.md');
    await expect(page.locator('.vditor-toolbar')).toHaveCount(1);
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();

    await expect(page.locator('.editor-host.active .vditor-sv')).toBeVisible();
    await expect(page.locator('.editor-host.active .sv-line-numbers')).toBeVisible();
    const source = page.locator('.editor-host.active .vditor-sv');
    const gutter = page.locator('.editor-host.active .sv-line-numbers');
    const lineNumberCanvas = page.locator('.editor-host.active .sv-line-number-canvas');
    await expect(gutter).toHaveCSS('pointer-events', 'none');
    await expect(gutter).toHaveCSS('user-select', 'none');
    await expect(lineNumberCanvas).toHaveClass(/scroll-linked/);
    await expect(page.locator('.editor-host.active .sv-line-number')).toHaveCount(5);
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
    await source.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = document.querySelector('.editor-host.active .vditor-sv');
          const canvas = document.querySelector('.editor-host.active .sv-line-number-canvas');
          if (!(source instanceof HTMLElement) || !(canvas instanceof HTMLElement))
            return Number.POSITIVE_INFINITY;
          const transform = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
          return Math.abs(transform.m42 + source.scrollTop);
        }),
      )
      .toBeLessThan(1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = document.querySelector('.editor-host.active .vditor-sv');
          const lastNumber = document.querySelector(
            '.editor-host.active .sv-line-number:last-child',
          );
          if (!(source instanceof HTMLElement) || !lastNumber) return Number.POSITIVE_INFINITY;
          const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
          let text = walker.nextNode();
          while (text && text.textContent !== 'last') text = walker.nextNode();
          if (!text) return Number.POSITIVE_INFINITY;
          const range = document.createRange();
          range.selectNodeContents(text);
          const textRect = range.getBoundingClientRect();
          const numberRect = lastNumber.getBoundingClientRect();
          return Math.abs(
            textRect.top + textRect.height / 2 - (numberRect.top + numberRect.height / 2),
          );
        }),
      )
      .toBeLessThan(4);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = document.querySelector('.editor-host.active .vditor-sv');
          const lastNumber = document.querySelector(
            '.editor-host.active .sv-line-number:last-child',
          );
          if (!(source instanceof HTMLElement) || !(lastNumber instanceof HTMLElement))
            return false;
          const spacerHeight = Number.parseFloat(getComputedStyle(source, '::after').height);
          return (
            lastNumber.offsetTop + lastNumber.offsetHeight <= source.scrollHeight - spacerHeight
          );
        }),
      )
      .toBe(true);

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

test('does not number Vditor SV bottom spacer after README source', async () => {
  const markdown = fs.readFileSync(path.join(projectRoot, 'README_CN.md'), 'utf8');
  const running = await launchApp({ editMode: 'sv' }, { 'README_CN.md': markdown });
  try {
    const { page } = running;
    await expect(page.locator('.editor-host.active .vditor-sv')).toBeVisible();
    await expect(page.locator('.editor-host.active .sv-line-numbers')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const numbers = Array.from(
            document.querySelectorAll('.editor-host.active .sv-line-number'),
          );
          return (
            numbers.length > 0 &&
            numbers.every((number, index) => number.textContent === String(index + 1))
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = document.querySelector('.editor-host.active .vditor-sv');
          const lastNumber = document.querySelector(
            '.editor-host.active .sv-line-number:last-child',
          );
          if (!(source instanceof HTMLElement) || !(lastNumber instanceof HTMLElement))
            return false;
          const spacerHeight = Number.parseFloat(getComputedStyle(source, '::after').height);
          return (
            lastNumber.offsetTop + lastNumber.offsetHeight <= source.scrollHeight - spacerHeight
          );
        }),
      )
      .toBe(true);
  } finally {
    await closeApp(running);
  }
});

test('keeps blank SV line numbers in flow after fullscreen scrolling', async () => {
  const markdown = Array.from({ length: 60 }, (_, index) =>
    index % 2 === 0 ? `line ${index + 1}` : '',
  ).join('\n');
  const running = await launchApp(
    { editMode: 'sv', toolbarVisible: false },
    { 'sv-blank-lines.md': markdown },
  );
  try {
    const { page } = running;
    await expect(page.locator('.editor-host.active .vditor-sv')).toBeVisible();
    await page.keyboard.press('F11');
    await expect(page.locator('#app')).toHaveClass(/fullscreen/);
    const source = page.locator('.editor-host.active .vditor-sv');
    await source.evaluate((node) => {
      node.scrollTop = 257;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const gutter = document.querySelector('.editor-host.active .sv-line-numbers');
          const source = document.querySelector('.editor-host.active .vditor-sv');
          if (!(gutter instanceof HTMLElement) || !(source instanceof HTMLElement)) return null;
          const gutterTop = gutter.getBoundingClientRect().top;
          const blankLines = Array.from({ length: 60 }, (_, index) => index + 1).filter(
            (line) => line % 2 === 0,
          );
          const pinnedBlankLines = blankLines.filter((line) => {
            const number = Array.from(
              document.querySelectorAll('.editor-host.active .sv-line-number'),
            ).find((item) => item.textContent === String(line));
            if (!(number instanceof HTMLElement)) return false;
            const rect = number.getBoundingClientRect();
            return rect.top <= gutterTop + 0.5 && rect.bottom > gutterTop + 1;
          });
          return pinnedBlankLines;
        }),
      )
      .toEqual([]);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = document.querySelector('.editor-host.active .vditor-sv');
          const numbers = Array.from(
            document.querySelectorAll('.editor-host.active .sv-line-number'),
          );
          if (!(source instanceof HTMLElement)) return Number.POSITIVE_INFINITY;
          const lines = window.VditorDesktopAdapter.sourceLineRanges(source);
          return Math.max(
            ...lines.map((line, index) => {
              const textRect = line.range.getBoundingClientRect();
              const numberRect = numbers[index]?.getBoundingClientRect();
              return textRect.height > 0 && numberRect
                ? Math.abs(
                    textRect.top + textRect.height / 2 - (numberRect.top + numberRect.height / 2),
                  )
                : 0;
            }),
          );
        }),
      )
      .toBeLessThan(0.75);
  } finally {
    await closeApp(running);
  }
});

test('deletes a selected nonempty table cell in WYSIWYG and Instant Rendering', async () => {
  const markdown = '| left | right |\n| --- | --- |\n| alpha | beta |';
  for (const mode of ['ir', 'wysiwyg'] as const) {
    const running = await launchApp({ editMode: mode }, { 'table-delete.md': markdown });
    try {
      const { page } = running;
      const modifier =
        (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
      const cell = page.locator('.editor-host.active tbody td').first();
      await expect(cell).toContainText('alpha');
      await cell.click();
      await page.keyboard.press(`${modifier}+a`);
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('alpha');
      await page.keyboard.press('Backspace');
      await expect(cell).toHaveText('');
    } finally {
      await closeApp(running);
    }
  }
});

test('shows the editor context menu only on editable surfaces and restores its Range', async () => {
  const markdown = 'first paragraph\n\nsecond paragraph';
  const running = await launchApp({ editMode: 'ir' }, { 'context.md': markdown });
  try {
    const { page } = running;
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    const switchTo = async (mode: 'ir' | 'wysiwyg' | 'sv') => {
      if (
        await page
          .locator(`.editor-host.active .vditor-${mode === 'wysiwyg' ? 'wysiwyg' : mode}`)
          .isVisible()
      )
        return;
      await modeTrigger.click();
      await page.locator(`#vditorToolbarMount button[data-mode="${mode}"]`).click();
      await expect(
        page.locator(`.editor-host.active .vditor-${mode === 'wysiwyg' ? 'wysiwyg' : mode}`),
      ).toBeVisible();
    };
    for (const mode of ['ir', 'wysiwyg', 'sv'] as const) {
      await switchTo(mode);
      const editor = page.locator(
        `.editor-host.active .${mode === 'sv' ? 'vditor-sv' : `vditor-${mode} .vditor-reset`}`,
      );
      await expect(editor).toBeVisible();
      await editor.evaluate((node) => {
        const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
        if (!text) throw new Error('Expected editable text');
        const range = document.createRange();
        range.setStart(text, Math.min(2, text.textContent?.length || 0));
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        (node.closest('.vditor-ir, .vditor-wysiwyg, .vditor-sv') as HTMLElement)?.focus();
      });
      await editor.click({ button: 'right' });
      const menu = page.locator('#contextMenu');
      await expect(menu).toBeVisible();
      await expect(menu.locator('[data-context-action="paste-plain"]')).toBeVisible();
      await expect(menu.locator('[data-context-action="select-context"]')).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      await menu.locator('[data-context-action="select-context"]').click();
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString().trim().length || 0))
        .toBeGreaterThan(0);

      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      if (mode === 'sv') {
        await page.locator('.editor-host.active .vditor-preview').click({ button: 'right' });
        await expect(menu).toBeHidden();
      }
    }
    const modifier =
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+f`);
    await expect(page.locator('#findInput')).toBeVisible();
    await page.locator('#findInput').click({ button: 'right' });
    await expect(page.locator('#contextMenu')).toBeHidden();
  } finally {
    await closeApp(running);
  }
});

test('closes the app menu before opening sidebar or editor context menus', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-menu-context-'));
  const filePath = path.join(workspace, 'context.md');
  fs.writeFileSync(filePath, 'context menu content');
  const running = await launchApp({
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { page } = running;
    const appMenu = page.locator('.app-menu-popup');
    const contextMenu = page.locator('#contextMenu');
    const mainMenu = page.locator('#appMenuBar [data-menu="main"]');
    const file = page.locator(`#fileTree .tree-file[data-path="${filePath}"]`);
    await expect(file).toBeVisible();

    await mainMenu.click();
    await expect(appMenu).toBeVisible();
    await file.dispatchEvent('contextmenu', { button: 2, clientX: 120, clientY: 120 });
    await expect(contextMenu).toBeVisible();
    await expect(appMenu).toHaveCount(0);

    await contextMenu.press('Escape');
    await expect(contextMenu).toBeHidden();
    await mainMenu.click();
    await expect(appMenu).toBeVisible();
    await page.locator('.editor-host.active .vditor-ir .vditor-reset').click({ button: 'right' });
    await expect(contextMenu).toBeVisible();
    await expect(appMenu).toHaveCount(0);
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('disables context-menu paste actions when the clipboard is empty', async () => {
  const running = await launchApp({}, { 'context-paste.md': 'editable content' });
  try {
    const { app, page } = running;
    const setClipboardText = async (text: string) =>
      app.evaluate(({ clipboard }, value) => {
        clipboard.readText = () => value;
        clipboard.readHTML = () => '';
      }, text);
    await setClipboardText('');
    const editor = page.locator('.editor-host.active .vditor-ir .vditor-reset');
    await editor.dispatchEvent('contextmenu', { button: 2, clientX: 100, clientY: 100 });
    const menu = page.locator('#contextMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-context-action="paste"]')).toBeDisabled();
    await expect(menu.locator('[data-context-action="paste-plain"]')).toBeDisabled();

    await setClipboardText('clipboard content');
    await editor.dispatchEvent('contextmenu', { button: 2, clientX: 100, clientY: 100 });
    await expect(menu.locator('[data-context-action="paste"]')).toBeEnabled();
    await expect(menu.locator('[data-context-action="paste-plain"]')).toBeEnabled();
  } finally {
    await closeApp(running);
  }
});

test('performs table context-menu actions in WYSIWYG and Instant Rendering', async () => {
  const markdown = '| left | right |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |';
  for (const mode of ['ir', 'wysiwyg'] as const) {
    const running = await launchApp({ editMode: mode }, { 'table-context.md': markdown });
    try {
      const { page } = running;
      const menu = page.locator('#contextMenu');
      const rightClickCell = async () => {
        await page.locator('.editor-host.active tbody td').first().click({ button: 'right' });
        await expect(menu).toBeVisible();
      };
      await rightClickCell();
      await expect(menu.locator('[data-context-action="table-insert-row"]')).toBeVisible();
      await expect(menu.locator('[data-context-action="table-delete-row"]')).toBeEnabled();
      await expect(menu.locator('[data-context-action="table-insert-column"]')).toBeVisible();
      await expect(menu.locator('[data-context-action="table-delete-column"]')).toBeVisible();
      await menu.locator('[data-context-action="table-insert-row"]').click();
      await expect.poll(() => page.locator('.editor-host.active tbody tr').count()).toBe(3);

      await rightClickCell();
      await menu.locator('[data-context-action="table-delete-row"]').click();
      await expect.poll(() => page.locator('.editor-host.active tbody tr').count()).toBe(2);

      await rightClickCell();
      await menu.locator('[data-context-action="table-insert-column"]').click();
      await expect
        .poll(() =>
          page
            .locator('.editor-host.active tbody td')
            .first()
            .evaluate((cell) => cell.parentElement!.children.length),
        )
        .toBe(3);

      await rightClickCell();
      await menu.locator('[data-context-action="table-delete-column"]').click();
      await expect
        .poll(() =>
          page
            .locator('.editor-host.active tbody td')
            .first()
            .evaluate((cell) => cell.parentElement!.children.length),
        )
        .toBe(2);

      await page.locator('.editor-host.active thead th').first().click({ button: 'right' });
      await expect(menu.locator('[data-context-action="table-delete-row"]')).toBeDisabled();
    } finally {
      await closeApp(running);
    }
  }
});

test('keeps a long table cell horizontally positioned after multi-character paste', async () => {
  const longCell = 'x'.repeat(1024);
  const markdown = `| content |\n| --- |\n| ${longCell} |`;
  for (const mode of ['ir', 'wysiwyg'] as const) {
    const running = await launchApp({ editMode: mode }, { 'table-composition.md': markdown });
    try {
      const { page } = running;
      const outcome = await page.locator('.editor-host.active table').evaluate((table) => {
        const cell = table.querySelector('tbody td');
        const text = cell?.firstChild;
        if (!cell || !text) throw new Error('Expected a populated table cell.');
        table.scrollLeft = Math.min(160, table.scrollWidth - table.clientWidth);
        if (table.scrollLeft <= 0) throw new Error('Expected the table to overflow horizontally.');
        const before = table.scrollLeft;
        const range = document.createRange();
        range.setStart(text, text.textContent?.length || 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        text.textContent += '中文';
        cell.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: '中文',
            inputType: 'insertFromPaste',
          }),
        );
        window.setTimeout(() => {
          const replacement = document.querySelector('.editor-host.active table');
          const replacementCell = replacement?.querySelector('tbody td');
          if (!(replacement instanceof HTMLElement) || !replacementCell) return;
          replacement.scrollLeft = 0;
          replacementCell.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data: '中文',
              inputType: 'insertFromPaste',
            }),
          );
        }, 0);
        return { before };
      });
      await page.waitForTimeout(300);
      const after = await page.locator('.editor-host.active table').evaluate((table) => ({
        scrollLeft: table.scrollLeft,
        text: table.textContent,
      }));

      expect(outcome.before).toBeGreaterThan(0);
      expect(after.scrollLeft).toBeGreaterThan(0);
      expect(after.text).toContain('中文');
    } finally {
      await closeApp(running);
    }
  }
});

test('keeps a long table cell at its right edge after Vditor handles a paste', async () => {
  const markdown = `| content |\n| --- |\n| ${'x'.repeat(1024)} |`;
  for (const mode of ['ir', 'wysiwyg'] as const) {
    const running = await launchApp({ editMode: mode }, { 'table-native-paste.md': markdown });
    try {
      const { page } = running;
      const before = await page.locator('.editor-host.active table').evaluate((table) => {
        const cell = table.querySelector('tbody td');
        const text = cell?.firstChild;
        if (!cell || !text) throw new Error('Expected a populated table cell.');
        table.scrollLeft = table.scrollWidth - table.clientWidth;
        if (table.scrollLeft <= 0) throw new Error('Expected the table to overflow horizontally.');
        const before = table.scrollLeft;
        const range = document.createRange();
        range.setStart(text, text.textContent?.length || 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const clipboard = new DataTransfer();
        clipboard.setData('text/plain', ' pasted words');
        cell.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard,
          }),
        );
        return before;
      });
      await expect
        .poll(() => page.locator('.editor-host.active table').textContent())
        .toContain('pasted words');
      await expect
        .poll(() =>
          page.locator('.editor-host.active table').evaluate((table) => {
            return table.scrollLeft - (table.scrollWidth - table.clientWidth);
          }),
        )
        .toBeCloseTo(0, 0);
      const after = await page.locator('.editor-host.active table').evaluate((table) => ({
        scrollLeft: table.scrollLeft,
        maximumLeft: table.scrollWidth - table.clientWidth,
      }));

      expect(before).toBeGreaterThan(0);
      expect(after.maximumLeft).toBeGreaterThan(0);
      expect(after.scrollLeft).toBeCloseTo(after.maximumLeft, 0);
    } finally {
      await closeApp(running);
    }
  }
});

test('moves a long table only enough to keep a pasted middle caret visible', async () => {
  const markdown = `| content |\n| --- |\n| ${'x'.repeat(1024)} |`;
  for (const mode of ['ir', 'wysiwyg'] as const) {
    const running = await launchApp({ editMode: mode }, { 'table-paste-caret.md': markdown });
    try {
      const { page } = running;
      const before = await page.locator('.editor-host.active table').evaluate((table) => {
        const cell = table.querySelector('tbody td');
        const text = cell?.firstChild;
        if (!cell || !text) throw new Error('Expected a populated table cell.');
        const range = document.createRange();
        const offset = Math.floor((text.textContent?.length || 0) / 2);
        range.setStart(text, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const caret = range.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        table.scrollLeft = Math.max(1, caret.left - tableRect.left - table.clientWidth + 30);
        const before = table.scrollLeft;
        const clipboard = new DataTransfer();
        clipboard.setData('text/plain', ' pasted content '.repeat(12));
        cell.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard,
          }),
        );
        return before;
      });
      await expect
        .poll(() => page.locator('.editor-host.active table').textContent())
        .toContain('pasted content');
      const after = await page.locator('.editor-host.active table').evaluate((table) => ({
        scrollLeft: table.scrollLeft,
        maximumLeft: table.scrollWidth - table.clientWidth,
      }));

      expect(before).toBeGreaterThan(0);
      expect(after.scrollLeft).toBeGreaterThan(before);
      expect(after.scrollLeft).toBeLessThan(after.maximumLeft);
    } finally {
      await closeApp(running);
    }
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

test('selects the current editor context before the complete document with Ctrl/Cmd+A', async () => {
  const running = await launchApp({ editMode: 'ir' });
  try {
    const { page } = running;
    await createNewTab(page);
    const modifier =
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    const switchTo = async (mode: 'wysiwyg' | 'ir' | 'sv') => {
      await modeTrigger.click();
      await page.locator(`#vditorToolbarMount button[data-mode="${mode}"]`).click();
      await expect(
        page.locator(`.editor-host.active .vditor-${mode === 'wysiwyg' ? 'wysiwyg' : mode}`),
      ).toBeVisible();
    };
    const selectionText = () => page.evaluate(() => window.getSelection()?.toString());
    const placeCaretAtStart = (editor: ReturnType<Page['locator']>) =>
      editor.evaluate((node) => {
        const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
        if (!text) throw new Error('Expected editable text');
        const range = document.createRange();
        range.setStart(text, 0);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        (node.closest('.vditor-ir, .vditor-wysiwyg, .vditor-sv') as HTMLElement)?.focus({
          preventScroll: true,
        });
      });

    const ir = page.locator('.editor-host.active .vditor-ir .vditor-reset');
    await ir.fill('first paragraph\n\nsecond paragraph');
    await placeCaretAtStart(ir);
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toBe('first paragraph');
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toContain('second paragraph');

    await switchTo('wysiwyg');
    const wysiwyg = page.locator('.editor-host.active .vditor-wysiwyg .vditor-reset');
    await placeCaretAtStart(wysiwyg);
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toBe('first paragraph');
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toContain('second paragraph');

    await switchTo('sv');
    const source = page.locator('.editor-host.active .vditor-sv');
    await placeCaretAtStart(source);
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toBe('first paragraph');
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toContain('second paragraph');

    await source.fill('<div>HTML content</div>');
    const htmlCaretPoint = await source.evaluate((node) => {
      const text = node.querySelector('.vditor-sv__marker')?.firstChild;
      if (!text) throw new Error('Expected HTML marker text');
      const range = document.createRange();
      range.setStart(text, 6);
      range.setEnd(text, 7);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(htmlCaretPoint.x, htmlCaretPoint.y);
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toBe('<div>HTML content</div>');
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toContain('\n');

    await page.keyboard.press(`${modifier}+f`);
    await expect(page.locator('#findInput')).toBeFocused();
    await page.keyboard.press(`${modifier}+a`);
    await expect(page.locator('#findInput')).toHaveValue('');

    await page.keyboard.press('Escape');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.locator('#statusMode').click();
    await page.keyboard.press(`${modifier}+a`);
    await expect.poll(selectionText).toBe('');
  } finally {
    await closeApp(running);
  }
});

test('keeps WYSIWYG code-block selection on the application two-stage path', async () => {
  const running = await launchApp(
    { editMode: 'wysiwyg' },
    { 'code-block.md': 'before\n\n```js\nconst value = 1;\n```\n\nafter' },
  );
  try {
    const { page } = running;
    const modifier =
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
    const block = page.locator('.editor-host.active [data-type="code-block"]').first();
    await block.locator('.vditor-wysiwyg__preview').click();
    const code = block.locator('code').first();
    await code.waitFor({ state: 'visible' });
    await code.evaluate((node) => {
      const text = node.firstChild;
      if (!text) throw new Error('Expected code text');
      const range = document.createRange();
      range.setStart(text, 2);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      (node.closest('.vditor-wysiwyg') as HTMLElement)?.focus({ preventScroll: true });
    });
    await page.keyboard.press(`${modifier}+a`);
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toContain('const value = 1;');
    await page.keyboard.press(`${modifier}+a`);
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toContain('before');
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toContain('after');
  } finally {
    await closeApp(running);
  }
});

test('selects README raw HTML source lines at closing-tag boundaries', async () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  const running = await launchApp({ editMode: 'sv' }, { 'selection-readme.md': readme });
  try {
    const { page } = running;
    const source = page.locator('.editor-host.active .vditor-sv');
    await expect(source).toBeVisible();
    await source.evaluate((node) => {
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !text.textContent?.includes('code_style-prettier')) text = walker.nextNode();
      if (!text?.textContent) throw new Error('README badge HTML line is missing');
      const range = document.createRange();
      range.setStart(text, text.textContent.length);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      (node as HTMLElement).focus({ preventScroll: true });
    });
    const modifier =
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+a`);
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe(
        '  <a href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" alt="code style: prettier" /></a>',
      );
    const selectClosingParagraph = async (occurrence: number) => {
      await source.evaluate((node, targetOccurrence) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const closings = [];
        let text = walker.nextNode();
        while (text) {
          if (text.textContent === '</p>') closings.push(text);
          text = walker.nextNode();
        }
        const target = closings[targetOccurrence];
        if (!target?.textContent) throw new Error('README closing paragraph tag is missing');
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        const range = document.createRange();
        range.setStart(target, target.textContent.length);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        (node as HTMLElement).focus({ preventScroll: true });
      }, occurrence);
      await page.keyboard.press(`${modifier}+a`);
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('</p>');
    };
    await selectClosingParagraph(0);
    await selectClosingParagraph(2);
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
    const headingIsVisible = (editor: ReturnType<Page['locator']>, selector: string, index = 0) =>
      editor.evaluate(
        (node, target) => {
          const heading = node.querySelectorAll(target.selector)[target.index];
          const scroller = node.matches('.vditor-preview, .vditor-sv')
            ? node
            : node.querySelector(':scope > .vditor-reset') || node;
          if (!heading || !scroller) return false;
          const headingRect = heading.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          return headingRect.top >= scrollerRect.top && headingRect.bottom <= scrollerRect.bottom;
        },
        { selector, index },
      );
    await ir.locator('.vditor-reset').fill(markdown);
    await expect(ir.locator('h2')).toHaveCount(1);
    const irLink = ir.locator('[data-type="a"] .vditor-ir__link');
    await irLink.hover();
    await expect(irLink.locator('..')).not.toHaveAttribute('title');
    await expect(page.locator('#appTooltip')).toBeVisible();
    await expect(page.locator('#appTooltip')).toHaveText(`${modifierLabel}+Click to follow link`);
    await expect(irLink).toHaveCSS('cursor', 'text');
    await page.keyboard.down(linkModifier);
    await expect(irLink).toHaveCSS('cursor', 'pointer');
    await page.keyboard.up(linkModifier);
    await irLink.click();
    await expect.poll(() => scrollTop(ir)).toBe(0);
    await irLink.click({ modifiers: [linkModifier] });
    await expect.poll(() => scrollTop(ir)).toBeGreaterThan(0);
    await page.waitForTimeout(300);
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
    await expect.poll(() => headingIsVisible(ir, 'h2')).toBe(true);

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
    await page.waitForTimeout(300);
    await wysiwyg.evaluate((node) => {
      node.scrollTop = 0;
      const reset = node.querySelector(':scope > .vditor-reset');
      if (reset) reset.scrollTop = 0;
    });
    await target.click();
    await expect.poll(() => headingIsVisible(wysiwyg, 'h2')).toBe(true);

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
    await page.waitForTimeout(300);
    await source.evaluate((node) => {
      node.scrollTop = 0;
    });
    await preview.evaluate((node) => {
      node.scrollTop = 0;
    });
    await target.click();
    await expect.poll(() => headingIsVisible(source, '[data-type="heading-marker"]', 1)).toBe(true);
    await expect.poll(() => headingIsVisible(preview, 'h2')).toBe(true);

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
    await expect(page.locator('#appTooltip')).toHaveText(`${modifierLabel}+Click to follow link`);
    await tocTarget.click();
    await expect.poll(() => preview.evaluate((node) => node.scrollTop)).toBeLessThan(4);
    await tocTarget.click({ modifiers: [linkModifier] });
    await expect.poll(() => source.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => preview.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  } finally {
    await closeApp(running);
  }
});

test('keeps a dynamic half-height bottom spacer in every editor mode', async () => {
  const running = await launchApp({ editMode: 'ir' });
  try {
    const { app, page } = running;
    await createNewTab(page);
    const spacer = (selector: string) =>
      page.evaluate((editorSelector) => {
        const host = document.querySelector('.editor-host.active');
        const editor = host?.querySelector(editorSelector);
        const content =
          editorSelector === '.vditor-sv' ? editor : editor?.querySelector('.vditor-reset');
        if (!host || !editor || !content)
          throw new Error(`Missing Vditor surface: ${editorSelector}`);
        return {
          hostHeight: host.clientHeight,
          variable: editor.style.getPropertyValue('--editor-bottom'),
          afterHeight: Number.parseFloat(getComputedStyle(content, '::after').height),
        };
      }, selector);
    const expectSpacer = async (selector: string) => {
      await expect
        .poll(async () => {
          const value = await spacer(selector);
          return (
            value.variable === `${Math.round(value.hostHeight / 2)}px` &&
            Math.abs(value.afterHeight - value.hostHeight / 2) < 1
          );
        })
        .toBe(true);
      const value = await spacer(selector);
      expect(value.variable).toBe(`${Math.round(value.hostHeight / 2)}px`);
      expect(value.afterHeight).toBe(Math.round(value.hostHeight / 2));
    };

    await expectSpacer('.vditor-ir');
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expectSpacer('.vditor-wysiwyg');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
    await expectSpacer('.vditor-sv');
    await expectSpacer('.vditor-preview');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700));
    await expectSpacer('.vditor-sv');
    await expectSpacer('.vditor-preview');
  } finally {
    await closeApp(running);
  }
});

test('hides Vditor native outline controls while keeping the Desktop outline available', async () => {
  const running = await launchApp({
    editMode: 'ir',
    sidebarVisible: true,
    toolbarItems: [
      'headings',
      'outline',
      'outdent',
      'indent',
      'edit-mode',
      'both',
      'preview',
      'code-theme',
      'content-theme',
    ],
  });
  try {
    const { page } = running;
    await createNewTab(page);
    await page.locator('.editor-host.active .vditor-ir .vditor-reset').fill('# Desktop outline');
    const nativeOutline = page.locator('#vditorToolbarMount button[data-type="outline"]');
    await expect(nativeOutline).toBeHidden();
    await page.locator('.sidebar-tabs [data-view="outline"]').click();
    await expect(page.locator('#outlineTree button', { hasText: 'Desktop outline' })).toBeVisible();

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="wysiwyg"]').click();
    await expect(nativeOutline).toBeHidden();
  } finally {
    await closeApp(running);
  }
});

test('matches Vditor native heading semantics in the Desktop outline', async () => {
  const markdown = [
    'Setext level one',
    '================',
    '',
    'Setext level two',
    '----------------',
    '',
    '```markdown',
    '# Not a heading',
    '```',
    '',
    '## ATX level two',
  ].join('\n');
  const running = await launchApp(
    { editMode: 'ir', sidebarVisible: true },
    { 'semantic-outline.md': markdown },
  );
  try {
    const { page } = running;
    await page.locator('.sidebar-tabs [data-view="outline"]').click();
    const nativeHeadings = () =>
      page.locator('.editor-host.active').evaluate((host) => {
        const adapter = window.VditorDesktopAdapter;
        const mode = ['wysiwyg', 'ir', 'sv'].find(
          (candidate) => host.querySelector(`.vditor-${candidate}`)?.getClientRects().length,
        );
        return adapter.outlineSnapshot(host, mode).map(({ level, text }) => ({ level, text }));
      });
    const outlineMatchesNative = async () => {
      const native = await nativeHeadings();
      const desktop = await page.locator('#outlineTree .outline-item').allTextContents();
      return native.length > 0 && desktop.join('\n') === native.map(({ text }) => text).join('\n');
    };
    await expect.poll(outlineMatchesNative).toBe(true);

    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    await modeTrigger.click();
    await page.locator('#vditorToolbarMount button[data-mode="sv"]').click();
    await expect.poll(outlineMatchesNative).toBe(true);
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

test('keeps split-view list toolbar actions stable while changing modes', async () => {
  const running = await launchApp({ editMode: 'ir' });
  try {
    const { page } = running;
    await createNewTab(page);
    const modeTrigger = page.locator('#vditorToolbarMount button[data-type="edit-mode"]');
    const switchTo = async (mode: 'wysiwyg' | 'ir' | 'sv') => {
      await modeTrigger.click();
      await page.locator(`#vditorToolbarMount button[data-mode="${mode}"]`).click();
      await expect(
        page.locator(`.editor-host.active .vditor-${mode === 'wysiwyg' ? 'wysiwyg' : mode}`),
      ).toBeVisible();
    };
    const observeSplitActionMutations = () =>
      page.evaluate(() => {
        const actions = ['outdent', 'indent'].map((type) => {
          const button = document.querySelector(`#vditorToolbarMount button[data-type="${type}"]`);
          const item = button?.closest('.vditor-toolbar__item');
          if (!item) throw new Error(`Missing ${type} toolbar item`);
          return item;
        });
        (
          window as typeof window & { splitToolbarActionChanges?: number[] }
        ).splitToolbarActionChanges = [0, 0];
        const changes = (window as typeof window & { splitToolbarActionChanges: number[] })
          .splitToolbarActionChanges;
        const observer = new MutationObserver((records) => {
          records.forEach((record) => {
            const index = actions.indexOf(record.target as HTMLElement);
            if (index >= 0 && record.attributeName === 'style') changes[index] += 1;
          });
        });
        actions.forEach((item) =>
          observer.observe(item, { attributes: true, attributeFilter: ['style'] }),
        );
        (
          window as typeof window & { splitToolbarActionObserver?: MutationObserver }
        ).splitToolbarActionObserver = observer;
      });
    const readSplitActionMutations = () =>
      page.evaluate(() => {
        (
          window as typeof window & { splitToolbarActionObserver?: MutationObserver }
        ).splitToolbarActionObserver?.disconnect();
        return (window as typeof window & { splitToolbarActionChanges?: number[] })
          .splitToolbarActionChanges;
      });

    await switchTo('wysiwyg');
    await observeSplitActionMutations();
    await switchTo('sv');
    await page.waitForTimeout(75);
    // Vditor performs its own single mode-transition update. Desktop keeps the
    // actions visible with CSS, so it must not add the former delayed rewrite.
    expect(await readSplitActionMutations()).toEqual([1, 1]);
    await expect(page.locator('#vditorToolbarMount button[data-type="outdent"]')).toBeVisible();
    await expect(page.locator('#vditorToolbarMount button[data-type="indent"]')).toBeVisible();

    await switchTo('ir');
    await observeSplitActionMutations();
    await switchTo('sv');
    await page.waitForTimeout(75);
    expect(await readSplitActionMutations()).toEqual([1, 1]);
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
    // Vditor keeps a scrollable tail after the last source line. At the exact
    // bottom there need not be a whitespace character in the viewport, so
    // verify redraw after returning to a position that contains source text.
    await source.evaluate((node) => {
      node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.75;
      node.dispatchEvent(new Event('scroll'));
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
