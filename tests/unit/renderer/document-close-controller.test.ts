import { describe, expect, it, vi } from 'vitest';
import { DocumentCloseController } from '../../../src/renderer/documents/document-close-controller';

describe('DocumentCloseController', () => {
  it('releases runtime before removing the document and updating the remaining UI', async () => {
    const controller = new DocumentCloseController();
    const events: string[] = [];

    await expect(
      controller.close(
        { id: 'one' },
        {
          confirmClose: async () => {
            events.push('confirm');
            return true;
          },
          disposeRuntime: async () => {
            events.push('dispose');
          },
          removeDocument: () => {
            events.push('remove');
          },
          afterClose: async () => {
            events.push('after');
          },
        },
      ),
    ).resolves.toBe(true);
    expect(events).toEqual(['confirm', 'dispose', 'remove', 'after']);
  });

  it('does not dispose or remove a document when confirmation is cancelled', async () => {
    const controller = new DocumentCloseController();
    const disposeRuntime = vi.fn();
    const removeDocument = vi.fn();

    await expect(
      controller.close(
        { id: 'one' },
        {
          confirmClose: async () => false,
          disposeRuntime,
          removeDocument,
          afterClose: async () => {},
        },
      ),
    ).resolves.toBe(false);
    expect(disposeRuntime).not.toHaveBeenCalled();
    expect(removeDocument).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent close requests for one document', async () => {
    const controller = new DocumentCloseController();
    let confirm!: (value: boolean) => void;
    const confirmClose = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          confirm = resolve;
        }),
    );
    const disposeRuntime = vi.fn(async () => {});
    const removeDocument = vi.fn();
    const afterClose = vi.fn(async () => {});
    const callbacks = { confirmClose, disposeRuntime, removeDocument, afterClose };

    const first = controller.close({ id: 'one' }, callbacks);
    const second = controller.close({ id: 'one' }, callbacks);
    confirm(true);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(confirmClose).toHaveBeenCalledTimes(1);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
    expect(removeDocument).toHaveBeenCalledTimes(1);
    expect(afterClose).toHaveBeenCalledTimes(1);
  });
});
