import * as path from 'node:path';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  WORKSPACE_READ_DEPTH_MAX,
  WORKSPACE_READ_DEPTH_MIN,
} from './services/app-state';
import { invalidIpcArgument } from './ipc-guard';

const MAX_PATH_LENGTH = 32_767;
const MAX_TEXT_LENGTH = 16 * 1024 * 1024;
const MAX_BINARY_LENGTH = 32 * 1024 * 1024;
const MAX_COLLECTION_LENGTH = 512;
const MAX_RESOURCE_ROOTS = 64;
const MAX_UI_DIMENSION = 16_384;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const APP_THEMES = [
  'classic',
  'dark',
  'claude-light',
  'claude-dark',
  'monokai-pro-dark',
  'monokai-pro-light',
] as const;
const LIGHT_THEMES = ['classic', 'claude-light', 'monokai-pro-light'] as const;
const DARK_THEMES = ['dark', 'claude-dark', 'monokai-pro-dark'] as const;
const LOCALES = ['system', 'en_US', 'zh_Hans', 'zh_Hant'] as const;
const CONTENT_THEMES = ['light', 'dark', 'ant-design', 'wechat'] as const;
const THEME_NAME_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,127}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength && !value.includes('\0');
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function ensureOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalidIpcArgument();
}

export function requireArgumentCount(
  args: readonly unknown[],
  minimum: number,
  maximum = minimum,
): void {
  if (args.length < minimum || args.length > maximum) invalidIpcArgument();
}

export function parseText(value: unknown, maximumLength = MAX_TEXT_LENGTH): string {
  if (!isSafeString(value, maximumLength)) invalidIpcArgument();
  return value;
}

export function parseOptionalText(
  value: unknown,
  maximumLength = MAX_TEXT_LENGTH,
): string | undefined {
  if (value === undefined) return undefined;
  return parseText(value, maximumLength);
}

export function parseAbsolutePath(value: unknown): string {
  const filePath = parseText(value, MAX_PATH_LENGTH);
  if (!path.isAbsolute(filePath)) invalidIpcArgument();
  return path.resolve(filePath);
}

export function parseOptionalAbsolutePath(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return parseAbsolutePath(value);
}

export function parseFileName(value: unknown): string {
  const name = parseText(value, 255);
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.endsWith('.') ||
    name.endsWith(' ') ||
    /[<>:"/\\|?*]/.test(name) ||
    hasControlCharacter(name) ||
    WINDOWS_RESERVED_NAMES.test(name)
  )
    invalidIpcArgument();
  return name;
}

export function parseEnum<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalidIpcArgument();
  return value as T;
}

function parseThemeName(value: unknown): string {
  const theme = parseText(value, 128);
  if (!THEME_NAME_PATTERN.test(theme)) invalidIpcArgument();
  return theme;
}

function parseRelativeDirectory(value: unknown): string {
  const directory = parseText(value, MAX_PATH_LENGTH);
  if (!directory) return directory;
  if (
    path.isAbsolute(directory) ||
    /^[a-zA-Z]:/.test(directory) ||
    /^[\\/]{2}/.test(directory) ||
    hasControlCharacter(directory) ||
    directory.split(/[\\/]+/).some((segment) => segment === '..')
  )
    invalidIpcArgument();
  return directory;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalidIpcArgument();
  return value;
}

export function parseOptionalBoolean(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : parseBoolean(value);
}

export function parseFiniteNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    invalidIpcArgument();
  return value;
}

export function parseInteger(value: unknown, minimum: number, maximum: number): number {
  const number = parseFiniteNumber(value, minimum, maximum);
  if (!Number.isInteger(number)) invalidIpcArgument();
  return number;
}

export function parseOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined ? undefined : parseInteger(value, minimum, maximum);
}

export function parseBinary(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_BINARY_LENGTH) invalidIpcArgument();
  return value;
}

function parseStringArray(value: unknown, maximumItems = MAX_COLLECTION_LENGTH): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) invalidIpcArgument();
  return value.map((item) => parseText(item, MAX_PATH_LENGTH));
}

function parseAbsolutePathArray(value: unknown, maximumItems = MAX_COLLECTION_LENGTH): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) invalidIpcArgument();
  return value.map((item) => parseAbsolutePath(item));
}

export function parseResourceRootPaths(value: unknown): string[] {
  return parseAbsolutePathArray(value, MAX_RESOURCE_ROOTS);
}

function parseAbsolutePathOrEmpty(value: unknown): string {
  return value === '' ? '' : parseAbsolutePath(value);
}

