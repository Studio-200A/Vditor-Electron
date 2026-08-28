import { describe, expect, it } from 'vitest';
import {
  IpcRequestError,
  isTrustedMainFrame,
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
});
