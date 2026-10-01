import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrustedChannelRegistration } from '../../src/main/ipc/trusted-channel';
import { IpcRequestError } from '../../src/main/ipc-guard';

type CapturedListener = (event: unknown, ...args: unknown[]) => unknown;

interface FakeWindow {
  webContents: object;
}

interface RegistrationHarness {
  registration: ReturnType<typeof createTrustedChannelRegistration>;
  invokeListener(channel: string): CapturedListener;
  messageListener(channel: string): CapturedListener;
  setMainWindow(window: FakeWindow | null): void;
}

function createHarness(): RegistrationHarness {
  const invokeListeners = new Map<string, CapturedListener>();
  const messageListeners = new Map<string, CapturedListener>();
  let mainWindow: FakeWindow | null = null;
  const registration = createTrustedChannelRegistration({
    registerInvoke: (channel, listener) => {
      invokeListeners.set(channel, listener as CapturedListener);
    },
    registerMessage: (channel, listener) => {
      messageListeners.set(channel, listener as CapturedListener);
    },
    getMainWindow: () => mainWindow,
  });
  return {
    registration,
    invokeListener: (channel) => {
      const listener = invokeListeners.get(channel);
      if (!listener) throw new Error(`no invoke listener registered for ${channel}`);
      return listener;
    },
    messageListener: (channel) => {
      const listener = messageListeners.get(channel);
      if (!listener) throw new Error(`no message listener registered for ${channel}`);
      return listener;
    },
    setMainWindow: (window) => {
      mainWindow = window;
    },
  };
}

function invokeEvent(sender: object, options: { url?: string; parent?: unknown } = {}): unknown {
  return {
    sender,
    senderFrame: {
      parent: options.parent ?? null,
      url: options.url ?? 'app://app/index.html',
    },
  };
}

describe('trusted IPC channel registration', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('rejects an untrusted invoke before running the handler', async () => {
    const harness = createHarness();
    const mainWindow = { webContents: {} };
    harness.setMainWindow(mainWindow);
    const handler = vi.fn();
    harness.registration.handleTrusted('test:invoke', handler);

    const foreignEvent = invokeEvent({ webContents: {} });
    await expect(harness.invokeListener('test:invoke')(foreignEvent)).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_RENDERER',
    });
    expect(handler).not.toHaveBeenCalled();
    // The trust check runs outside try/catch, so the raw guard error is not
    // normalized and reportIpcFailure never logs untrusted rejections.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('rejects an untrusted invoke from a framed or non-app page', async () => {
    const harness = createHarness();
    const mainWindow = { webContents: {} };
    harness.setMainWindow(mainWindow);
    const handler = vi.fn();
    harness.registration.handleTrusted('test:invoke', handler);

    const framedEvent = invokeEvent(mainWindow.webContents, { parent: {} });
    await expect(harness.invokeListener('test:invoke')(framedEvent)).rejects.toBeInstanceOf(
      IpcRequestError,
    );
    const foreignUrlEvent = invokeEvent(mainWindow.webContents, {
      url: 'https://example.com/index.html',
    });
    await expect(harness.invokeListener('test:invoke')(foreignUrlEvent)).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_RENDERER',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs a trusted invoke and resolves the handler result', async () => {
    const harness = createHarness();
    const mainWindow = { webContents: {} };
    harness.setMainWindow(mainWindow);
    const handler = vi.fn(async (_event: unknown, ...args: unknown[]) => `echo:${String(args[0])}`);
    harness.registration.handleTrusted('test:invoke', handler);

    const event = invokeEvent(mainWindow.webContents);
    await expect(harness.invokeListener('test:invoke')(event, 'value')).resolves.toBe('echo:value');
    expect(handler).toHaveBeenCalledWith(event, 'value');
  });

  it('reports an untrusted message without running the handler or throwing', () => {
    const harness = createHarness();
    const mainWindow = { webContents: {} };
    harness.setMainWindow(mainWindow);
    const handler = vi.fn();
    harness.registration.onTrusted('test:message', handler);

    const foreignEvent = invokeEvent({ webContents: {} });
    expect(() => harness.messageListener('test:message')(foreignEvent)).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    // reportIpcFailure silences IPC_UNTRUSTED_RENDERER by design.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('logs and rethrows a normalized error when an invoke handler fails', async () => {
    const harness = createHarness();
    const mainWindow = { webContents: {} };
    harness.setMainWindow(mainWindow);
    const failure = new Error('disk exploded');
    harness.registration.handleTrusted('test:invoke', () => {
      throw failure;
    });

    await expect(
      harness.invokeListener('test:invoke')(invokeEvent(mainWindow.webContents)),
    ).rejects.toMatchObject({ code: 'IPC_OPERATION_FAILED' });
    expect(consoleError).toHaveBeenCalledWith('IPC test:invoke failed:', failure);
  });

  it('logs without rethrowing when a message handler fails', () => {
    const harness = createHarness();
    const mainWindow = { webContents: {} };
    harness.setMainWindow(mainWindow);
    const failure = new Error('disk exploded');
    harness.registration.onTrusted('test:message', () => {
      throw failure;
    });

    expect(() =>
      harness.messageListener('test:message')(invokeEvent(mainWindow.webContents)),
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('IPC test:message failed:', failure);
  });

  it('reads the current window on every call instead of caching it at registration', async () => {
    const harness = createHarness();
    const handler = vi.fn();
    harness.registration.handleTrusted('test:invoke', handler);
    const event = invokeEvent({ webContents: {} });

    // No window yet: rejected even though the event sender matches the window
    // that will appear later.
    await expect(harness.invokeListener('test:invoke')(event)).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_RENDERER',
    });

    // The window owning the event's sender appears after registration: the
    // same listener now trusts the same event.
    harness.setMainWindow({ webContents: (event as { sender: object }).sender });
    await expect(harness.invokeListener('test:invoke')(event)).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);

    // The window is replaced: the old sender is no longer trusted.
    harness.setMainWindow({ webContents: {} });
    await expect(harness.invokeListener('test:invoke')(event)).rejects.toMatchObject({
      code: 'IPC_UNTRUSTED_RENDERER',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
