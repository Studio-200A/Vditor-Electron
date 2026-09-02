import type { SupportedLocale, VditorDesktopLocales } from '../types/locales.js';

export interface DialogAction {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  detail?: string;
  actions?: DialogAction[];
  draggable?: boolean;
}

const MESSAGE_DURATION_MS = 4500;
const NOTICE_DURATION_MS = 5000;

export class NotificationsController {
  private readonly _translate: (
    locales: VditorDesktopLocales,
    locale: SupportedLocale,
    key: string,
    params?: Record<string, string | number>,
  ) => string;
  private readonly _locales: VditorDesktopLocales;
  private _locale: SupportedLocale;
  private _messageTimer: ReturnType<typeof setTimeout> | null = null;
  private _noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private _confirmResolver: ((action: string) => void) | null = null;
  private _dragCleanup: (() => void) | null = null;

  constructor(
    translate: (
      locales: VditorDesktopLocales,
      locale: SupportedLocale,
      key: string,
      params?: Record<string, string | number>,
    ) => string,
    locales: VditorDesktopLocales,
    locale: SupportedLocale,
  ) {
    this._translate = translate;
    this._locales = locales;
    this._locale = locale;
  }

  setLocale(locale: SupportedLocale): void {
    this._locale = locale;
  }

  init(): void {
    this._dragCleanup = this._setupConfirmDialogDrag();
  }

  dispose(): void {
    if (this._messageTimer !== null) {
      clearTimeout(this._messageTimer);
      this._messageTimer = null;
    }
    if (this._noticeTimer !== null) {
      clearTimeout(this._noticeTimer);
      this._noticeTimer = null;
    }
    if (this._confirmResolver) {
      this._confirmResolver('cancel');
      this._confirmResolver = null;
    }
    if (this._dragCleanup) {
      this._dragCleanup();
      this._dragCleanup = null;
    }
  }

  showMessage(message: string, error = false): void {
    const el = document.getElementById('statusMessage');
    if (!el) return;
    if (this._messageTimer !== null) clearTimeout(this._messageTimer);
    el.textContent = message;
    el.classList.toggle('error', error);
    this._messageTimer = setTimeout(() => {
      el.textContent = '';
      el.classList.remove('error');
      this._messageTimer = null;
    }, MESSAGE_DURATION_MS);
  }

  showTemporaryDocumentNotice(message: string, error = false): void {
    const notice = document.getElementById('temporaryDocumentNotice');
    const msgEl = document.getElementById('temporaryDocumentNoticeMessage');
    if (!notice || !msgEl) return;
    if (this._noticeTimer !== null) clearTimeout(this._noticeTimer);
    msgEl.textContent = message;
    notice.classList.toggle('error', error);
    notice.classList.remove('hidden');
    this._noticeTimer = setTimeout(() => {
      notice.classList.add('hidden');
      notice.classList.remove('error');
      this._noticeTimer = null;
    }, NOTICE_DURATION_MS);
  }

  async showConfirmDialog(options: ConfirmDialogOptions): Promise<string> {
    if (this._confirmResolver) this.closeConfirmDialog('cancel');

    const { title, message, detail, draggable = false } = options;
    const actions = options.actions ?? [
      { id: 'cancel', label: this._t('dialog.cancel') },
      { id: 'confirm', label: this._t('dialog.continue'), primary: true },
    ];

    this.setConfirmDialogDraggable(draggable);

    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const detailEl = document.getElementById('confirmDetail');
    const actionsEl = document.getElementById('confirmActions');
    const modal = document.getElementById('confirmModal');
    if (!titleEl || !messageEl || !detailEl || !actionsEl || !modal) {
      throw new Error('Confirm dialog DOM is unavailable');
    }

    titleEl.textContent = title || this._t('dialog.confirmTitle');
    messageEl.textContent = message || '';
    detailEl.textContent = detail ?? '';

    actionsEl.replaceChildren(
      ...actions.map((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.dataset.action = action.id;
        if (action.primary) button.classList.add('primary');
        if (action.danger) button.classList.add('danger');
        button.addEventListener('click', () => this.closeConfirmDialog(action.id));
        return button;
      }),
    );

    modal.classList.remove('hidden');

    return new Promise<string>((resolve) => {
      this._confirmResolver = resolve;
      requestAnimationFrame(() => {
        const primary = actionsEl.querySelector('button.primary') as HTMLElement | null;
        const first = actionsEl.querySelector('button') as HTMLElement | null;
        (primary ?? first)?.focus();
      });
    });
  }