function parseSettingsObject<T extends Record<string, unknown>>(
  value: unknown,
  keys: readonly string[],
  parser: (record: Record<string, unknown>) => T,
): T {
  if (!isRecord(value)) invalidIpcArgument();
  ensureOnlyKeys(value, keys);
  return parser(value);
}

function parseWindowBounds(value: unknown): AppSettings['windowBounds'] {
  return parseSettingsObject(value, ['x', 'y', 'width', 'height'], (record) => ({
    x: record.x === undefined ? undefined : parseFiniteNumber(record.x, -100_000, 100_000),
    y: record.y === undefined ? undefined : parseFiniteNumber(record.y, -100_000, 100_000),
    width: parseFiniteNumber(record.width, 760, MAX_UI_DIMENSION),
    height: parseFiniteNumber(record.height, 520, MAX_UI_DIMENSION),
  }));
}

function parseSettingsDialogSize(value: unknown): AppSettings['settingsDialogSize'] {
  return parseSettingsObject(value, ['width', 'height', 'customized'], (record) => ({
    width: parseFiniteNumber(record.width, 320, MAX_UI_DIMENSION),
    height: parseFiniteNumber(record.height, 240, MAX_UI_DIMENSION),
    customized: parseBoolean(record.customized),
  }));
}

function parseRecentFiles(value: unknown): AppSettings['recentFiles'] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_LENGTH) invalidIpcArgument();
  return value.map((item) =>
    parseSettingsObject(item, ['path', 'title', 'openedAt'], (record) => ({
      path: parseAbsolutePath(record.path),
      title: parseText(record.title, 1_024),
      openedAt: parseFiniteNumber(record.openedAt, 0, Number.MAX_SAFE_INTEGER),
    })),
  );
}

function parseWorkspaceTreeStates(value: unknown): AppSettings['workspaceTreeStates'] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_LENGTH) invalidIpcArgument();
  return value.map((item) =>
    parseSettingsObject(item, ['workspacePath', 'expandedPaths'], (record) => ({
      workspacePath: parseAbsolutePath(record.workspacePath),
      expandedPaths: parseAbsolutePathArray(record.expandedPaths),
    })),
  );
}

function parseSession(value: unknown): AppSettings['session'] {
  return parseSettingsObject(
    value,
    ['schemaVersion', 'workspacePath', 'activeFilePath', 'openFiles'],
    (record) => {
      if (record.schemaVersion !== undefined && record.schemaVersion !== 1) invalidIpcArgument();
      return {
        schemaVersion: 1 as const,
        workspacePath: parseAbsolutePathOrEmpty(record.workspacePath),
        activeFilePath:
          record.activeFilePath === null
            ? null
            : parseOptionalAbsolutePath(record.activeFilePath) || null,
        openFiles: parseAbsolutePathArray(record.openFiles),
      };
    },
  );
}

function parseToolbarConfig(value: unknown): AppSettings['toolbarConfig'] {
  return parseSettingsObject(value, ['hide', 'pin'], (record) => ({
    hide: parseBoolean(record.hide),
    pin: parseBoolean(record.pin),
  }));
}

function parseFileExplorer(value: unknown): AppSettings['fileExplorer'] {
  return parseSettingsObject(value, ['visibleExtensions'], (record) => ({
    visibleExtensions: parseStringArray(record.visibleExtensions, 64),
  }));
}

const BOOLEAN_SETTINGS = new Set<keyof AppSettings>([
  'restoreTabs',
  'restoreWorkspace',
  'devToolsEnabled',
  'systemTheme',
  'typewriterMode',
  'tabInsertSpaces',
  'showWhitespace',
  'autoIndent',
  'rtl',
  'autoSave',
  'wordWrap',
  'multiPlatformPreview',
  'enableHighlight',
  'lineNumbers',
  'enableAutoSpace',
  'enableCallout',
  'enableFootnotes',
  'enableImageCaption',
  'enableMark',
  'enableSub',
  'enableSup',
  'scrollSync',
  'paragraphBeginningSpace',
  'fixTermTypo',
  'gfmAutoLink',
  'toc',
  'listStyle',
  'headingAnchor',
  'sanitize',
  'allowSvgImages',
  'sidebarVisible',
  'toolbarVisible',
  'windowMaximized',
]);

const STRING_SETTINGS = new Set<keyof AppSettings>([
  'uiFontFamily',
  'editorFontFamily',
  'previewFontFamily',
  'previewCodeFontFamily',
  'placeholder',
  'tabString',
  'pasteImagesDir',
  'defaultOpenPath',
]);

interface NumericSettingRange {
  minimum: number;
  maximum: number;
  integer?: boolean;
}

