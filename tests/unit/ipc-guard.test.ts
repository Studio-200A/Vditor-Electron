import { describe, expect, it } from 'vitest';
import {
  IpcRequestError,
  isTrustedMainFrame,
  normalizeIpcError,
  requireTrustedMainFrame,
} from '../../src/main/ipc-guard';

describe('IPC main-frame guard', () => {
  const mainWebContents = { id: 1 };
  const trustedEvent = {
    sender: mainWebContents,
    senderFrame: { parent: null, url: 'app://app/index.html' },
  };

  it('accepts only the canonical top-level application page', () => {
    expect(isTrustedMainFrame(trustedEvent, mainWebContents)).toBe(true);
    expect(
      isTrustedMainFrame(
        { ...trustedEvent, senderFrame: { parent: null, url: 'app://app/' } },
        mainWebContents,
      ),
    ).toBe(true);
  });

  it('rejects a child frame even when it shares the trusted application URL', () => {
    expect(
      isTrustedMainFrame(
        { ...trustedEvent, senderFrame: { parent: {}, url: 'app://app/index.html' } },
        mainWebContents,
      ),
    ).toBe(false);
  });

  it('rejects sender mismatches and URL lookalikes', () => {
    expect(isTrustedMainFrame({ ...trustedEvent, sender: {} }, mainWebContents)).toBe(false);
    expect(
      isTrustedMainFrame(
        { ...trustedEvent, senderFrame: { parent: null, url: 'app://app.evil/index.html' } },
        mainWebContents,
      ),
    ).toBe(false);
    expect(
      isTrustedMainFrame(
        { ...trustedEvent, senderFrame: { parent: null, url: 'app://app/vditor/dist/index.css' } },
        mainWebContents,
      ),
    ).toBe(false);
  });

  it('throws a stable domain error for an untrusted caller', () => {
    expect(() =>
      requireTrustedMainFrame(
        { ...trustedEvent, senderFrame: { parent: {}, url: 'app://app/index.html' } },
        mainWebContents,
      ),
    ).toThrow(IpcRequestError);
    expect(() =>
      requireTrustedMainFrame(
        { ...trustedEvent, senderFrame: { parent: {}, url: 'app://app/index.html' } },
        mainWebContents,
      ),
    ).toThrow('IPC_UNTRUSTED_RENDERER');
  });

  it('normalizes filesystem failures without exposing native messages', () => {
    const permissionError = Object.assign(new Error("EACCES: '/private/notes.md'"), {
      code: 'EACCES',
    });
    const normalized = normalizeIpcError(permissionError);

    expect(normalized).toBeInstanceOf(IpcRequestError);
    expect(normalized).toMatchObject({
      code: 'IPC_PERMISSION_DENIED',
      message: 'IPC_PERMISSION_DENIED',
    });
    expect(normalized.message).not.toContain('/private/notes.md');
  });

  it('maps known operation failures to stable renderer-safe codes', () => {
    expect(normalizeIpcError(Object.assign(new Error('exists'), { code: 'EEXIST' }))).toMatchObject(
      {
        code: 'IPC_ALREADY_EXISTS',
      },
    );
    expect(
      normalizeIpcError(Object.assign(new Error('settings'), { code: 'SETTINGS_PERSIST_FAILED' })),
    ).toMatchObject({ code: 'IPC_SETTINGS_PERSIST_FAILED' });
    expect(normalizeIpcError(new Error('unexpected native failure'))).toMatchObject({
      code: 'IPC_OPERATION_FAILED',
    });
  });

  it('preserves the established unsupported external URL error', () => {
    const error = new Error('Unsupported URL protocol');
    expect(normalizeIpcError(error)).toBe(error);
  });
});