  closeConfirmDialog(action = 'cancel'): void {
    const resolver = this._confirmResolver;
    if (!resolver) return;
    this._confirmResolver = null;

    const modal = document.getElementById('confirmModal');
    const actionsEl = document.getElementById('confirmActions');
    if (modal) modal.classList.add('hidden');
    if (actionsEl) actionsEl.replaceChildren();
    this.setConfirmDialogDraggable(false);
    resolver(action);
  }

  async confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    const result = await this.showConfirmDialog(options);
    return result === 'confirm';
  }

  async showUnsavedDialog(message: string, detail = ''): Promise<string> {
    return this.showConfirmDialog({
      title: this._t('dialog.unsavedTitle'),
      message,
      detail,
      draggable: true,
      actions: [
        { id: 'cancel', label: this._t('dialog.cancel') },
        { id: 'discard', label: this._t('dialog.dontSave') },
        { id: 'save', label: this._t('dialog.save'), primary: true },
      ],
    });
  }

  setConfirmDialogDraggable(draggable: boolean): void {
    const card = document.querySelector('#confirmModal .confirm-card');
    if (!card) return;
    card.classList.toggle('confirm-card-draggable', draggable);
    if (card instanceof HTMLElement) {
      card.style.removeProperty('position');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
    }
  }

  private _t(key: string, params?: Record<string, string | number>): string {
    return this._translate(this._locales, this._locale, key, params);
  }

  private _setupConfirmDialogDrag(): () => void {
    const modal = document.getElementById('confirmModal');
    const card = modal?.querySelector('.confirm-card');
    const header =
      card instanceof HTMLElement ? card.querySelector<HTMLElement>(':scope > header') : null;
    if (!modal || !card || !(card instanceof HTMLElement) || !header) {
      return () => {};
    }

    const clamp = (value: number, minimum: number, maximum: number) =>
      Math.min(maximum, Math.max(minimum, value));
    const setPosition = (left: number, top: number) => {
      const maximumLeft = Math.max(0, modal.clientWidth - card.offsetWidth);
      const maximumTop = Math.max(0, modal.clientHeight - card.offsetHeight);
      card.style.left = `${Math.round(clamp(left, 0, maximumLeft))}px`;
      card.style.top = `${Math.round(clamp(top, 0, maximumTop))}px`;
    };

    const onHeaderMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !card.classList.contains('confirm-card-draggable')) return;
      event.preventDefault();
      const modalBounds = modal.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      card.style.position = 'absolute';
      setPosition(cardBounds.left - modalBounds.left, cardBounds.top - modalBounds.top);
      const offsetX = event.clientX - cardBounds.left;
      const offsetY = event.clientY - cardBounds.top;
      document.body.classList.add('confirm-card-dragging');
      const move = (moveEvent: MouseEvent) => {
        setPosition(
          moveEvent.clientX - modalBounds.left - offsetX,
          moveEvent.clientY - modalBounds.top - offsetY,
        );
      };
      const up = () => {
        document.body.classList.remove('confirm-card-dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    const onResize = () => {
      if (card.style.position !== 'absolute') return;
      setPosition(Number.parseFloat(card.style.left) || 0, Number.parseFloat(card.style.top) || 0);
    };

    header.addEventListener('mousedown', onHeaderMouseDown);
    window.addEventListener('resize', onResize);

    return () => {
      header.removeEventListener('mousedown', onHeaderMouseDown);
      window.removeEventListener('resize', onResize);
    };
  }
}
