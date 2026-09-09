import { describe, expect, it } from 'vitest';
import { ExternalChangeController } from '../../../src/renderer/documents/external-change-controller';

describe('ExternalChangeController', () => {
  const controller = new ExternalChangeController();
  const baseline = {
    hasUnavailableState: false,
    expectedSavedContent: 'saved',
    modified: false,
    externalChangeIgnored: false,
    hasFilePath: true,
    content: 'saved',
  };

  it('keeps a matching watcher event out of conflict handling', () => {
    expect(controller.classify(baseline)).toBe('matches-baseline');
  });

  it('reloads a clean document with changed stable disk content', () => {
    expect(controller.classify({ ...baseline, content: 'external' })).toBe('reload-clean-document');
  });

  it('creates a conflict for local edits or an ignored external change', () => {
    expect(controller.classify({ ...baseline, content: 'external', modified: true })).toBe(
      'create-conflict',
    );
    expect(
      controller.classify({ ...baseline, content: 'external', externalChangeIgnored: true }),
    ).toBe('create-conflict');
  });

  it('keeps newly readable files in the explicit reappearance path', () => {
    expect(
      controller.classify({ ...baseline, hasUnavailableState: true, content: 'external' }),
    ).toBe('reappeared');
  });
});