const NUMERIC_SETTINGS = new Map<keyof AppSettings, NumericSettingRange>([
  ['editorFontSize', { minimum: 10, maximum: 36, integer: true }],
  ['previewFontSize', { minimum: 10, maximum: 36, integer: true }],
  ['previewCodeFontSize', { minimum: 9, maximum: 36, integer: true }],
  ['uiZoom', { minimum: 75, maximum: 200, integer: true }],
  ['editorZoom', { minimum: 75, maximum: 200, integer: true }],
  ['previewZoom', { minimum: 75, maximum: 200, integer: true }],
  ['autoSaveDelay', { minimum: 250, maximum: 60_000, integer: true }],
  ['editorTextWidth', { minimum: 40, maximum: 100, integer: true }],
  ['previewTextWidth', { minimum: 40, maximum: 100, integer: true }],
  ['splitRatio', { minimum: 20, maximum: 80 }],
  ['previewDelay', { minimum: 0, maximum: 5_000, integer: true }],
  ['previewMaxWidth', { minimum: 320, maximum: 2_400, integer: true }],
  ['imageMaxWidth', { minimum: 0, maximum: 10_000, integer: true }],
  ['imageQuality', { minimum: 0.1, maximum: 1 }],
  ['sidebarWidth', { minimum: 0, maximum: 500, integer: true }],
]);

function parseSettingValue(key: keyof AppSettings, value: unknown): AppSettings[keyof AppSettings] {
  if (BOOLEAN_SETTINGS.has(key)) return parseBoolean(value);
  if (STRING_SETTINGS.has(key)) {
    if (key === 'defaultOpenPath') return parseAbsolutePathOrEmpty(value);
    if (key === 'pasteImagesDir') return parseRelativeDirectory(value);
    return parseText(value, 16_384);
  }
  const numericRange = NUMERIC_SETTINGS.get(key);
  if (numericRange) {
    return numericRange.integer
      ? parseInteger(value, numericRange.minimum, numericRange.maximum)
      : parseFiniteNumber(value, numericRange.minimum, numericRange.maximum);
  }
  switch (key) {
    case 'contentTheme':
      return parseEnum(value, CONTENT_THEMES);
    case 'codeTheme':
    case 'lightCodeTheme':
    case 'darkCodeTheme':
      return parseThemeName(value);
    case 'theme':
      return parseEnum(value, APP_THEMES);
    case 'lightTheme':
      return parseEnum(value, LIGHT_THEMES);
    case 'darkTheme':
      return parseEnum(value, DARK_THEMES);
    case 'locale':
      return parseEnum(value, LOCALES);
    case 'iconSet':
      return parseEnum(value, ['ant', 'material']);
    case 'scrollbarMode':
      return parseEnum(value, ['always', 'auto', 'hidden']);
    case 'editMode':
      return parseEnum(value, ['wysiwyg', 'ir', 'sv']);
    case 'previewMode':
      return parseEnum(value, ['both', 'editor']);
    case 'tabSize': {
      const tabSize = parseInteger(value, 2, 8);
      if (![2, 4, 6, 8].includes(tabSize)) invalidIpcArgument();
      return tabSize as AppSettings['tabSize'];
    }
    case 'mathEngine':
      return parseEnum(value, ['KaTeX', 'MathJax']);
    case 'workspaceReadDepth':
      return parseInteger(value, WORKSPACE_READ_DEPTH_MIN, WORKSPACE_READ_DEPTH_MAX);
    case 'toolbarConfig':
      return parseToolbarConfig(value);
    case 'toolbarItems':
      return parseStringArray(value, 128);
    case 'recentPaths':
      return parseAbsolutePathArray(value, 128);
    case 'recentFiles':
      return parseRecentFiles(value);
    case 'fileExplorer':
      return parseFileExplorer(value);
    case 'workspaceTreeStates':
      return parseWorkspaceTreeStates(value);
    case 'windowBounds':
      return parseWindowBounds(value);
    case 'settingsDialogSize':
      return parseSettingsDialogSize(value);
    case 'session':
      return parseSession(value);
    default:
      return invalidIpcArgument();
  }
}

export function parseSettingsPatch(value: unknown): Partial<AppSettings> {
  if (!isRecord(value) || Object.keys(value).length > Object.keys(DEFAULT_SETTINGS).length)
    invalidIpcArgument();
  const patch: Partial<AppSettings> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (!(rawKey in DEFAULT_SETTINGS)) invalidIpcArgument();
    const key = rawKey as keyof AppSettings;
    patch[key] = parseSettingValue(key, rawValue) as never;
  }
  return patch;
}
