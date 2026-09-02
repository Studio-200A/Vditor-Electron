import * as TOML from '@iarna/toml';
import { _electron as electron, type ElectronApplication } from 'playwright';
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AppSettings } from '../../../src/main/services/app-state';
import { SettingsStore } from '../../../src/main/services/settings-store';

export const projectRoot = path.resolve(__dirname, '../../..');

export interface RunningApp {
  app: ElectronApplication;
  page: Page;
  testRoot: string;
}

export async function launchApp(
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
  await page.waitForSelector('body[data-app-ready="true"]');
  return { app, page, testRoot };
}

export async function delayVditorAfter(page: Page, delayMs = 1_000): Promise<void> {
  await page.evaluate((delay) => {
    type VditorConstructor = {
      prototype: {
        init: (element: HTMLElement, options: Record<string, unknown>) => void;
      };
    };
    const constructor = (window as unknown as { Vditor?: VditorConstructor }).Vditor;
    if (!constructor) throw new Error('Vditor constructor is unavailable.');
    const originalInit = constructor.prototype.init;
    constructor.prototype.init = function (this: VditorConstructor['prototype'], element, options) {
      const originalAfter = options.after;
      return originalInit.call(this, element, {
        ...options,
        after: (...args: unknown[]) => {
          window.setTimeout(() => {
            if (typeof originalAfter === 'function') originalAfter(...args);
          }, delay);
        },
      });
    };
  }, delayMs);
}

export function readSettings(testRoot: string): Record<string, unknown> {
  return TOML.parse(
    fs.readFileSync(path.join(testRoot, 'config', 'config.toml'), 'utf8'),
  ) as Record<string, unknown>;
}

export function readSetting(testRoot: string, section: string, key: string): unknown {
  return (readSettings(testRoot)[section] as Record<string, unknown>)[key];
}

export async function closeApp(running: RunningApp): Promise<void> {
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

export async function createNewTab(page: Page): Promise<void> {
  await page.locator('#addTab').click();
  await page.waitForSelector('.editor-host.active .vditor-content');
}

export async function selectThemeMode(
  page: Page,
  mode: 'light' | 'dark' | 'system',
): Promise<void> {
  await page.locator('#statusThemeMode').click();
  await page.locator(`#statusThemeMenu [data-theme-mode="${mode}"]`).click();
}

export function replaceFileAtomically(filePath: string, content: string): void {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}-${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}
