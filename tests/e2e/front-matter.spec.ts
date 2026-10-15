import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { closeApp, launchApp, openFromSecondInstance } from './support/app-harness';

const markdown =
  '---\n# keep comment\nname: "Example"\ndescription: |\n  First line\n  Second line\ntags: [one, two]\nauthor:\n  name: Alice\n---\n\n# Body\n\nParagraph.\n\n```yaml\nname: Fenced\n```\n';

for (const mode of ['ir', 'wysiwyg', 'sv']) {
  test(`keeps front matter collapsed when switching modes immediately after opening in ${mode}`, async () => {
    const running = await launchApp({
      editMode: mode,
      previewMode: 'both',
      theme: 'elegant',
      editorTextWidth: 85,
    });
    try {
      const { page, testRoot } = running;
      const content =
        '---\nname: example-dictionary\ndescription: >-\n  A bilingual dictionary for writing and reviewing documents.\n  Keep the established terminology and writing preferences.\n---\n\n# Dictionary\n\nBody\n';
      const filePath = path.join(testRoot, 'switch.md');
      fs.writeFileSync(filePath, content);
      await openFromSecondInstance(running, [filePath]);
      const host = page.locator('.editor-host.active');
      await expect(
        host.locator('.app-front-matter-table').filter({ visible: true }).first(),
      ).toBeVisible();
      const transitions = mode === 'ir' ? ['wysiwyg', 'ir'] : ['ir', 'wysiwyg'];
      for (const [index, next] of transitions.entries()) {
        await page.locator('#statusMode').click();
        await page.locator(`#statusModeMenu button[data-status-mode="${next}"]`).click();
        await page.waitForTimeout(650);
        const surface = host.locator(`.vditor-${next} .vditor-reset`);
        await expect(surface.locator('.app-front-matter-table').first()).toBeVisible();
        await expect(surface.locator('code[data-type="yaml-front-matter"]')).toBeHidden();
        if (index === 0) {
          await surface.locator('.app-front-matter-table td').first().click();
          await expect(surface.locator('code[data-type="yaml-front-matter"]')).toBeVisible();
        }
      }
      expect(fs.readFileSync(filePath, 'utf8')).toBe(content);
      const table = host
        .locator('.vditor-ir .app-front-matter-table, .vditor-wysiwyg .app-front-matter-table')
        .filter({ visible: true })
        .first();
      await table.locator('td').first().click();
      await expect(
        host
          .locator('.app-front-matter-editing code[data-type="yaml-front-matter"]')
          .filter({ visible: true }),
      ).toBeVisible();
    } finally {
      await closeApp(running);
    }
  });

  test(`keeps ${mode} metadata readable with an initial caret and long values`, async () => {
    const content = `---\nname: Example\ndescription: ${'long-description-'.repeat(80)}\n---\n\nBody\n`;
    const running = await launchApp(
      { editMode: mode, previewMode: 'both' },
      { 'readable.md': content },
    );
    try {
      const { page, testRoot } = running;
      const host = page.locator('.editor-host.active');
      const surface =
        mode === 'sv' ? '.vditor-preview .vditor-reset' : `.vditor-${mode} .vditor-reset`;
      if (mode !== 'sv') {
        // Model Vditor's automatic initial focus at the beginning of YAML,
        // without a click or editing key from the user.
        await host.locator(`${surface} code[data-type="yaml-front-matter"]`).evaluate((code) => {
          (code.closest('[contenteditable="true"]') as HTMLElement).focus();
          const range = document.createRange();
          range.selectNodeContents(code);
          range.collapse(true);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        });
      }
      const table = host.locator(`${surface} .app-front-matter-table`);
      await expect(table).toBeVisible();
      await table.evaluate((element) => {
        element.style.width = '280px';
      });
      for (const label of ['name', 'description']) {
        const header = table.locator('th', { hasText: label });
        const lines = await header.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()].map((rect) => rect.top);
        });
        expect(new Set(lines).size).toBe(1);
      }
      const value = table.locator('tr').nth(1).locator('td');
      expect(
        await value.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      if (mode !== 'sv') {
        await page.keyboard.press('Control+s');
        await expect(table).toBeVisible();
        await page.keyboard.press('ArrowRight');
        await expect(host.locator(`${surface} code[data-type="yaml-front-matter"]`)).toBeVisible();
      }
      const saved = fs.readFileSync(path.join(testRoot, 'readable.md'), 'utf8');
      expect(saved.split('---')[1]).toBe(content.split('---')[1]);
      expect(saved.trimEnd()).toMatch(/---\n\n?Body$/);
    } finally {
      await closeApp(running);
    }
  });

  test(`renders ${mode} YAML front matter and preserves source through editing, undo and mode switches`, async () => {
    const running = await launchApp(
      { editMode: mode, previewMode: 'both' },
      { 'front-matter.md': markdown },
    );
    try {
      const { page, testRoot } = running;
      const host = page.locator('.editor-host.active');
      const surface =
        mode === 'sv' ? '.vditor-preview .vditor-reset' : `.vditor-${mode} .vditor-reset`;
      const table = host.locator(`${surface} .app-front-matter-table`).first();
      await expect(table).toBeVisible();
      await expect(table.locator(':scope > tbody > tr > th')).toHaveText([
        'name',
        'description',
        'tags',
        'author',
      ]);
      await expect(table.locator(':scope > tbody > tr').nth(1).locator(':scope > td')).toHaveText(
        'First line\nSecond line\n',
      );
      await expect(host.locator(`${surface} code.language-yaml`).last()).toContainText(
        'name: Fenced',
      );
      expect(fs.readFileSync(path.join(testRoot, 'front-matter.md'), 'utf8')).toBe(markdown);
      // Let Vditor commit its initial undo baseline before the first edit.
      await page.waitForTimeout(650);
      if (mode !== 'sv') {
        await table.locator('td').first().click();
        await expect(host.locator(`${surface} code[data-type="yaml-front-matter"]`)).toBeVisible();
      }
      await host
        .locator(mode === 'sv' ? '.vditor-sv' : `${surface} code[data-type="yaml-front-matter"]`)
        .evaluate((root) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const offset = node.textContent?.indexOf('Example') ?? -1;
            if (offset < 0) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 'Example'.length);
            const editor = root.closest('[contenteditable="true"]') as HTMLElement;
            editor.focus();
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            return;
          }
          throw new Error('Front matter source is unavailable');
        });
      await page.keyboard.type('Changed');
      await page.waitForTimeout(650);
      if (mode !== 'sv') await host.locator(`${surface} h1`).click();
      await expect(table).toBeVisible();
      await expect(table.locator('td').first()).toHaveText('Changed');
      await page.keyboard.press('Control+s');
      const readYaml = () =>
        fs.readFileSync(path.join(testRoot, 'front-matter.md'), 'utf8').split('---')[1];
      await expect.poll(readYaml).toBe(markdown.replace('Example', 'Changed').split('---')[1]);
      await page.locator('#vditorToolbarMount button[data-type="undo"]').click();
      await page.waitForTimeout(650);
      await page.keyboard.press('Control+s');
      await expect.poll(readYaml).toBe(markdown.split('---')[1]);
      await page.locator('#vditorToolbarMount button[data-type="redo"]').click();
      await page.waitForTimeout(650);
      await page.keyboard.press('Control+s');
      await expect.poll(readYaml).toBe(markdown.replace('Example', 'Changed').split('---')[1]);

      for (const next of ['sv', 'ir', 'wysiwyg', 'sv']) {
        await page.locator('#vditorToolbarMount button[data-type="edit-mode"]').click();
        await page.locator(`#vditorToolbarMount button[data-mode="${next}"]`).click();
        await page.waitForTimeout(650);
      }
      await page.keyboard.press('Control+s');
      await expect.poll(readYaml).toBe(markdown.replace('Example', 'Changed').split('---')[1]);
      const saved = fs.readFileSync(path.join(testRoot, 'front-matter.md'), 'utf8');
      expect(saved).toContain('```yaml\nname: Fenced\n```');
      expect(saved).toContain('# Body');
      expect(saved).not.toContain('| name');
    } finally {
      await closeApp(running);
    }
  });

  test(`keeps invalid ${mode} front matter editable and renders it after correction`, async () => {
    const running = await launchApp(
      { editMode: mode, previewMode: 'both' },
      { 'invalid.md': '---\nname: [unfinished\n---\n\nBody\n' },
    );
    try {
      const { page } = running;
      const host = page.locator('.editor-host.active');
      const surface =
        mode === 'sv' ? '.vditor-preview .vditor-reset' : `.vditor-${mode} .vditor-reset`;
      const source = host.locator(
        mode === 'sv' ? '.vditor-sv' : `${surface} code[data-type="yaml-front-matter"]`,
      );
      await expect(source).toBeVisible();
      await expect(host.locator(`${surface} .app-front-matter-table`)).toHaveCount(0);
      await source.evaluate((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const offset = node.textContent?.indexOf('[unfinished') ?? -1;
          if (offset < 0) continue;
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + '[unfinished'.length);
          (root.closest('[contenteditable="true"]') as HTMLElement).focus();
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          return;
        }
        throw new Error('Invalid YAML source is unavailable');
      });
      await page.keyboard.type('Recovered');
      await page.waitForTimeout(650);
      if (mode !== 'sv') await host.locator(`${surface} p`).last().click();
      const table = host.locator(`${surface} .app-front-matter-table`);
      await expect(table).toBeVisible();
      await expect(table.locator('td')).toHaveText('Recovered');
    } finally {
      await closeApp(running);
    }
  });
}
