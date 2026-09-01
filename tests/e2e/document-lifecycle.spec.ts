import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatLocalResourceBase } from '../../src/main/local-resource';
import { RECOVERY_SCHEMA_VERSION, RecoveryStore } from '../../src/main/services/recovery-store';
import { SettingsStore } from '../../src/main/services/settings-store';
import {
  closeApp,
  delayVditorAfter,
  launchApp,
  projectRoot,
  readSetting,
  replaceFileAtomically,
} from './support/app-harness';

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

test('saves a changed Markdown document from the desktop editor', async () => {
  const running = await launchApp({ editMode: 'sv' }, { 'save target.md': 'Original content' });
  try {
    const { page, testRoot } = running;
    const filePath = path.join(testRoot, 'save target.md');
    await page.locator('.editor-host.active .vditor-sv').fill('Saved content');
    await page.keyboard.press('Control+s');

    await expect(page.locator('#statusMessage')).toContainText('Saved save target.md');
    await expect(page.locator('.document-tab.active .dirty')).toBeHidden();
    await expect.poll(() => fs.readFileSync(filePath, 'utf8').trimEnd()).toBe('Saved content');
  } finally {
    await closeApp(running);
  }
});

test('keeps later input dirty while an earlier document save is still committing', async () => {
  const running = await launchApp({ editMode: 'sv' }, { 'save-race.md': 'Original content' });
  try {
    const { app, page, testRoot } = running;
    const filePath = path.join(testRoot, 'save-race.md');
    await app.evaluate((_, destination) => {
      const nodeFs = process.getBuiltinModule('node:fs');
      const nodePath = process.getBuiltinModule('node:path');
      const originalRename = nodeFs.promises.rename.bind(nodeFs.promises);
      nodeFs.promises.rename = async (oldPath, newPath) => {
        if (nodePath.resolve(String(newPath)) === nodePath.resolve(destination))
          await new Promise((resolve) => setTimeout(resolve, 300));
        return originalRename(oldPath, newPath);
      };
    }, filePath);
    const editor = page.locator('.editor-host.active .vditor-sv');
    await editor.fill('Captured save content');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => fs.readdirSync(testRoot).some((name) => name.endsWith('.tmp')))
      .toBe(true);
    await editor.fill('Content entered while saving');

    await expect
      .poll(() => fs.readFileSync(filePath, 'utf8').trimEnd())
      .toBe('Captured save content');
    await expect(editor).toContainText('Content entered while saving');
    await expect(page.locator('.document-tab.active .dirty')).toHaveText('●');
  } finally {
    await closeApp(running);
  }
});

test('auto-saves a changed Markdown document through the document write path', async () => {
  const running = await launchApp(
    { autoSave: true, autoSaveDelay: 50, editMode: 'sv' },
    { 'auto-save target.md': 'Original content' },
  );
  try {
    const { page, testRoot } = running;
    const filePath = path.join(testRoot, 'auto-save target.md');
    await page.locator('.editor-host.active .vditor-sv').fill('Auto-saved content');

    await expect.poll(() => fs.readFileSync(filePath, 'utf8').trimEnd()).toBe('Auto-saved content');
    await expect(page.locator('.document-tab.active .dirty')).toBeHidden();
  } finally {
    await closeApp(running);
  }
});

