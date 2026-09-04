// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryRuntimeController } from '../../../src/renderer/editor/recovery-runtime-controller.js';

interface TestTab {
  recoverySnapshotId: string | null;
  recoveryRevision: number;
  modified: boolean;
  externalFileState: unknown | null;
}

describe('RecoveryRuntimeController', () => {
  let tab: TestTab;
  let saveSnapshot: ReturnType<typeof vi.fn>;
  let discardSnapshot: ReturnType<typeof vi.fn>;
  let onFailure: ReturnType<typeof vi.fn>;
  let controller: RecoveryRuntimeController<TestTab>;

  beforeEach(() => {
    vi.useFakeTimers();
    tab = {
      recoverySnapshotId: null,
      recoveryRevision: 0,
      modified: true,
      externalFileState: null,
    };
    saveSnapshot = vi.fn(async () => undefined);
    discardSnapshot = vi.fn(async () => undefined);
    onFailure = vi.fn();
    controller = new RecoveryRuntimeController({
      createSnapshotId: () => 'recovery-1',
      saveSnapshot,
      discardSnapshot,
      onFailure,
      delay: 100,
    });
  });

  it('replaces a pending save timer with the latest revision', async () => {
    controller.schedule(tab);
    controller.schedule(tab);

    await vi.advanceTimersByTimeAsync(100);

    expect(tab).toMatchObject({ recoverySnapshotId: 'recovery-1', recoveryRevision: 2 });
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('invalidates a scheduled save when the snapshot is discarded', async () => {
    controller.schedule(tab);
    await controller.discard(tab);
    await vi.advanceTimersByTimeAsync(100);

    expect(discardSnapshot).toHaveBeenCalledWith('recovery-1');
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(tab.recoverySnapshotId).toBeNull();
  });

  it('serializes an unavailable-state save after an earlier save completes', async () => {
    let releaseSave: (() => void) | null = null;
    saveSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseSave = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    controller.schedule(tab);
    await vi.advanceTimersByTimeAsync(100);
    const preserved = controller.preserveUnavailable(tab);

    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    releaseSave?.();
    await preserved;

    expect(saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('reports recovery-store failures without rejecting the caller', async () => {
    discardSnapshot.mockRejectedValueOnce(new Error('disk unavailable'));
    controller.schedule(tab);

    await expect(controller.discard(tab)).resolves.toBeUndefined();

    expect(onFailure).toHaveBeenCalledWith('discard');
  });
});
