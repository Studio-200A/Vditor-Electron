import { describe, expect, it, vi } from 'vitest';
import { DocumentSaveController } from '../../../src/renderer/documents/document-save-controller';

describe('DocumentSaveController', () => {
  it('serializes operations for one document', async () => {
    const controller = new DocumentSaveController();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = controller.run('one', async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
      return 'first';
    });
    const second = controller.run('one', async () => {
      events.push('second');
      return 'second';
    });

    await vi.waitFor(() => expect(releaseFirst).toBeDefined());
    expect(events).toEqual(['first:start']);
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not block a later save after a failed save', async () => {
    const controller = new DocumentSaveController();
    const failed = controller.run('one', async () => {
      throw new Error('write failed');
    });
    const succeeded = controller.run('one', async () => 'saved');

    await expect(failed).rejects.toThrow('write failed');
    await expect(succeeded).resolves.toBe('saved');
  });

  it('allows independent documents to save concurrently', async () => {
    const controller = new DocumentSaveController();
    const first = controller.run('one', async () => 'one');
    const second = controller.run('two', async () => 'two');

    await expect(Promise.all([first, second])).resolves.toEqual(['one', 'two']);
  });

  it('serializes writes for the same canonical identity independently of document IDs', async () => {
    const controller = new DocumentSaveController();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = controller.runForIdentity('file:///same.md', async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
    });
    const second = controller.runForIdentity('file:///same.md', async () => {
      events.push('second');
    });

    await vi.waitFor(() => expect(releaseFirst).toBeDefined());
    expect(events).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });
});
