import { describe, expect, it, vi } from 'vitest';
import { DocumentFeedback } from '../../../src/renderer/documents/document-feedback';
import type { SaveWorkflowMessageKind } from '../../../src/renderer/documents/document-save-external-workflow-controller';
import { en_US } from '../../../src/renderer/locale/en_US';
import { zh_Hans } from '../../../src/renderer/locale/zh_Hans';
import { zh_Hant } from '../../../src/renderer/locale/zh_Hant';
import { formatIpcErrorMessage, translate } from '../../../src/renderer/ui/localization';
import type { SupportedLocale } from '../../../src/renderer/types/locales';

const locales = { en_US, zh_Hans, zh_Hant };

function fixture(locale: SupportedLocale = 'en_US') {
  const showStatus = vi.fn();
  const showNotice = vi.fn();
  const feedback = new DocumentFeedback({
    translate: (key, params) => translate(locales, locale, key, params),
    formatError: (error) => formatIpcErrorMessage(error, locales, locale),
    showStatus,
    showNotice,
  });
  return { feedback, showStatus, showNotice };
}

describe('DocumentFeedback', () => {
  it.each(['en_US', 'zh_Hans', 'zh_Hant'] as const)(
    'presents localized open and write failures in %s',
    (locale) => {
      const { feedback, showNotice, showStatus } = fixture(locale);
      feedback.showOpenFailure(new Error('IPC_NOT_FOUND'));
      expect(showNotice).toHaveBeenLastCalledWith(
        translate(locales, locale, 'message.openFailed', {
          error: translate(locales, locale, 'message.ipcNotFound'),
        }),
        true,
      );
      feedback.showSaveResult('save-failed', { title: 'note.md' });
      expect(showNotice).toHaveBeenLastCalledWith(
        locales[locale]['message.saveFailedGeneric'],
        true,
      );
      feedback.showSaveResult(
        'save-failed',
        { title: 'note.md' },
        new Error('IPC_PERMISSION_DENIED'),
      );
      expect(showNotice).toHaveBeenLastCalledWith(
        translate(locales, locale, 'message.saveFailed', {
          error: translate(locales, locale, 'message.ipcPermissionDenied'),
        }),
        true,
      );
      expect(showStatus).not.toHaveBeenCalled();
    },
  );

  it.each<[SaveWorkflowMessageKind, string]>([
    ['path-open', 'message.savePathAlreadyOpen'],
    ['resolve-file-state', 'external.resolveFileStateBeforeSave'],
    ['resolve-conflict', 'external.resolveBeforeSave'],
    ['changed-again', 'external.changedAgain'],
    ['permission-denied', 'message.savePermissionDenied'],
  ])('presents %s as an error notice', (kind, key) => {
    const { feedback, showNotice, showStatus } = fixture();
    feedback.showSaveResult(kind, { title: 'note.md' });
    expect(showNotice).toHaveBeenCalledWith(
      translate(locales, 'en_US', key, {
        title: 'note.md',
        name: 'note.md',
      }),
      true,
    );
    expect(showStatus).not.toHaveBeenCalled();
  });

  it.each<[SaveWorkflowMessageKind, string]>([
    ['saved', 'message.saved'],
    ['reloaded', 'external.reloaded'],
    ['ignored', 'external.ignored'],
  ])('keeps %s in the status bar', (kind, key) => {
    const { feedback, showNotice, showStatus } = fixture();
    feedback.showSaveResult(kind, { title: 'note.md' });
    expect(showStatus).toHaveBeenCalledWith(
      translate(locales, 'en_US', key, {
        title: 'note.md',
        name: 'note.md',
      }),
      false,
    );
    expect(showNotice).not.toHaveBeenCalled();
  });

  it.each(['recreated', 'recreated-copied', 'recreated-clipboard-failed'] as const)(
    'presents one notice for %s after the status result',
    (kind) => {
      const { feedback, showNotice, showStatus } = fixture();
      feedback.showSaveResult(kind, { title: 'note.md' });
      expect(showNotice).not.toHaveBeenCalled();
      feedback.showRecreateNotice(kind);
      expect(showNotice).toHaveBeenCalledTimes(1);
      expect(showNotice).toHaveBeenCalledWith(
        showStatus.mock.calls[0][0],
        kind === 'recreated-clipboard-failed',
      );
    },
  );
});
