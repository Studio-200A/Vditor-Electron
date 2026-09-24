import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/main/ipc-contract';
import { registerFileWatchingIpcHandlers } from '../../src/main/ipc/file-watching';
import { FileWatchService } from '../../src/main/services/file-watch-service';
import { LocalResourcePolicy } from '../../src/main/local-resource';
import { IpcRequestError } from '../../src/main/ipc-guard';

/**
 * Focused argument-forwarding test for the file:setWorkspaceWatch handler.
 * The channel coverage test proves which channels register and in which
 * direction; it does not execute handler argument parsing. A migration
 * regression once forwarded the whole args array as the watch depth and was
 * only caught by E2E — this test pins the depth/index contract directly.
 */
describe('file:setWorkspaceWatch handler arguments', () => {
  /** The handler validates synchronously; parseInteger throws before any service call. */
  function expectInvalidArgument(fn: () => unknown): void {
    let thrown: unknown;
    try {
      fn();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IpcRequestError);
    expect((thrown as IpcRequestError).code).toBe('IPC_INVALID_ARGUMENT');
  }

  function createHarness() {
    const fileWatchService = new FileWatchService(
      () => Promise.resolve({ content: '', encoding: 'utf-8' as const }),
      () => undefined,
    );
    const setWorkspace = vi.spyOn(fileWatchService, 'setWorkspace').mockResolvedValue(undefined);
    const localResourcePolicy = new LocalResourcePolicy();
    let captured: ((event: unknown, ...args: unknown[]) => unknown) | null = null;
    registerFileWatchingIpcHandlers({
      fileWatchService,
      localResourcePolicy,
      registration: {
        handleTrusted: (channel, handler) => {
          if (channel === IPC_CHANNELS.fileSetWorkspaceWatch) captured = handler;
        },
        onTrusted: () => undefined,
      },
    });
    if (!captured) throw new Error('file:setWorkspaceWatch handler was not registered');
    const handler = (args: unknown[]) => captured({ sender: {} }, ...args);
    return { handler, setWorkspace };
  }

  it('forwards an absolute workspace path and an in-range depth', async () => {
    const harness = createHarness();

    await harness.handler(['/workspace/docs', 9]);

    expect(harness.setWorkspace).toHaveBeenCalledWith('/workspace/docs', 9);
  });

  it('forwards an undefined depth when only the workspace path is given', async () => {
    const harness = createHarness();

    await harness.handler(['/workspace/docs']);

    expect(harness.setWorkspace).toHaveBeenCalledWith('/workspace/docs', undefined);
  });

  it('forwards an unwatched workspace when no argument is given', async () => {
    const harness = createHarness();

    await harness.handler([]);

    expect(harness.setWorkspace).toHaveBeenCalledWith(undefined, undefined);
  });

  it('rejects a depth outside the read-depth bounds without touching the service', () => {
    for (const depth of [3, 99]) {
      const harness = createHarness();
      expectInvalidArgument(() => harness.handler(['/workspace/docs', depth]));
      expect(harness.setWorkspace).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-numeric depth, not the whole argument array', () => {
    const harness = createHarness();

    expectInvalidArgument(() => harness.handler(['/workspace/docs', '9']));
    expect(harness.setWorkspace).not.toHaveBeenCalled();
  });

  it('rejects a relative workspace path', () => {
    const harness = createHarness();

    expectInvalidArgument(() => harness.handler(['workspace/docs', 9]));
    expect(harness.setWorkspace).not.toHaveBeenCalled();
  });
});
