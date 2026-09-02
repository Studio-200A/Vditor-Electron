import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsController } from '../../../src/renderer/ui/notifications';
import type { SupportedLocale, VditorDesktopLocales } from '../../../src/renderer/types/locales';

const locales: VditorDesktopLocales = {
  en_US: {
    dialog: {
      confirmTitle: 'Confirm',
      cancel: 'Cancel',
      continue: 'Continue',
      unsavedTitle: 'Unsaved Changes',
      dontSave: "Don't Save",
      save: 'Save',
    },
  },
  zh_Hans: { dialog: {} } as Record<string, unknown>,
  zh_Hant: { dialog: {} } as Record<string, unknown>,
} as VditorDesktopLocales;

function translateFn(locs: VditorDesktopLocales, locale: SupportedLocale, key: string): string {
  const parts = key.split('.');
  let node: unknown = locs[locale];
  for (const part of parts) {
    if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part];
    else return key;
  }
  return typeof node === 'string' ? node : key;
}

describe('NotificationsController', () => {
  let document: Document;
  let controller: NotificationsController;

  beforeEach(() => {
    const dom = new JSDOM(
      `<!doctype html>
<html>
<body>
  <span id="statusMessage"></span>
  <section id="temporaryDocumentNotice" class="hidden">
    <span id="temporaryDocumentNoticeMessage"></span>
  </section>
  <div id="confirmModal" class="hidden" role="alertdialog" aria-labelledby="confirmTitle" aria-describedby="confirmMessage confirmDetail">
    <div class="confirm-card">
      <header><h2 id="confirmTitle"></h2></header>
      <div class="confirm-content">
        <p id="confirmMessage"></p>
        <p id="confirmDetail"></p>
      </div>
      <footer id="confirmActions"></footer>
    </div>
  </div>
</body>
</html>`,
      { url: 'http://localhost/' },
    );
    document = dom.window.document;
    vi.stubGlobal('document', document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    controller = new NotificationsController(translateFn, locales, 'en_US');
    controller.init();
  });

  afterEach(() => {
    controller.dispose();
    vi.unstubAllGlobals();
  });

  describe('showMessage', () => {
    it('displays a message in the status bar', () => {
      controller.showMessage('Hello');
      const el = document.getElementById('statusMessage');
      expect(el?.textContent).toBe('Hello');
      expect(el?.classList.contains('error')).toBe(false);
    });

    it('applies the error class when error is true', () => {
      controller.showMessage('Fail', true);
      const el = document.getElementById('statusMessage');
      expect(el?.textContent).toBe('Fail');
      expect(el?.classList.contains('error')).toBe(true);
    });

    it('clears the message after the duration', async () => {
      vi.useFakeTimers();
      controller.showMessage('Temp');
      expect(document.getElementById('statusMessage')?.textContent).toBe('Temp');
      vi.advanceTimersByTime(4500);
      expect(document.getElementById('statusMessage')?.textContent).toBe('');
      vi.useRealTimers();
    });

    it('clears the previous timer when called again', () => {
      vi.useFakeTimers();
      controller.showMessage('First');
      controller.showMessage('Second');
      vi.advanceTimersByTime(4500);
      expect(document.getElementById('statusMessage')?.textContent).toBe('');
      vi.useRealTimers();
    });

    it('does nothing when the status message element is missing', () => {
      document.getElementById('statusMessage')?.remove();
      expect(() => controller.showMessage('Hello')).not.toThrow();
    });
  });

  describe('showTemporaryDocumentNotice', () => {
    it('shows the notice with the message', () => {
      controller.showTemporaryDocumentNotice('Notice');
      const notice = document.getElementById('temporaryDocumentNotice');
      const msg = document.getElementById('temporaryDocumentNoticeMessage');
      expect(notice?.classList.contains('hidden')).toBe(false);
      expect(msg?.textContent).toBe('Notice');
    });

    it('applies the error class when error is true', () => {
      controller.showTemporaryDocumentNotice('Error', true);
      const notice = document.getElementById('temporaryDocumentNotice');
      expect(notice?.classList.contains('error')).toBe(true);
    });

    it('hides the notice after the duration', () => {
      vi.useFakeTimers();
      controller.showTemporaryDocumentNotice('Temp');
      expect(document.getElementById('temporaryDocumentNotice')?.classList.contains('hidden')).toBe(
        false,
      );
      vi.advanceTimersByTime(5000);
      expect(document.getElementById('temporaryDocumentNotice')?.classList.contains('hidden')).toBe(
        true,
      );
      vi.useRealTimers();
    });
  });

  describe('showConfirmDialog / closeConfirmDialog', () => {
    it('shows the dialog and resolves with the chosen action', async () => {
      const promise = controller.showConfirmDialog({
        title: 'Test',
        message: 'Are you sure?',
      });
      const modal = document.getElementById('confirmModal');
      expect(modal?.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('confirmTitle')?.textContent).toBe('Test');
      expect(document.getElementById('confirmMessage')?.textContent).toBe('Are you sure?');

      const actions = document.querySelectorAll('#confirmActions button');
      expect(actions.length).toBe(2);
      expect(actions[0]?.textContent?.trim()).toBe('Cancel');
      expect(actions[1]?.textContent?.trim()).toBe('Continue');

      (actions[1] as HTMLElement).click();
      const result = await promise;
      expect(result).toBe('confirm');
      expect(modal?.classList.contains('hidden')).toBe(true);
    });

    it('auto-cancels a previous dialog when a new one opens', async () => {
      const first = controller.showConfirmDialog({ message: 'First' });
      const second = controller.showConfirmDialog({ message: 'Second' });
      expect(await first).toBe('cancel');

      const actions = document.querySelectorAll('#confirmActions button');
      (actions[0] as HTMLElement).click();
      expect(await second).toBe('cancel');
    });

    it('closeConfirmDialog is a no-op when no dialog is open', () => {
      expect(() => controller.closeConfirmDialog('cancel')).not.toThrow();
    });

    it('uses default title from locales when none is provided', async () => {
      const promise = controller.showConfirmDialog({});
      expect(document.getElementById('confirmTitle')?.textContent).toBe('Confirm');
      controller.closeConfirmDialog('cancel');
      await promise;
    });

    it('creates action buttons with primary and danger classes', async () => {
      const promise = controller.showConfirmDialog({
        actions: [
          { id: 'delete', label: 'Delete', primary: true, danger: true },
          { id: 'keep', label: 'Keep' },
        ],
      });
      const buttons = document.querySelectorAll('#confirmActions button');
      expect(buttons[0]?.classList.contains('primary')).toBe(true);
      expect(buttons[0]?.classList.contains('danger')).toBe(true);
      expect(buttons[1]?.classList.contains('primary')).toBe(false);
      controller.closeConfirmDialog('cancel');
      await promise;
    });
  });

  describe('confirmDialog', () => {
    it('returns true when the confirm action is chosen', async () => {
      const promise = controller.confirmDialog({ message: 'OK?' });
      const buttons = document.querySelectorAll('#confirmActions button');
      const confirmBtn = Array.from(buttons).find((b) => b.classList.contains('primary'));
      (confirmBtn as HTMLElement).click();
      expect(await promise).toBe(true);
    });

    it('returns false when cancel is chosen', async () => {
      const promise = controller.confirmDialog({ message: 'OK?' });
      controller.closeConfirmDialog('cancel');
      expect(await promise).toBe(false);
    });
  });

  describe('showUnsavedDialog', () => {
    it('shows three actions: cancel, discard, save', async () => {
      const promise = controller.showUnsavedDialog('You have unsaved changes');
      const buttons = document.querySelectorAll('#confirmActions button');
      expect(buttons.length).toBe(3);
      expect(buttons[0]?.getAttribute('data-action')).toBe('cancel');
      expect(buttons[1]?.getAttribute('data-action')).toBe('discard');
      expect(buttons[2]?.getAttribute('data-action')).toBe('save');
      expect(buttons[2]?.classList.contains('primary')).toBe(true);
      controller.closeConfirmDialog('cancel');
      await promise;
    });

    it('returns the chosen action', async () => {
      const promise = controller.showUnsavedDialog('Changes');
      const saveBtn = document.querySelector('#confirmActions [data-action="save"]') as HTMLElement;
      saveBtn.click();
      expect(await promise).toBe('save');
    });
  });

  describe('setConfirmDialogDraggable', () => {
    it('toggles the draggable class on the confirm card', () => {
      controller.setConfirmDialogDraggable(true);
      const card = document.querySelector('#confirmModal .confirm-card');
      expect(card?.classList.contains('confirm-card-draggable')).toBe(true);
      controller.setConfirmDialogDraggable(false);
      expect(card?.classList.contains('confirm-card-draggable')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('clears pending timers', () => {
      vi.useFakeTimers();
      controller.showMessage('Temp');
      controller.showTemporaryDocumentNotice('Notice');
      controller.dispose();
      vi.advanceTimersByTime(10000);
      vi.useRealTimers();
    });

    it('resolves a pending confirm dialog with cancel', async () => {
      const promise = controller.showConfirmDialog({ message: 'Test' });
      controller.dispose();
      expect(await promise).toBe('cancel');
    });

    it('is idempotent', () => {
      expect(() => {
        controller.dispose();
        controller.dispose();
      }).not.toThrow();
    });
  });
});
