import { describe, expect, it } from 'vitest';
import {
  formatIpcErrorMessage,
  IPC_ERROR_MESSAGE_KEYS,
  resolveLocale,
  translate,
} from '../../../src/renderer/ui/localization';
import type { VditorDesktopLocales } from '../../../src/renderer/types/locales';

const mockLocales: VditorDesktopLocales = {
  en_US: {
    'app.title': 'My App',
    greeting: 'Hello, {name}!',
    'message.ipcInvalidRequest': 'Invalid request',
    'message.ipcNotFound': 'Not found',
  },
  zh_Hans: {
    'app.title': '我的应用',
    greeting: '你好，{name}！',
    'message.ipcInvalidRequest': '无效请求',
    'message.ipcNotFound': '未找到',
  },
  zh_Hant: {
    'app.title': '我的應用',
    greeting: '你好，{name}！',
    'message.ipcInvalidRequest': '無效請求',
    'message.ipcNotFound': '未找到',
  },
};

describe('resolveLocale', () => {
  it('returns the given locale if it is supported', () => {
    expect(resolveLocale('en_US', 'en-US', mockLocales)).toBe('en_US');
    expect(resolveLocale('zh_Hans', 'en-US', mockLocales)).toBe('zh_Hans');
    expect(resolveLocale('zh_Hant', 'en-US', mockLocales)).toBe('zh_Hant');
  });

  it('resolves system locale from navigator language for English', () => {
    expect(resolveLocale('system', 'en-US', mockLocales)).toBe('en_US');
    expect(resolveLocale('system', 'fr-FR', mockLocales)).toBe('en_US');
    expect(resolveLocale(undefined, 'de-DE', mockLocales)).toBe('en_US');
  });

  it('resolves system locale from navigator language for Simplified Chinese', () => {
    expect(resolveLocale('system', 'zh-CN', mockLocales)).toBe('zh_Hans');
    expect(resolveLocale('system', 'zh-SG', mockLocales)).toBe('zh_Hans');
  });

  it('resolves system locale from navigator language for Traditional Chinese', () => {
    expect(resolveLocale('system', 'zh-TW', mockLocales)).toBe('zh_Hant');
    expect(resolveLocale('system', 'zh-HK', mockLocales)).toBe('zh_Hant');
    expect(resolveLocale('system', 'zh-MO', mockLocales)).toBe('zh_Hant');
    expect(resolveLocale('system', 'zh-Hant', mockLocales)).toBe('zh_Hant');
  });

  it('falls back to en_US for unsupported explicit locale', () => {
    expect(resolveLocale('fr_FR', 'en-US', mockLocales)).toBe('en_US');
  });
});

describe('translate', () => {
  it('returns the translated string for the current locale', () => {
    expect(translate(mockLocales, 'en_US', 'app.title')).toBe('My App');
    expect(translate(mockLocales, 'zh_Hans', 'app.title')).toBe('我的应用');
    expect(translate(mockLocales, 'zh_Hant', 'app.title')).toBe('我的應用');
  });

  it('interpolates parameters', () => {
    expect(translate(mockLocales, 'en_US', 'greeting', { name: 'World' })).toBe('Hello, World!');
    expect(translate(mockLocales, 'zh_Hans', 'greeting', { name: '世界' })).toBe('你好，世界！');
  });

  it('leaves unresolved placeholders intact', () => {
    expect(translate(mockLocales, 'en_US', 'greeting')).toBe('Hello, {name}!');
  });

  it('falls back to English when key is missing in current locale', () => {
    const partialLocales = {
      en_US: { 'only.english': 'English only' },
      zh_Hans: {},
      zh_Hant: {},
    } as unknown as VditorDesktopLocales;
    expect(translate(partialLocales, 'zh_Hans', 'only.english')).toBe('English only');
  });

  it('returns the key when missing in all locales', () => {
    expect(translate(mockLocales, 'en_US', 'missing.key')).toBe('missing.key');
  });
});

describe('formatIpcErrorMessage', () => {
  it('maps known IPC error codes to localized messages', () => {
    const error = new Error('IPC_INVALID_ARGUMENT: bad input');
    expect(formatIpcErrorMessage(error, mockLocales, 'en_US')).toBe('Invalid request');
    expect(formatIpcErrorMessage(error, mockLocales, 'zh_Hans')).toBe('无效请求');
  });

  it('maps IPC_NOT_FOUND to localized message', () => {
    const error = new Error('IPC_NOT_FOUND: file missing');
    expect(formatIpcErrorMessage(error, mockLocales, 'en_US')).toBe('Not found');
  });

  it('returns the raw message for unknown errors', () => {
    const error = new Error('Something went wrong');
    expect(formatIpcErrorMessage(error, mockLocales, 'en_US')).toBe('Something went wrong');
  });

  it('handles non-Error values', () => {
    expect(formatIpcErrorMessage('IPC_NOT_FOUND: oops', mockLocales, 'en_US')).toBe('Not found');
    expect(formatIpcErrorMessage(42, mockLocales, 'en_US')).toBe('42');
  });
});

describe('IPC_ERROR_MESSAGE_KEYS', () => {
  it('contains expected error code mappings', () => {
    expect(IPC_ERROR_MESSAGE_KEYS['IPC_INVALID_ARGUMENT']).toBe('message.ipcInvalidRequest');
    expect(IPC_ERROR_MESSAGE_KEYS['IPC_NOT_FOUND']).toBe('message.ipcNotFound');
    expect(IPC_ERROR_MESSAGE_KEYS['IPC_OPERATION_FAILED']).toBe('message.ipcOperationFailed');
  });
});