test('directly restores a persisted recovery snapshot and clears it on save', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-recovery-e2e-'));
  const configDir = path.join(testRoot, 'config');
  const filePath = path.join(testRoot, 'recovery target.md');
  fs.mkdirSync(configDir);
  fs.writeFileSync(filePath, 'Original content');
  new SettingsStore(configDir).update({
    locale: 'en_US',
    systemTheme: false,
    editMode: 'sv',
    autoSave: false,
    restoreTabs: false,
    restoreWorkspace: false,
  });
  const recoveryDir = path.join(testRoot, 'recovery');
  const recoveryStore = new RecoveryStore(recoveryDir);
  await recoveryStore.save({
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    id: '756c51d8-34de-4618-a7c3-04cf367a3815',
    filePath,
    title: 'recovery target.md',
    content: 'Recovered after crash',
    savedContent: 'Original content',
    encoding: 'utf-8',
    lineEnding: 'LF',
    mode: 'sv',
    updatedAt: Date.now(),
  });
  let restored: ElectronApplication | null = null;
  try {
    restored = await electron.launch({
      args: ['.'],
      cwd: projectRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        VDITOR_DESKTOP_CONFIG_DIR: configDir,
        VDITOR_DESKTOP_DATA_DIR: path.join(testRoot, 'chromium'),
      },
    });
    const restoredPage = await restored.firstWindow();
    await restoredPage.waitForSelector('#appMenuBar[data-ready="true"]');
    await expect(restoredPage.locator('.editor-host.active .vditor-sv')).toContainText(
      'Recovered after crash',
    );
    await expect(restoredPage.locator('#confirmModal')).toBeHidden();
    await expect(restoredPage.locator('#recoveryBanner')).toBeVisible();
    await expect(restoredPage.locator('.recovery-banner-icon')).toHaveAttribute(
      'src',
      'assets/notification/warning.svg',
    );
    await expect(restoredPage.locator('#recoveryMessage')).toHaveText(
      'Recovered unsaved changes from the last unexpected exit.',
    );
    await expect(restoredPage.locator('#recoverySave')).toBeVisible();
    await expect(restoredPage.locator('#recoverySaveAs')).toBeVisible();
    await expect(restoredPage.locator('#recoveryDiscard')).toBeVisible();

    await restoredPage.locator('#recoverySave').click();
    await expect
      .poll(() => fs.readFileSync(filePath, 'utf8').trimEnd())
      .toBe('Recovered after crash');
    await expect.poll(() => fs.readdirSync(recoveryDir)).toEqual([]);
    await expect(restoredPage.locator('#recoveryBanner')).toBeHidden();
  } finally {
    if (restored) {
      restored.process().kill('SIGKILL');
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('merges a recovery snapshot into the restored session tab for the same file identity', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-recovery-session-e2e-'));
  const configDir = path.join(testRoot, 'config');
  const filePath = path.join(testRoot, 'session recovery.md');
  fs.mkdirSync(configDir);
  fs.writeFileSync(filePath, 'Original content');
  new SettingsStore(configDir).update({
    locale: 'en_US',
    systemTheme: false,
    editMode: 'sv',
    autoSave: false,
    restoreTabs: true,
    restoreWorkspace: false,
    session: { workspacePath: '', activeFilePath: filePath, openFiles: [filePath] },
  });
  await new RecoveryStore(path.join(testRoot, 'recovery')).save({
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    id: '2bd01a3d-a1b7-42f4-bd48-06cb431338dd',
    filePath,
    title: 'session recovery.md',
    content: 'Recovered unsaved content',
    savedContent: 'Original content',
    expectedSavedContent: 'Original content',
    encoding: 'utf-8',
    lineEnding: 'LF',
    mode: 'sv',
    updatedAt: Date.now(),
  });
  let restored: ElectronApplication | null = null;
  try {
    restored = await electron.launch({
      args: ['.'],
      cwd: projectRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        VDITOR_DESKTOP_CONFIG_DIR: configDir,
        VDITOR_DESKTOP_DATA_DIR: path.join(testRoot, 'chromium'),
      },
    });
    const page = await restored.firstWindow();
    await page.waitForSelector('#appMenuBar[data-ready="true"]');

    await expect(page.locator('.document-tab')).toHaveCount(1);
    await expect(page.locator('.editor-host.active .vditor-sv')).toContainText(
      'Recovered unsaved content',
    );
    await expect(page.locator('#recoveryBanner')).toBeVisible();
  } finally {
    if (restored) restored.process().kill('SIGKILL');
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('prevents direct overwrite when a recovered document conflicts with disk', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-recovery-conflict-e2e-'));
  const configDir = path.join(testRoot, 'config');
  const filePath = path.join(testRoot, 'recovery target.md');
  fs.mkdirSync(configDir);
  fs.writeFileSync(filePath, 'Current disk content');
  new SettingsStore(configDir).update({
    locale: 'en_US',
    systemTheme: false,
    editMode: 'sv',
    autoSave: false,
    restoreTabs: false,
    restoreWorkspace: false,
  });
  const recoveryStore = new RecoveryStore(path.join(testRoot, 'recovery'));
  await recoveryStore.save({
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    id: '9e44b135-20bf-4e1c-9981-b169657868b4',
    filePath,
    title: 'recovery target.md',
    content: 'Recovered after crash',
    savedContent: 'Original disk content',
    encoding: 'utf-8',
    lineEnding: 'LF',
    mode: 'sv',
    updatedAt: Date.now(),
  });
  let restored: ElectronApplication | null = null;
  try {
    restored = await electron.launch({
      args: ['.'],
      cwd: projectRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        VDITOR_DESKTOP_CONFIG_DIR: configDir,
        VDITOR_DESKTOP_DATA_DIR: path.join(testRoot, 'chromium'),
      },
    });
    const restoredPage = await restored.firstWindow();
    await restoredPage.waitForSelector('#appMenuBar[data-ready="true"]');
    await expect(restoredPage.locator('.editor-host.active .vditor-sv')).toContainText(
      'Recovered after crash',
    );
    await expect(restoredPage.locator('#recoveryBanner')).toBeVisible();
    await expect(restoredPage.locator('#recoveryMessage')).toHaveText(
      'Recovered unsaved changes, but the original file was modified after the interruption.',
    );
    await expect(restoredPage.locator('#recoveryDetail')).toHaveText(
      'To avoid overwriting the newer disk version, save the recovered content to another location.',
    );
    await expect(restoredPage.locator('#recoverySave')).toBeHidden();
    await expect(restoredPage.locator('#recoverySaveAs')).toBeVisible();
    await expect(restoredPage.locator('#recoveryDiscard')).toBeVisible();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('Current disk content');
  } finally {
    if (restored) {
      restored.process().kill('SIGKILL');
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
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
    await expect(running.page.locator('#workspaceHeading .workspace-heading-icon')).toBeVisible();
    const workspaceHeading = running.page.locator('#workspaceHeading');
    const refreshTree = running.page.locator('#refreshTree');
    await expect(workspaceHeading).toHaveAttribute('data-tooltip', workspace);
    await workspaceHeading.hover();
    await expect(running.page.locator('#appTooltip')).toHaveText(workspace);
    await expect(refreshTree).toBeVisible();
    await expect(refreshTree.locator('.refresh-tree-icon')).toBeVisible();
    await expect(refreshTree).toHaveAttribute('data-tooltip', 'Refresh');
    await refreshTree.hover();
    await expect(running.page.locator('#appTooltip')).toHaveText('Refresh');
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
    await expect(topFile.locator('.tree-name')).toHaveAttribute('data-tooltip', longFileName);
    await expect(topFile.locator('.tree-name')).not.toHaveAttribute('title');
    await topFile.locator('.tree-name').hover();
    await expect(running.page.locator('#appTooltip')).toBeVisible();
    await expect(running.page.locator('#appTooltip')).toHaveText(longFileName);
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

test('places explorer creation actions on blank tree space', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-tree-create-'));
  const directory = path.join(workspace, 'notes');
  const filePath = path.join(workspace, 'README.md');
  const openFilePath = path.join(directory, 'Untitled 2.md');
  const existingFilePath = path.join(workspace, 'Untitled 1.md');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'inside.md'), '# Inside');
  fs.writeFileSync(filePath, '# Read me');
  fs.writeFileSync(openFilePath, '# Open');
  fs.writeFileSync(existingFilePath, '# Existing');
  fs.mkdirSync(path.join(directory, 'Untitled 1'));
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: openFilePath, openFiles: [openFilePath] },
  });
  try {
    const { page } = running;
    const contextMenu = page.locator('#contextMenu');
    const newFile = contextMenu.locator('button', { hasText: 'New File' });
    const newFolder = contextMenu.locator('button', { hasText: 'New Folder' });
    const file = page.locator(`#fileTree > .tree-file[data-path="${filePath}"]`);
    const directoryRow = page.locator(`#fileTree > .tree-dir[data-path="${directory}"]`);

    await file.click({ button: 'right' });
    await expect(contextMenu).toBeVisible();
    await expect(newFile).toHaveCount(0);
    await expect(newFolder).toHaveCount(0);
    await page.keyboard.press('Escape');

    await directoryRow.click({ button: 'right' });
    await expect(contextMenu).toBeVisible();
    await expect(newFile).toHaveCount(0);
    await expect(newFolder).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.locator('#fileTree').dispatchEvent('contextmenu', {
      button: 2,
      clientX: 120,
      clientY: 500,
    });
    await newFile.click();
    const createdFile = path.join(workspace, 'Untitled 3.md');
    await expect.poll(() => fs.existsSync(createdFile)).toBe(true);
    await expect(page.locator(`#fileTree .tree-file[data-path="${createdFile}"]`)).toBeVisible();
    await expect(page.locator('.document-tab.active > span')).toHaveText('Untitled 3.md');
    await expect(page.locator('#confirmModal')).toBeHidden();
    await page.locator('.editor-host.active .vditor-sv').fill('Created content');
    await page.keyboard.press('Control+S');
    await expect.poll(() => fs.readFileSync(createdFile, 'utf8').trimEnd()).toBe('Created content');

    await page.locator('#fileTree').dispatchEvent('contextmenu', {
      button: 2,
      clientX: 120,
      clientY: 500,
    });
    await expect(newFile).toBeVisible();
    await expect(newFolder).toBeVisible();
    await newFolder.click();
    const createdFolder = path.join(workspace, 'Untitled 1');
    await expect.poll(() => fs.existsSync(createdFolder)).toBe(true);
    await expect(page.locator('#confirmModal')).toBeHidden();

    await page.locator('#fileTree').dispatchEvent('contextmenu', {
      button: 2,
      clientX: 120,
      clientY: 500,
    });
    await newFile.click();
    const secondFile = path.join(workspace, 'Untitled 4.md');
    await expect.poll(() => fs.existsSync(secondFile)).toBe(true);
    await expect(page.locator('.document-tab.active > span')).toHaveText('Untitled 4.md');
    await expect(page.locator('#confirmModal')).toBeHidden();

    await page.locator('#fileTree').dispatchEvent('contextmenu', {
      button: 2,
      clientX: 120,
      clientY: 500,
    });
    await newFolder.click();
    const secondFolder = path.join(workspace, 'Untitled 2');
    await expect.poll(() => fs.existsSync(secondFolder)).toBe(true);
    await expect(page.locator('#confirmModal')).toBeHidden();

    await directoryRow.click();
    const directoryChildren = page.locator(
      `#fileTree > .tree-children[data-parent-path="${directory}"]`,
    );
    await expect(
      directoryChildren.locator('.tree-file').filter({ hasText: /^inside\.md$/ }),
    ).toBeVisible();
    await directoryChildren.dispatchEvent('contextmenu', {
      button: 2,
      clientX: 120,
      clientY: 500,
    });
    await newFolder.click();
    const nestedFolderPath = path.join(directory, 'Untitled 3');
    await expect.poll(() => fs.existsSync(nestedFolderPath)).toBe(true);
    await expect(page.locator('#confirmModal')).toBeHidden();
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('shows the move-to-trash confirmation as a draggable in-window dialog', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-trash-dialog-'));
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Read me');
  const running = await launchApp({
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: null, openFiles: [] },
  });
  try {
    const { page } = running;
    const file = page.locator('#fileTree > .tree-file').filter({ hasText: 'README.md' });
    await file.click({ button: 'right' });
    await page.locator('#contextMenu button', { hasText: 'Move to Trash' }).click();

    const dialog = page.locator('#confirmModal');
    const card = dialog.locator('.confirm-card');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#confirmMessage')).toHaveText('Move “README.md” to Trash?');
    await expect(card).toHaveClass(/confirm-card-draggable/);

    const dialogBox = await dialog.boundingBox();
    const initialCardBox = await card.boundingBox();
    const headerBox = await card.locator(':scope > header').boundingBox();
    if (!dialogBox || !initialCardBox || !headerBox)
      throw new Error('Move-to-trash dialog has incomplete drag chrome');
    await page.mouse.move(headerBox.x + 40, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + 90, headerBox.y + 60, { steps: 5 });
    await page.mouse.up();
    const movedCardBox = await card.boundingBox();
    if (!movedCardBox) throw new Error('Move-to-trash dialog card disappeared while dragging');
    expect(movedCardBox.x).toBeGreaterThan(initialCardBox.x + 20);
    expect(movedCardBox.y).toBeGreaterThan(initialCardBox.y + 20);

    await dialog.locator('#confirmActions [data-action="cancel"]').click();
    await expect(dialog).toBeHidden();
    expect(fs.existsSync(path.join(workspace, 'README.md'))).toBe(true);
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('keeps open descendant paths, resources, recents, and watchers aligned after directory rename', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-rename-directory-'));
  const oldDirectory = path.join(workspace, 'notes');
  const imageDirectory = path.join(workspace, 'assets');
  const filePath = path.join(oldDirectory, 'entry.md');
  const imagePath = path.join(imageDirectory, 'pixel.png');
  fs.mkdirSync(oldDirectory);
  fs.mkdirSync(imageDirectory);
  fs.writeFileSync(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  fs.writeFileSync(filePath, '![pixel](../assets/pixel.png)\n\nOriginal');
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { page, testRoot } = running;
    const oldDirectoryRow = page.locator(`#fileTree .tree-dir[data-path="${oldDirectory}"]`);
    await expect(oldDirectoryRow).toBeVisible();
    await oldDirectoryRow.click();
    await expect(page.locator(`#fileTree .tree-file[data-path="${filePath}"]`)).toBeVisible();
    await expect(page.locator('#statusPath')).toHaveText(filePath);
    await expect(page.locator('.editor-host.active img')).toBeVisible();

    await oldDirectoryRow.click({ button: 'right' });
    await page.locator('#contextMenu button', { hasText: 'Rename' }).click();
    const renameInput = oldDirectoryRow.locator('.tree-rename-input');
    await renameInput.fill('renamed');
    await renameInput.press('Enter');

    const newDirectory = path.join(workspace, 'renamed');
    const newFilePath = path.join(newDirectory, 'entry.md');
    await expect(page.locator(`#fileTree .tree-dir[data-path="${newDirectory}"]`)).toBeVisible();
    await expect(page.locator('#statusPath')).toHaveText(newFilePath);
    await expect(page.locator('.editor-host.active img')).toBeVisible();
    await page.locator('.editor-host.active .vditor-sv').fill('Saved after directory rename');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => fs.readFileSync(newFilePath, 'utf8').trimEnd())
      .toBe('Saved after directory rename');
    expect(fs.existsSync(filePath)).toBe(false);
    await expect
      .poll(() => (readSetting(testRoot, 'files', 'recentFiles') as unknown[] | undefined) || [])
      .toContainEqual(expect.objectContaining({ path: newFilePath, title: 'entry.md' }));
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('saves trusted tab content while the rebuilt editor is not ready', async () => {
  const running = await launchApp(
    { editMode: 'sv' },
    { 'editor-not-ready.md': 'Original content' },
  );
  try {
    const { page, testRoot } = running;
    const filePath = path.join(testRoot, 'editor-not-ready.md');
    const editor = page.locator('.editor-host.active .vditor-sv');
    await editor.fill('Trusted content before rebuild');
    await expect(page.locator('.document-tab.active .dirty')).toHaveText('●');

    await delayVditorAfter(page);

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page.locator('.app-menu-popup button.has-submenu', { hasText: 'Editing Mode' }).hover();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'WYSIWYG' }).click();
    await expect(page.locator('.editor-host.active')).toHaveAttribute(
      'data-editor-ready',
      'false',
      {
        timeout: 100,
      },
    );
    await page.keyboard.press('Control+s');

    await expect
      .poll(() => fs.readFileSync(filePath, 'utf8').trimEnd())
      .toBe('Trusted content before rebuild');
    await expect(page.locator('.document-tab.active .dirty')).toBeHidden();
    await expect(page.locator('.editor-host.active')).toHaveAttribute('data-editor-ready', 'true', {
      timeout: 3000,
    });
    await expect(page.locator('.editor-host.active .vditor-wysiwyg')).toBeVisible();
  } finally {
    await closeApp(running);
  }
});

test('keeps the shared toolbar out of the editor while a rebuilt editor is not ready', async () => {
  const running = await launchApp(
    { editMode: 'sv' },
    { 'toolbar-not-ready.md': 'Original content' },
  );
  try {
    const { page } = running;
    await delayVditorAfter(page);
    const geometry = () =>
      page.evaluate(() => {
        const mount = document.querySelector('#vditorToolbarMount');
        const editor = document.querySelector('#editorArea');
        if (!(mount instanceof HTMLElement) || !(editor instanceof HTMLElement))
          throw new Error('Toolbar layout is unavailable.');
        const mountBox = mount.getBoundingClientRect();
        const editorBox = editor.getBoundingClientRect();
        return {
          mountHeight: mountBox.height,
          mountTop: mountBox.top,
          editorHeight: editorBox.height,
          editorTop: editorBox.top,
        };
      });
    const before = await geometry();

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page.locator('.app-menu-popup button.has-submenu', { hasText: 'Editing Mode' }).hover();
    await page.locator('.app-menu-popup.submenu button', { hasText: 'WYSIWYG' }).click();

    const activeHost = page.locator('.editor-host.active');
    await expect(activeHost).toHaveAttribute('data-editor-ready', 'false', { timeout: 100 });
    const pendingToolbar = activeHost.locator(':scope > .vditor-toolbar');
    await expect(pendingToolbar).toHaveCount(1, { timeout: 500 });
    await expect(pendingToolbar).toBeHidden();
    await expect(pendingToolbar).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('#vditorToolbarMount > .vditor-toolbar')).toHaveCount(0);
    await expect(page.locator('#app')).toHaveClass(/toolbar-unavailable/);
    await expect(page.locator('#vditorToolbarMount')).toBeVisible();
    await expect(page.locator('#vditorToolbarMount')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#toolbarSkeleton')).toBeVisible();
    await expect(page.locator('#toolbarSkeleton button, #toolbarSkeleton [tabindex]')).toHaveCount(
      0,
    );
    await expect(page.locator('header.titlebar')).toHaveCSS('position', 'relative');
    const pending = await geometry();
    expect(pending.mountTop).toBeCloseTo(before.mountTop, 0);
    expect(pending.mountHeight).toBeCloseTo(before.mountHeight, 0);
    expect(pending.editorTop).toBeCloseTo(before.editorTop, 0);
    expect(pending.editorHeight).toBeCloseTo(before.editorHeight, 0);

    const sharedToolbar = page.locator('#vditorToolbarMount > .vditor-toolbar');
    await expect(sharedToolbar).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#app')).not.toHaveClass(/toolbar-unavailable/);
    await expect(page.locator('#vditorToolbarMount')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#vditorToolbarMount')).toBeVisible();
    await expect(page.locator('#toolbarSkeleton')).toBeHidden();
    await expect(activeHost.locator(':scope > .vditor-toolbar')).toHaveCount(0);
    await expect(activeHost.locator('.vditor-wysiwyg')).toBeVisible();
    const after = await geometry();
    expect(after.mountTop).toBeCloseTo(before.mountTop, 0);
    expect(after.mountHeight).toBeCloseTo(before.mountHeight, 0);
    expect(after.editorTop).toBeCloseTo(before.editorTop, 0);
    expect(after.editorHeight).toBeCloseTo(before.editorHeight, 0);
  } finally {
    await closeApp(running);
  }
});

test('reconciles a renamed document after repeated watcher rebind failures', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-rename-watcher-failure-'));
  const oldDirectory = path.join(workspace, 'notes');
  const filePath = path.join(oldDirectory, 'entry.md');
  fs.mkdirSync(oldDirectory);
  fs.writeFileSync(filePath, 'Original content');
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { app, page, testRoot } = running;
    await app.evaluate(() => {
      process.env.VDITOR_DESKTOP_TEST_FAIL_DOCUMENT_WATCHES = '3';
    });
    const oldDirectoryRow = page.locator(`#fileTree .tree-dir[data-path="${oldDirectory}"]`);
    await oldDirectoryRow.click({ button: 'right' });
    await page.locator('#contextMenu button', { hasText: 'Rename' }).click();
    await oldDirectoryRow.locator('.tree-rename-input').fill('renamed');
    await oldDirectoryRow.locator('.tree-rename-input').press('Enter');

    const newDirectory = path.join(workspace, 'renamed');
    const newFilePath = path.join(newDirectory, 'entry.md');
    await expect(page.locator(`#fileTree .tree-dir[data-path="${newDirectory}"]`)).toBeVisible();
    await expect(page.locator('#statusPath')).toHaveText(newFilePath);
    await expect(page.locator('#statusMessage')).toContainText(
      'Unable to restore 1 document watcher(s).',
    );
    const resourceBase = formatLocalResourceBase(newDirectory);
    await expect(page.locator('.editor-host.active')).toHaveAttribute(
      'data-local-resource-base',
      resourceBase,
    );
    await expect.poll(() => readSetting(testRoot, 'session', 'openFiles')).toEqual([newFilePath]);

    fs.writeFileSync(newFilePath, 'Watcher recovered after rename');
    await expect(page.locator('.editor-host.active .vditor-sv')).toContainText(
      'Watcher recovered after rename',
      { timeout: 5000 },
    );
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('keeps renamed document state coherent when settings persistence fails once', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-rename-settings-failure-'));
  const oldDirectory = path.join(workspace, 'notes');
  const filePath = path.join(oldDirectory, 'entry.md');
  fs.mkdirSync(oldDirectory);
  fs.writeFileSync(filePath, 'Original content');
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { app, page, testRoot } = running;
    const configPath = path.join(testRoot, 'config', 'config.toml');
    await app.evaluate((_, targetPath) => {
      const nodeFs = process.getBuiltinModule('node:fs');
      const nodePath = process.getBuiltinModule('node:path');
      const originalRename = nodeFs.renameSync.bind(nodeFs);
      let remaining = 1;
      nodeFs.renameSync = (oldPath, newPath) => {
        const matches = nodePath.resolve(String(newPath)) === nodePath.resolve(targetPath);
        if (remaining > 0 && matches) {
          remaining--;
          throw new Error('Injected settings persistence failure.');
        }
        return originalRename(oldPath, newPath);
      };
    }, configPath);

    const oldDirectoryRow = page.locator(`#fileTree .tree-dir[data-path="${oldDirectory}"]`);
    await oldDirectoryRow.click({ button: 'right' });
    await page.locator('#contextMenu button', { hasText: 'Rename' }).click();
    await oldDirectoryRow.locator('.tree-rename-input').fill('renamed');
    await oldDirectoryRow.locator('.tree-rename-input').press('Enter');

    const newDirectory = path.join(workspace, 'renamed');
    const newFilePath = path.join(newDirectory, 'entry.md');
    await expect(page.locator('#statusPath')).toHaveText(newFilePath);
    await expect(page.locator('#statusMessage')).toHaveText('Settings could not be saved.');
    await expect.poll(() => readSetting(testRoot, 'session', 'openFiles')).toEqual([newFilePath]);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readFileSync(newFilePath, 'utf8')).toBe('Original content');

    fs.writeFileSync(newFilePath, 'Watcher remains aligned');
    await expect(page.locator('.editor-host.active .vditor-sv')).toContainText(
      'Watcher remains aligned',
      { timeout: 5000 },
    );
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('keeps renamed document state coherent when editor rebuild fails repeatedly', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-rename-editor-failure-'));
  const oldDirectory = path.join(workspace, 'notes');
  const filePath = path.join(oldDirectory, 'entry.md');
  fs.mkdirSync(oldDirectory);
  fs.writeFileSync(filePath, 'Original content');
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { page, testRoot } = running;
    await page.evaluate(() => {
      type VditorConstructor = {
        prototype: {
          destroy: (this: object, ...args: unknown[]) => unknown;
        };
      };
      const constructor = (window as unknown as { Vditor?: VditorConstructor }).Vditor;
      if (!constructor) throw new Error('Vditor constructor is unavailable.');
      const originalDestroy = constructor.prototype.destroy;
      let remaining = 2;
      constructor.prototype.destroy = function (this: object, ...args: unknown[]) {
        if (remaining > 0) {
          remaining--;
          throw new Error('Injected editor rebuild failure.');
        }
        return originalDestroy.apply(this, args);
      };
    });

    const oldDirectoryRow = page.locator(`#fileTree .tree-dir[data-path="${oldDirectory}"]`);
    await oldDirectoryRow.click({ button: 'right' });
    await page.locator('#contextMenu button', { hasText: 'Rename' }).click();
    await oldDirectoryRow.locator('.tree-rename-input').fill('renamed');
    await oldDirectoryRow.locator('.tree-rename-input').press('Enter');

    const newDirectory = path.join(workspace, 'renamed');
    const newFilePath = path.join(newDirectory, 'entry.md');
    await expect(page.locator('#statusPath')).toHaveText(newFilePath);
    await expect(page.locator('#statusMessage')).toContainText(
      'Unable to rebuild every renamed document.',
    );
    const resourceBase = formatLocalResourceBase(newDirectory);
    await expect(page.locator('.editor-host.active')).toHaveAttribute(
      'data-local-resource-base',
      resourceBase,
    );
    await expect.poll(() => readSetting(testRoot, 'session', 'openFiles')).toEqual([newFilePath]);

    fs.writeFileSync(newFilePath, 'Watcher remains aligned');
    await expect(page.locator('.editor-host.active .vditor-sv')).toContainText(
      'Watcher remains aligned',
      { timeout: 5000 },
    );
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('refuses to rename a workspace item onto an existing destination', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-rename-conflict-'));
  const source = path.join(workspace, 'source.md');
  const destination = path.join(workspace, 'destination.md');
  fs.writeFileSync(source, 'Source content');
  fs.writeFileSync(destination, 'Destination content');
  const running = await launchApp({
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: source, openFiles: [source] },
  });
  try {
    const { page } = running;
    const sourceRow = page.locator(`#fileTree .tree-file[data-path="${source}"]`);
    await sourceRow.click({ button: 'right' });
    await page.locator('#contextMenu button', { hasText: 'Rename' }).click();
    const renameInput = sourceRow.locator('.tree-rename-input');
    await renameInput.fill('destination.md');
    await renameInput.press('Enter');

    await expect(sourceRow).toBeVisible();
    await expect(page.locator('#statusMessage')).toHaveText(
      'An item with that name already exists.',
    );
    expect(fs.readFileSync(source, 'utf8')).toBe('Source content');
    expect(fs.readFileSync(destination, 'utf8')).toBe('Destination content');
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('refuses Save As when the chosen destination is already open in another tab', async () => {
  const running = await launchApp(
    { editMode: 'sv' },
    { 'source.md': 'Source content', 'destination.md': 'Destination content' },
  );
  try {
    const { app, page, testRoot } = running;
    const source = path.join(testRoot, 'source.md');
    const destination = path.join(testRoot, 'destination.md');
    await page.locator('.document-tab').filter({ hasText: 'source.md' }).click();
    await page.locator('.editor-host.active .vditor-sv').fill('Unsaved source content');
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, destination);

    await page.keyboard.press('Control+Shift+S');

    await expect(page.locator('#statusPath')).toHaveText(source);
    expect(fs.readFileSync(destination, 'utf8')).toBe('Destination content');
    await expect(page.locator('.editor-host.active .vditor-sv')).toContainText(
      'Unsaved source content',
    );
  } finally {
    await closeApp(running);
  }
});

test('rebinds local image resources to the Save As destination and revokes the old root', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-save-as-resource-'));
  const workspace = path.join(fixture, 'workspace');
  const sourceDirectory = path.join(fixture, 'source-document');
  const destinationDirectory = path.join(fixture, 'save-as-target');
  const sourcePath = path.join(sourceDirectory, 'source.md');
  const destinationPath = path.join(destinationDirectory, 'copy.md');
  const markdown = '![pixel](assets/pixel.png)\n\nSave As resource root';
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(sourceDirectory, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(destinationDirectory, 'assets'), { recursive: true });
  fs.writeFileSync(sourcePath, markdown);
  fs.writeFileSync(path.join(sourceDirectory, 'assets', 'pixel.png'), pixel);
  fs.writeFileSync(path.join(destinationDirectory, 'assets', 'pixel.png'), pixel);

  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    session: { workspacePath: workspace, activeFilePath: sourcePath, openFiles: [sourcePath] },
  });
  try {
    const { app, page } = running;
    const image = page.locator('.editor-host.active .vditor-preview img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
    const oldImageUrl = await image.getAttribute('src');
    if (!oldImageUrl) throw new Error('The source image URL is unavailable.');

    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, destinationPath);
    const modifier =
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+Shift+S`);

    await expect(page.locator('#statusPath')).toHaveText(destinationPath);
    await expect.poll(() => fs.readFileSync(destinationPath, 'utf8').trimEnd()).toBe(markdown);
    const resourceBase = await page
      .locator('.editor-host.active')
      .getAttribute('data-local-resource-base');
    if (!resourceBase) throw new Error('The Save As resource base is unavailable.');
    expect(resourceBase).toBe(formatLocalResourceBase(destinationDirectory));

    const destinationImage = page.locator('.editor-host.active .vditor-preview img');
    await expect(destinationImage).toBeVisible();
    await expect
      .poll(() => destinationImage.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBe(1);
    const newImageUrl = await destinationImage.getAttribute('src');
    if (!newImageUrl) throw new Error('The destination image URL is unavailable.');
    expect(newImageUrl).toBe(new URL('assets/pixel.png', resourceBase).href);

    const inspect = async (url: string) =>
      page.evaluate(async (resourceUrl) => {
        const response = await fetch(resourceUrl, { cache: 'no-store' });
        return {
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
          contentType: response.headers.get('content-type'),
          noSniff: response.headers.get('x-content-type-options'),
          bodyLength: (await response.arrayBuffer()).byteLength,
        };
      }, url);
    expect(await inspect(oldImageUrl)).toEqual({
      status: 404,
      cacheControl: 'no-store',
      contentType: 'text/plain; charset=utf-8',
      noSniff: 'nosniff',
      bodyLength: 'Not found'.length,
    });
    expect(await inspect(newImageUrl)).toEqual({
      status: 200,
      cacheControl: 'no-store',
      contentType: 'image/png',
      noSniff: 'nosniff',
      bodyLength: pixel.length,
    });
  } finally {
    await closeApp(running);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('serializes concurrent Save As requests through alias paths for the same missing file', async () => {
  test.skip(process.platform === 'win32', 'This regression uses a POSIX directory symlink.');
  const running = await launchApp(
    { editMode: 'sv' },
    { 'source-a.md': 'Source A', 'source-b.md': 'Source B' },
  );
  try {
    const { app, page, testRoot } = running;
    const targetDirectory = path.join(testRoot, 'target');
    const aliasDirectory = path.join(testRoot, 'target-alias');
    const target = path.join(targetDirectory, 'shared.md');
    fs.mkdirSync(targetDirectory);
    fs.symlinkSync(targetDirectory, aliasDirectory, 'dir');
    await app.evaluate(
      ({ dialog }, paths) => {
        let invocation = 0;
        dialog.showSaveDialog = async () => {
          const index = invocation++;
          await new Promise((resolve) => setTimeout(resolve, 80 + index * 40));
          return { canceled: false, filePath: paths[index] };
        };
      },
      [path.join(aliasDirectory, 'shared.md'), target],
    );

    const sourceA = page.locator('.document-tab').filter({ hasText: 'source-a.md' });
    const sourceB = page.locator('.document-tab').filter({ hasText: 'source-b.md' });
    await sourceA.click();
    await page.locator('.editor-host.active .vditor-sv').fill('Local A');
    await sourceB.click();
    await page.locator('.editor-host.active .vditor-sv').fill('Local B');
    await sourceA.click();
    await page.keyboard.press('Control+Shift+S');
    await sourceB.click();
    await page.keyboard.press('Control+Shift+S');

    await expect.poll(() => fs.existsSync(target)).toBe(true);
    await expect.poll(() => fs.readFileSync(target, 'utf8').trimEnd()).toBe('Local A');
    await expect(page.locator('#statusPath')).toHaveText(path.join(testRoot, 'source-b.md'));
    await expect(page.locator('.document-tab.active .dirty')).toHaveText('●');
    await expect(page.locator('#statusMessage')).toHaveText(
      'shared.md is already open in another tab.',
    );
  } finally {
    await closeApp(running);
  }
});

test('keeps external conflict protection when Save As selects a symlink alias', async () => {
  test.skip(process.platform === 'win32', 'This regression uses a POSIX file symlink.');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-external-alias-'));
  const target = path.join(workspace, 'document.md');
  const alias = path.join(workspace, 'document-alias.md');
  fs.writeFileSync(target, 'Original content');
  fs.symlinkSync(target, alias);
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    session: {
      workspacePath: workspace,
      activeFilePath: target,
      openFiles: [target],
    },
  });
  try {
    const { app, page } = running;
    const editor = page.locator('.editor-host.active .vditor-sv');
    await expect(editor).toContainText('Original content');
    await editor.fill('Local content');
    fs.writeFileSync(target, 'External content');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();

    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, alias);
    await page.keyboard.press('Control+Shift+S');

    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await expect(page.locator('#statusPath')).toHaveText(target);
    expect(fs.readFileSync(target, 'utf8')).toBe('External content');
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('preserves open descendant documents when an application directory is deleted', async () => {
  fs.mkdirSync(path.join(projectRoot, 'tmp'), { recursive: true });
  const workspace = fs.mkdtempSync(path.join(projectRoot, 'tmp', 'vditor-delete-directory-'));
  const directory = path.join(workspace, 'notes');
  const filePath = path.join(directory, 'entry.md');
  fs.mkdirSync(directory);
  fs.writeFileSync(filePath, 'Original content');
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { page } = running;
    await page.locator('.editor-host.active .vditor-sv').fill('Unsaved content');
    await expect(
      page.evaluate(
        ({ directoryPath, documentPath }) =>
          window.fileAPI.rebasePath(directoryPath, directoryPath, documentPath),
        { directoryPath: directory, documentPath: filePath },
      ),
    ).resolves.toBe(filePath);
    const directoryRow = page.locator(`#fileTree .tree-dir[data-path="${directory}"]`);
    await directoryRow.click({ button: 'right' });
    await page.locator('#contextMenu button', { hasText: 'Move to Trash' }).click();
    await page.locator('#confirmActions [data-action="confirm"]').click();

    await expect(page.locator('.document-tab.active > span')).toHaveText('entry.md');
    await expect(page.locator('#externalFileStateBanner')).toBeVisible();
    await expect(page.locator('.editor-host.active .vditor-sv')).toContainText('Unsaved content');
    await expect.poll(() => fs.existsSync(filePath)).toBe(false);
    await expect.poll(() => fs.readdirSync(path.join(running.testRoot, 'recovery')).length).toBe(1);
  } finally {
    if (
      await running.page
        .locator('#externalFileClose')
        .isVisible()
        .catch(() => false)
    )
      await running.page.locator('#externalFileClose').click();
    if (
      await running.page
        .locator('#confirmModal')
        .isVisible()
        .catch(() => false)
    )
      await running.page.locator('#confirmActions [data-action="confirm"]').click();
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('clears a workspace after its root is deleted externally', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-root-delete-'));
  fs.writeFileSync(path.join(workspace, 'note.md'), 'Note');
  const running = await launchApp({
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: null, openFiles: [] },
  });
  try {
    const { page } = running;
    await expect(page.locator('#workspaceHeading')).toHaveAttribute('data-tooltip', workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
    await expect(page.locator('#workspaceName')).toHaveText('No workspace opened', {
      timeout: 5000,
    });
    await expect.poll(() => readSetting(running.testRoot, 'session', 'workspacePath')).toBe('');
    await expect.poll(() => readSetting(running.testRoot, 'files', 'defaultOpenPath')).toBe('');
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('preserves opened clean documents when a workspace subdirectory is deleted externally', async () => {
  for (const autoSave of [false, true]) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-subdirectory-'));
    const deletedDirectory = path.join(workspace, 'workspace-root-delete');
    const filePath = path.join(deletedDirectory, 'root-note.md');
    fs.mkdirSync(deletedDirectory);
    fs.writeFileSync(filePath, 'Opened content');
    const running = await launchApp({
      autoSave,
      editMode: 'sv',
      restoreTabs: true,
      restoreWorkspace: true,
      sidebarVisible: true,
      session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
    });
    let restored: ElectronApplication | null = null;
    try {
      const { app, page, testRoot } = running;
      await expect(page.locator('#workspaceHeading')).toHaveAttribute('data-tooltip', workspace);
      await expect(page.locator('.document-tab.active > span')).toHaveText('root-note.md');
      fs.rmSync(deletedDirectory, { recursive: true, force: true });

      await expect(page.locator('#externalFileStateBanner')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#externalFileStateMessage')).toContainText('root-note.md');
      await expect(page.locator('#workspaceHeading')).toHaveAttribute('data-tooltip', workspace);
      await expect(page.locator('.editor-host.active .vditor-sv')).toContainText('Opened content');
      await expect.poll(() => fs.readdirSync(path.join(testRoot, 'recovery')).length).toBe(1);
      await expect
        .poll(() => {
          const [snapshot] = fs.readdirSync(path.join(testRoot, 'recovery'));
          return JSON.parse(
            fs.readFileSync(path.join(testRoot, 'recovery', snapshot), 'utf8'),
          ).content.trimEnd();
        })
        .toBe('Opened content');

      const closed = app.waitForEvent('close');
      app.process().kill('SIGKILL');
      await closed;
      restored = await electron.launch({
        args: ['.'],
        cwd: projectRoot,
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          VDITOR_DESKTOP_CONFIG_DIR: path.join(testRoot, 'config'),
          VDITOR_DESKTOP_DATA_DIR: path.join(testRoot, 'chromium'),
        },
      });
      const restoredPage = await restored.firstWindow();
      await restoredPage.waitForSelector('#appMenuBar[data-ready="true"]');
      await expect(restoredPage.locator('#workspaceHeading')).toHaveAttribute(
        'data-tooltip',
        workspace,
      );
      await expect(restoredPage.locator('.document-tab.active > span')).toHaveText(
        'Recovered root-note.md',
      );
      await expect(restoredPage.locator('.editor-host.active .vditor-sv')).toContainText(
        'Opened content',
      );
      await expect(restoredPage.locator('#recoveryBanner')).toBeVisible();
      await expect(restoredPage.locator('#recoverySave')).toBeHidden();
      await expect(restoredPage.locator('#recoverySaveAs')).toBeVisible();
    } finally {
      if (restored) restored.process().kill('SIGKILL');
      else if (!running.page.isClosed()) running.app.process().kill('SIGKILL');
      fs.rmSync(running.testRoot, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test('preserves opened clean documents after their workspace roots are deleted externally', async () => {
  for (const autoSave of [false, true]) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-recovery-'));
    const filePath = path.join(workspace, 'root-note.md');
    fs.writeFileSync(filePath, 'Opened content');
    const running = await launchApp({
      autoSave,
      editMode: 'sv',
      restoreTabs: true,
      restoreWorkspace: true,
      sidebarVisible: true,
      session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
    });
    let restored: ElectronApplication | null = null;
    try {
      const { app, page, testRoot } = running;
      await expect(page.locator('.document-tab.active > span')).toHaveText('root-note.md');
      fs.rmSync(workspace, { recursive: true, force: true });

      await expect(page.locator('#externalFileStateBanner')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#externalFileStateMessage')).toContainText('root-note.md');
      await expect(page.locator('.editor-host.active .vditor-sv')).toContainText('Opened content');
      await expect.poll(() => fs.readdirSync(path.join(testRoot, 'recovery')).length).toBe(1);
      await expect
        .poll(() => {
          const [snapshot] = fs.readdirSync(path.join(testRoot, 'recovery'));
          return JSON.parse(
            fs.readFileSync(path.join(testRoot, 'recovery', snapshot), 'utf8'),
          ).content.trimEnd();
        })
        .toBe('Opened content');
      await expect.poll(() => readSetting(testRoot, 'session', 'workspacePath')).toBe('');

      const closed = app.waitForEvent('close');
      app.process().kill('SIGKILL');
      await closed;
      restored = await electron.launch({
        args: ['.'],
        cwd: projectRoot,
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          VDITOR_DESKTOP_CONFIG_DIR: path.join(testRoot, 'config'),
          VDITOR_DESKTOP_DATA_DIR: path.join(testRoot, 'chromium'),
        },
      });
      const restoredPage = await restored.firstWindow();
      await restoredPage.waitForSelector('#appMenuBar[data-ready="true"]');
      await expect(restoredPage.locator('.document-tab.active > span')).toHaveText(
        'Recovered root-note.md',
      );
      await expect(restoredPage.locator('.editor-host.active .vditor-sv')).toContainText(
        'Opened content',
      );
      await expect(restoredPage.locator('#recoveryBanner')).toBeVisible();
      await expect(restoredPage.locator('#recoveryMessage')).toHaveText(
        'Recovered unsaved changes, but the original file no longer exists or cannot be read.',
      );
      await expect(restoredPage.locator('#recoverySave')).toBeHidden();
      await expect(restoredPage.locator('#recoverySaveAs')).toBeVisible();
    } finally {
      if (restored) restored.process().kill('SIGKILL');
      else if (!running.page.isClosed()) running.app.process().kill('SIGKILL');
      fs.rmSync(running.testRoot, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test('limits workspace tree reads to the selected directory depth and persists the setting', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-depth-'));
  const outsideWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-outside-'));
  const directories: string[] = [];
  let currentDirectory = workspace;
  for (let depth = 1; depth <= 8; depth++) {
    currentDirectory = path.join(currentDirectory, `level-${depth}`);
    directories.push(currentDirectory);
    fs.mkdirSync(currentDirectory);
  }
  fs.writeFileSync(path.join(directories[0], 'note-1.md'), '# Level 1');
  fs.writeFileSync(path.join(currentDirectory, 'deep.md'), '# Deep');
  const insideLink = path.join(workspace, 'inside-link');
  const outsideLink = path.join(workspace, 'outside-link');
  const cycleLink = path.join(workspace, 'cycle-link');
  fs.symlinkSync(directories[0], insideLink, 'dir');
  fs.symlinkSync(outsideWorkspace, outsideLink, 'dir');
  fs.symlinkSync(workspace, cycleLink, 'dir');
  const running = await launchApp({
    restoreWorkspace: true,
    sidebarVisible: true,
    workspaceReadDepth: 7,
    session: { workspacePath: workspace, activeFilePath: null, openFiles: [] },
  });
  try {
    const { page } = running;
    const internalLink = page.locator(`#fileTree .tree-dir[data-path="${insideLink}"]`);
    await expect(internalLink).toHaveClass(/tree-link/);
    await expect(internalLink.locator('.tree-name')).toHaveCSS('font-style', 'italic');
    await expect(internalLink.locator('.tree-name')).toHaveCSS('text-decoration-line', 'underline');
    await expect(internalLink.locator('.tree-entry-icon-folder-symlink')).toBeVisible();
    await internalLink.click();
    await expect(
      page.locator(`#fileTree .tree-dir[data-path="${insideLink}"] + .tree-children .tree-file`),
    ).toContainText('note-1.md');
    await expect(page.locator(`#fileTree .tree-dir[data-path="${outsideLink}"]`)).toHaveClass(
      /tree-link-outside/,
    );
    await expect(page.locator(`#fileTree .tree-dir[data-path="${cycleLink}"]`)).toHaveClass(
      /tree-link-cycle/,
    );
    await expect(
      page.locator('#fileTree .tree-depth-notice').filter({ hasText: 'outside the workspace' }),
    ).toBeVisible();
    for (const directory of directories.slice(0, 6)) {
      await page.locator(`#fileTree .tree-dir[data-path="${directory}"]`).click();
    }
    const limitedDirectory = page.locator(`#fileTree .tree-dir[data-path="${directories[6]}"]`);
    await expect(limitedDirectory).toHaveClass(/depth-limited/);
    const depthNotice = page
      .locator('#fileTree .tree-depth-notice')
      .filter({ hasText: 'Maximum workspace directory depth reached.' });
    await expect(depthNotice).toBeVisible();
    await expect(page.locator('#fileTree .tree-file').filter({ hasText: 'deep.md' })).toHaveCount(
      0,
    );

    await page.locator('#statusSettings').click();
    await page.locator('[name="locale"]').selectOption('zh_Hans');
    await expect(
      page
        .locator('#fileTree .tree-depth-notice')
        .filter({ hasText: '已达到工作区目录最大读取深度。' }),
    ).toBeVisible();
    await page.locator('.settings-nav [data-panel="files"]').click();
    const depthInput = page.locator('[name="workspaceReadDepth"]');
    await depthInput.fill('12');
    await expect(page.locator('#workspaceReadDepthValue')).toHaveText('12');
    await expect.poll(() => readSetting(running.testRoot, 'files', 'workspaceReadDepth')).toBe(12);
    await page.locator('#saveSettings').click();
    await expect(page.locator('#settingsModal')).toBeHidden();
    for (const directory of directories.slice(6)) {
      await page.locator(`#fileTree .tree-dir[data-path="${directory}"]`).click();
    }
    await expect(page.locator('#fileTree .tree-file').filter({ hasText: 'deep.md' })).toBeVisible();
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideWorkspace, { recursive: true, force: true });
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

test('opens a folder with the configured application shortcut', async () => {
  const running = await launchApp({ sidebarVisible: false });
  try {
    const { app, page, testRoot } = running;
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, testRoot);
    const modifier =
      (await page.evaluate(() => window.appAPI.platform)) === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+Alt+k`);
    await expect(page.locator('#workspaceName')).toHaveText(path.basename(testRoot));
    await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);
  } finally {
    await closeApp(running);
  }
});

test('uses one remembered directory for file and folder open dialogs', async () => {
  const initialDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-open-initial-'));
  const selectedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-open-selected-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-open-workspace-'));
  const selectedFile = path.join(selectedDirectory, 'opened.md');
  fs.writeFileSync(selectedFile, '# Opened');
  const running = await launchApp({
    defaultOpenPath: initialDirectory,
    sidebarVisible: true,
  });
  try {
    const { app, page, testRoot } = running;
    await app.evaluate(
      ({ dialog }, paths) => {
        let fileInvocation = 0;
        const calls: { defaultPath?: string; properties?: string[] }[] = [];
        dialog.showOpenDialog = async (_window, options) => {
          calls.push({ defaultPath: options.defaultPath, properties: options.properties });
          if (options.properties?.includes('openDirectory'))
            return { canceled: false, filePaths: [paths.workspace] };
          if (fileInvocation++ === 0) return { canceled: false, filePaths: [paths.file] };
          return { canceled: true, filePaths: [] };
        };
        (
          globalThis as typeof globalThis & { __vditorOpenDialogCalls?: unknown[] }
        ).__vditorOpenDialogCalls = calls;
      },
      { file: selectedFile, workspace },
    );

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Open File/ })
      .click();
    await expect(page.locator('#statusPath')).toHaveText(selectedFile);
    await expect
      .poll(() => readSetting(testRoot, 'files', 'defaultOpenPath'))
      .toBe(selectedDirectory);

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Open Folder/ })
      .click();
    await expect(page.locator('#workspaceName')).toHaveText(path.basename(workspace));
    await expect.poll(() => readSetting(testRoot, 'files', 'defaultOpenPath')).toBe(workspace);

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Open File/ })
      .click();
    await expect
      .poll(async () =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & { __vditorOpenDialogCalls?: unknown[] })
              .__vditorOpenDialogCalls?.length || 0,
        ),
      )
      .toBe(3);
    const calls = await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __vditorOpenDialogCalls?: { defaultPath?: string; properties?: string[] }[];
          }
        ).__vditorOpenDialogCalls,
    );
    expect(calls).toEqual([
      { defaultPath: initialDirectory, properties: ['openFile', 'multiSelections'] },
      { defaultPath: selectedDirectory, properties: ['openDirectory'] },
      { defaultPath: workspace, properties: ['openFile', 'multiSelections'] },
    ]);
  } finally {
    await closeApp(running);
    fs.rmSync(initialDirectory, { recursive: true, force: true });
    fs.rmSync(selectedDirectory, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('exports local images from the remembered directory without application-only resource URLs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-export-resources-'));
  const assetsDirectory = path.join(workspace, 'assets');
  const filePath = path.join(workspace, 'export.md');
  const exportDirectory = path.join(workspace, 'export-directory');
  const htmlPath = path.join(exportDirectory, 'exported.html');
  const pdfPath = path.join(exportDirectory, 'exported.pdf');
  fs.mkdirSync(assetsDirectory);
  fs.mkdirSync(exportDirectory);
  fs.writeFileSync(
    path.join(assetsDirectory, 'pixel.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  fs.writeFileSync(filePath, '![pixel](assets/pixel.png)\n\n# Export');
  const running = await launchApp({
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { app, page } = running;
    await expect(page.locator('.editor-host.active img')).toBeVisible();
    await app.evaluate(
      ({ dialog }, paths) => {
        let invocation = 0;
        const calls: { defaultPath?: string }[] = [];
        dialog.showSaveDialog = async (_window, options) => {
          calls.push({ defaultPath: options.defaultPath });
          return { canceled: false, filePath: paths[invocation++] };
        };
        (
          globalThis as typeof globalThis & {
            __vditorExportDialogCalls?: { defaultPath?: string }[];
          }
        ).__vditorExportDialogCalls = calls;
      },
      [htmlPath, pdfPath],
    );
    await app.evaluate(({ BrowserWindow }) => {
      const originalLoadURL = BrowserWindow.prototype.loadURL;
      BrowserWindow.prototype.loadURL = function (url, options) {
        const prefix = 'data:text/html;charset=utf-8,';
        if (url.startsWith(prefix))
          (globalThis as typeof globalThis & { __vditorPdfHtml?: string }).__vditorPdfHtml =
            decodeURIComponent(url.slice(prefix.length));
        return originalLoadURL.call(this, url, options);
      };
    });

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Export HTML/ })
      .click();
    await expect.poll(() => fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, 'utf8');
    expect(html).not.toContain('local-file://');
    expect(html).not.toContain('app://');
    expect(html).toContain('assets/pixel.png');

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Export PDF/ })
      .click();
    await expect.poll(() => fs.existsSync(pdfPath)).toBe(true);
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);
    const pdfHtml = await app.evaluate(
      () => (globalThis as typeof globalThis & { __vditorPdfHtml?: string }).__vditorPdfHtml || '',
    );
    expect(pdfHtml).toContain('data:image/png;base64,');
    expect(pdfHtml).not.toContain('local-file://');
    const dialogCalls = await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __vditorExportDialogCalls?: { defaultPath?: string }[];
          }
        ).__vditorExportDialogCalls,
    );
    expect(dialogCalls).toEqual([
      { defaultPath: path.join(workspace, 'export.html') },
      { defaultPath: path.join(exportDirectory, 'export.pdf') },
    ]);
    await expect
      .poll(() => readSetting(running.testRoot, 'files', 'defaultOpenPath'))
      .toBe(exportDirectory);
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('exports the content snapshot that existed before the save dialog opened', async () => {
  const running = await launchApp({ editMode: 'sv' }, { 'snapshot.md': '# Before export' });
  try {
    const { app, page, testRoot } = running;
    const htmlPath = path.join(testRoot, 'snapshot.html');
    await app.evaluate(({ dialog }, output) => {
      dialog.showSaveDialog = async () => {
        (
          globalThis as typeof globalThis & { __exportDialogOpened?: boolean }
        ).__exportDialogOpened = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { canceled: false, filePath: output };
      };
    }, htmlPath);

    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Export HTML/ })
      .click();
    await expect
      .poll(() => app.evaluate(() => Boolean(globalThis.__exportDialogOpened)))
      .toBe(true);
    await page.locator('.editor-host.active .vditor-sv').fill('# Changed after export started');

    await expect.poll(() => fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, 'utf8');
    expect(html).toContain('Before export');
    expect(html).not.toContain('Changed after export started');
  } finally {
    await closeApp(running);
  }
});

test('isolates the PDF export window from navigation, popups, and the business preload', async () => {
  const running = await launchApp();
  try {
    const { app, page, testRoot } = running;
    const pdfPath = path.join(testRoot, 'isolated.pdf');
    await app.evaluate(({ app: electronApp, dialog, shell }, output) => {
      (
        globalThis as typeof globalThis & {
          __vditorExportPreferences?: Electron.WebPreferences;
          __vditorExternalUrls?: string[];
        }
      ).__vditorExternalUrls = [];
      electronApp.on('browser-window-created', (_event, window) => {
        if (window.webContents.getURL().startsWith('app://app/')) return;
        (
          globalThis as typeof globalThis & { __vditorExportPreferences?: Electron.WebPreferences }
        ).__vditorExportPreferences = window.webContents.getLastWebPreferences();
      });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
      shell.openExternal = async (url) => {
        (
          globalThis as typeof globalThis & { __vditorExternalUrls?: string[] }
        ).__vditorExternalUrls?.push(url);
        return '';
      };
    }, pdfPath);

    await page.evaluate(() =>
      window.appAPI.exportPDF(`<!doctype html><script>
        console.log(window.open('https://example.com') ? 'popup-opened' : 'popup-denied');
        location.href = 'https://example.com';
      </script><p>Isolated PDF export</p>`),
    );

    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);
    const isolation = await app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __vditorExportPreferences?: Electron.WebPreferences;
        __vditorExternalUrls?: string[];
      };
      return {
        preferences: state.__vditorExportPreferences,
        externalUrls: state.__vditorExternalUrls,
      };
    });
    expect(isolation.preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(isolation.preferences?.preload).toBeUndefined();
    expect(isolation.externalUrls).toEqual([]);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await closeApp(running);
  }
});

test('resolves external file conflicts without silently overwriting disk changes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-external-change-'));
  const cleanPath = path.join(workspace, 'clean.md');
  const modifiedPath = path.join(workspace, 'modified.md');
  fs.writeFileSync(cleanPath, 'Initial content');
  fs.writeFileSync(modifiedPath, 'Original modified content');
  const running = await launchApp({
    autoSave: true,
    autoSaveDelay: 5_000,
    uiZoom: 110,
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: {
      workspacePath: workspace,
      activeFilePath: cleanPath,
      openFiles: [cleanPath, modifiedPath],
    },
  });
  try {
    const { page } = running;
    const editor = page.locator('.editor-host.active .vditor-sv');
    const cleanFileRow = page.locator(`#fileTree .tree-file[data-path="${cleanPath}"]`);
    await expect(editor).toContainText('Initial content');
    await expect(cleanFileRow).toHaveClass(/active/);
    await cleanFileRow.evaluate((node) => {
      node.dataset.watcherRegressionMarker = 'preserved';
    });

    replaceFileAtomically(cleanPath, 'Reloaded from disk');
    await expect(editor).toContainText('Reloaded from disk');
    await expect(page.locator('#externalChangeBanner')).toBeHidden();
    await expect(cleanFileRow).toHaveAttribute('data-watcher-regression-marker', 'preserved');
    await expect(cleanFileRow).toHaveClass(/active/);

    await page.locator('.document-tab').filter({ hasText: 'modified.md' }).click();
    await editor.fill('Local changes');
    await expect(page.locator('.document-tab.active .dirty')).toHaveText('●');
    fs.writeFileSync(modifiedPath, 'External changes');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await page.locator('#externalChangeBanner').evaluate((banner) => {
      banner.style.width = '520px';
    });
    await expect(page.locator('#externalChangeBanner .persistent-banner-icon')).toHaveAttribute(
      'src',
      'assets/notification/warning.svg',
    );
    const persistentBannerLayout = await page
      .locator('#externalChangeBanner')
      .evaluate((banner) => {
        const content = banner.querySelector('.persistent-banner-content')?.getBoundingClientRect();
        const actions = banner.querySelector('.persistent-banner-actions')?.getBoundingClientRect();
        if (!content || !actions) throw new Error('External conflict banner layout is incomplete.');
        return {
          contentWidth: content.width,
          actionsTop: actions.top,
          contentBottom: content.bottom,
          titleFontSize: getComputedStyle(banner.querySelector('.persistent-banner-copy')).fontSize,
          actionFontSize: getComputedStyle(
            banner.querySelector('.persistent-banner-actions button'),
          ).fontSize,
        };
      });
    expect(persistentBannerLayout.contentWidth).toBeGreaterThan(450);
    expect(persistentBannerLayout.actionsTop).toBeGreaterThanOrEqual(
      persistentBannerLayout.contentBottom,
    );
    expect(persistentBannerLayout.titleFontSize).toBe('15px');
    expect(persistentBannerLayout.actionFontSize).toBe('15px');
    const externalActionLayout = await page.locator('#externalChangeBanner').evaluate((banner) => {
      const actionBounds = (id) => {
        const bounds = banner.querySelector(id)?.getBoundingClientRect();
        if (!bounds) throw new Error(`Missing external conflict action: ${id}`);
        return { left: bounds.left, top: bounds.top };
      };
      return {
        reload: actionBounds('#externalReload'),
        saveAs: actionBounds('#externalSaveAs'),
        ignore: actionBounds('#externalIgnore'),
        overwrite: actionBounds('#externalOverwrite'),
      };
    });
    expect(externalActionLayout.reload.top).toBe(externalActionLayout.saveAs.top);
    expect(externalActionLayout.ignore.top).toBeGreaterThan(externalActionLayout.reload.top);
    expect(externalActionLayout.ignore.top).toBe(externalActionLayout.overwrite.top);
    expect(externalActionLayout.ignore.left).toBeLessThan(externalActionLayout.overwrite.left);
    await expect(page.locator('.document-tab.active .conflict')).toHaveText('!');
    await expect.poll(() => fs.readFileSync(modifiedPath, 'utf8')).toBe('External changes');

    await page.locator('#externalIgnore').click();
    await expect(page.locator('#externalChangeBanner')).toBeHidden();
    fs.writeFileSync(modifiedPath, 'Newest external changes');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await page.locator('#externalReload').click();
    await expect(editor).toContainText('Newest external changes');
    await expect(page.locator('#externalChangeBanner')).toBeHidden();

    await editor.fill('Local content to save elsewhere');
    fs.writeFileSync(modifiedPath, 'External version kept in place');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await expect(page.locator('#externalSaveAs')).toBeVisible();
    expect(fs.readFileSync(modifiedPath, 'utf8')).toBe('External version kept in place');
    await page.locator('#externalReload').click();
    await expect(editor).toContainText('External version kept in place');
    await editor.fill('Ignored local changes');
    fs.writeFileSync(modifiedPath, 'External ignored change');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await page.locator('#externalIgnore').click();
    await expect(page.locator('#externalChangeBanner')).toBeHidden();
    await page.keyboard.press('Control+s');
    const overwriteDialog = page.locator('#confirmModal');
    await expect(overwriteDialog).toBeVisible();
    expect(fs.readFileSync(modifiedPath, 'utf8')).toBe('External ignored change');
    await overwriteDialog.locator('#confirmActions [data-action="cancel"]').click();
    await expect(overwriteDialog).toBeHidden();
    expect(fs.readFileSync(modifiedPath, 'utf8')).toBe('External ignored change');
    await page.keyboard.press('Control+s');
    await expect(overwriteDialog).toBeVisible();
    await overwriteDialog.locator('#confirmActions [data-action="confirm"]').click();
    await expect
      .poll(() => fs.readFileSync(modifiedPath, 'utf8'))
      .toContain('Ignored local changes');

    await editor.fill('Direct overwrite local changes');
    fs.writeFileSync(modifiedPath, 'External direct overwrite change');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await page.locator('#externalOverwrite').click();
    await expect(overwriteDialog).toBeVisible();
    const overwriteButton = overwriteDialog.locator('#confirmActions [data-action="confirm"]');
    for (const [theme, color] of [
      ['', 'rgb(255, 255, 255)'],
      ['dark', 'rgb(255, 255, 255)'],
      ['monokai-pro-dark', 'rgb(255, 255, 255)'],
      ['monokai-pro-light', 'rgb(255, 255, 255)'],
    ]) {
      await page.evaluate((nextTheme) => {
        if (nextTheme) document.documentElement.dataset.theme = nextTheme;
        else delete document.documentElement.dataset.theme;
      }, theme);
      await expect(overwriteButton).toHaveCSS('color', color);
      await expect(overwriteButton).toHaveCSS(
        'background-color',
        theme === 'dark'
          ? 'rgb(255, 119, 119)'
          : theme === 'monokai-pro-dark'
            ? 'rgb(255, 97, 136)'
            : theme === 'monokai-pro-light'
              ? 'rgb(225, 71, 117)'
              : 'rgb(199, 59, 59)',
      );
    }
    await expect(overwriteDialog.locator('.confirm-card')).toHaveClass(/confirm-card-draggable/);
    await overwriteDialog.locator('#confirmActions [data-action="confirm"]').click();
    await expect
      .poll(() => fs.readFileSync(modifiedPath, 'utf8'))
      .toContain('Direct overwrite local changes');
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('protects open documents when files are deleted and reappear outside the app', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-external-delete-'));
  const cleanPath = path.join(workspace, 'clean.md');
  const modifiedPath = path.join(workspace, 'modified.md');
  fs.writeFileSync(cleanPath, 'Clean disk content');
  fs.writeFileSync(modifiedPath, 'Original disk content');
  const running = await launchApp({
    autoSave: true,
    autoSaveDelay: 100,
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
    const { app, page } = running;
    const editor = page.locator('.editor-host.active .vditor-sv');
    const banner = page.locator('#externalFileStateBanner');
    const confirm = page.locator('#confirmModal');
    const reappearedFileRow = page.locator(`#fileTree .tree-file[data-path="${modifiedPath}"]`);
    await app.evaluate(({ clipboard }) => {
      let copiedText = '';
      clipboard.writeText = async (text) => {
        copiedText = text;
      };
      clipboard.readText = async () => copiedText;
      clipboard.read = async () => [];
    });
    await expect(editor).toContainText('Clean disk content');

    fs.rmSync(cleanPath);
    await expect(banner).toBeVisible();
    await expect(page.locator('#externalFileStateMessage')).toHaveText(
      '“clean.md” is currently unavailable.',
    );
    await editor.fill('Kept after deletion');
    await page.waitForTimeout(350);
    expect(fs.existsSync(cleanPath)).toBe(false);
    await expect(editor).toContainText('Kept after deletion');
    await page.evaluate(() => window.appAPI.closeWindow());
    await expect(banner).toBeVisible();
    await expect(page.locator('#statusMessage')).toHaveText(
      'Resolve the unavailable file before saving to its original path.',
    );

    await page.locator('#externalFileClose').click();
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirmActions [data-action="cancel"]').click();
    await expect(banner).toBeVisible();
    await page.locator('#externalFileKeepUntitled').click();
    await expect(banner).toBeHidden();
    expect(fs.existsSync(cleanPath)).toBe(false);

    await page.locator('.document-tab').filter({ hasText: 'modified.md' }).click();
    await editor.fill('Kept local content');
    fs.rmSync(modifiedPath);
    await expect(banner).toBeVisible();
    await expect(page.locator('#externalFileStateMessage')).toHaveText(
      '“modified.md” is currently unavailable.',
    );

    fs.writeFileSync(modifiedPath, 'Reappeared disk content');
    await expect(page.locator('#externalFileStateMessage')).toHaveText(
      '“modified.md” is available again, but its disk version may conflict.',
    );
    await expect(reappearedFileRow).toBeVisible();
    await expect(editor).toContainText('Kept local content');
    await page.locator('#externalFileReload').click();
    await expect(editor).toContainText('Reappeared disk content');
    await expect(banner).toBeHidden();

    await editor.fill('Content to recreate');
    fs.rmSync(modifiedPath);
    await expect(banner).toBeVisible();
    await editor.fill('Content entered after deletion');
    await page.locator('#externalFileRecreate').click();
    await expect(confirm).toBeVisible();
    expect(fs.existsSync(modifiedPath)).toBe(false);
    await confirm.locator('#confirmActions [data-action="cancel"]').click();
    expect(fs.existsSync(modifiedPath)).toBe(false);
    await page.locator('#externalFileRecreate').click();
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirmActions [data-action="confirm"]').click();
    await expect.poll(() => fs.existsSync(modifiedPath)).toBe(true);
    expect(fs.readFileSync(modifiedPath, 'utf8')).toContain('Content entered after deletion');
    await expect
      .poll(() =>
        page.evaluate(() => window.appAPI.readClipboard().then(({ text }) => text.trim())),
      )
      .toBe('Content to recreate');
    await expect(page.locator('#statusMessage')).toHaveText(
      'File recreated. Previous content was copied to the clipboard.',
    );
    await expect(page.locator('#temporaryDocumentNotice')).toHaveText(
      'File recreated. Previous content was copied to the clipboard.',
    );
    await expect(banner).toBeHidden();

    await editor.fill('Content when clipboard fails');
    fs.rmSync(modifiedPath);
    await expect(banner).toBeVisible();
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = async () => {
        throw new Error('clipboard unavailable');
      };
    });
    await page.locator('#externalFileRecreate').click();
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirmActions [data-action="confirm"]').click();
    await expect.poll(() => fs.existsSync(modifiedPath)).toBe(true);
    expect(fs.readFileSync(modifiedPath, 'utf8')).toContain('Content when clipboard fails');
    await expect(page.locator('#statusMessage')).toHaveText(
      'File recreated, but the previous content could not be copied to the clipboard.',
    );
    await expect(page.locator('#temporaryDocumentNotice')).toHaveText(
      'File recreated, but the previous content could not be copied to the clipboard.',
    );
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('copies the last saved content when recreating a deleted file with auto-save disabled', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-recreate-snapshot-'));
  const filePath = path.join(workspace, 'snapshot.md');
  fs.writeFileSync(filePath, 'Last saved content');
  const running = await launchApp({
    autoSave: false,
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    session: { workspacePath: workspace, activeFilePath: filePath, openFiles: [filePath] },
  });
  try {
    const { app, page } = running;
    const editor = page.locator('.editor-host.active .vditor-sv');
    await app.evaluate(({ clipboard }) => {
      let copiedText = '';
      clipboard.writeText = async (text) => {
        copiedText = text;
      };
      clipboard.readText = async () => copiedText;
      clipboard.read = async () => [];
    });
    await editor.fill('Unsaved content before deletion');
    fs.rmSync(filePath);
    await expect(page.locator('#externalFileStateBanner')).toBeVisible();
    await editor.fill('Content entered after deletion');
    await page.locator('#externalFileRecreate').click();
    const confirm = page.locator('#confirmModal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirmActions [data-action="confirm"]').click();
    await expect.poll(() => fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('Content entered after deletion');
    await expect
      .poll(() =>
        page.evaluate(() => window.appAPI.readClipboard().then(({ text }) => text.trim())),
      )
      .toBe('Last saved content');
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('monitors open files outside the workspace', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-workspace-watch-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-external-watch-'));
  const outsidePath = path.join(outsideRoot, 'outside.md');
  fs.writeFileSync(outsidePath, 'Initial outside content');
  const running = await launchApp({
    autoSave: true,
    autoSaveDelay: 5_000,
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    session: {
      workspacePath: workspace,
      activeFilePath: outsidePath,
      openFiles: [outsidePath],
    },
  });
  try {
    const { app, page } = running;
    const editor = page.locator('.editor-host.active .vditor-sv');
    await expect(editor).toContainText('Initial outside content');

    replaceFileAtomically(outsidePath, 'Outside replacement');
    await expect(editor).toContainText('Outside replacement');
    await expect(page.locator('#externalChangeBanner')).toBeHidden();

    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, outsideRoot);
    await page.locator('#appMenuBar [data-menu="main"]').click();
    await page
      .locator('.app-menu-popup button')
      .filter({ hasText: /^Open Folder/ })
      .click();
    await expect(page.locator('#workspaceName')).toHaveText(path.basename(outsideRoot));

    replaceFileAtomically(outsidePath, 'Replacement after workspace switch');
    await expect(editor).toContainText('Replacement after workspace switch');

    await page.locator('.document-tab.active b').click();
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await page.locator(`#fileTree .tree-file[data-path="${outsidePath}"]`).click();
    await expect(editor).toContainText('Replacement after workspace switch');
    replaceFileAtomically(outsidePath, 'Replacement after reopening');
    await expect(editor).toContainText('Replacement after reopening');

    await editor.fill('Local outside changes');
    replaceFileAtomically(outsidePath, 'Conflicting outside replacement');
    await expect(page.locator('#externalChangeBanner')).toBeVisible();
    await expect(page.locator('.document-tab.active .conflict')).toHaveText('!');
  } finally {
    await closeApp(running);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('keeps the active workspace file selected after auto-save', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-auto-save-workspace-'));
  const filePath = path.join(workspace, 'selected.md');
  fs.writeFileSync(filePath, 'Original content');
  const running = await launchApp({
    autoSave: true,
    autoSaveDelay: 50,
    editMode: 'sv',
    restoreTabs: true,
    restoreWorkspace: true,
    sidebarVisible: true,
    session: {
      workspacePath: workspace,
      activeFilePath: filePath,
      openFiles: [filePath],
    },
  });
  try {
    const { page } = running;
    const fileRow = page.locator(`#fileTree .tree-file[data-path="${filePath}"]`);
    await expect(fileRow).toHaveClass(/active/);
    await page.locator('.editor-host.active .vditor-sv').fill('Auto-saved content');

    await expect.poll(() => fs.readFileSync(filePath, 'utf8').trimEnd()).toBe('Auto-saved content');
    await page.waitForTimeout(350);
    await expect(fileRow).toHaveClass(/active/);
    await expect(page.locator('#externalChangeBanner')).toBeHidden();
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
