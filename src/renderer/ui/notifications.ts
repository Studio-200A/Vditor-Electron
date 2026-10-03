import type { SupportedLocale, VditorDesktopLocales } from '../types/locales.js';

export interface DialogAction {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface ConfirmDialogCheckbox {
  label: string;
  checked?: boolean;
}

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  /** A filename embedded in `message` that should remain readable without widening the dialog. */
  messageFileName?: string;
  detail?: string;
  actions?: DialogAction[];
  draggable?: boolean;
  checkbox?: ConfirmDialogCheckbox;
  onAction?: (action: string, checkboxChecked: boolean) => void;
}

const MESSAGE_DURATION_MS = 4500;
const NOTICE_DURATION_MS = 5000;
const NOTICE_LIMIT = 3;
const NOTICE_EXIT_FALLBACK_MS = 250;

interface NoticeEntry {
  element: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  exitTimer: ReturnType<typeof setTimeout> | null;
  onTransitionEnd: ((event: TransitionEvent) => void) | null;
}

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
  private readonly _notices = new Set<NoticeEntry>();
  private _confirmResolver: ((action: string) => void) | null = null;
  private _confirmAction: ((action: string, checkboxChecked: boolean) => void) | null = null;
  private _confirmCheckbox: HTMLInputElement | null = null;
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
    this._dragCleanup?.();
    this._dragCleanup = this._setupConfirmDialogDrag();
  }

  dispose(): void {
    if (this._messageTimer !== null) {
      clearTimeout(this._messageTimer);
      this._messageTimer = null;
    }
    for (const entry of this._notices) this._removeNotice(entry);
    if (this._confirmResolver) {
      this._confirmResolver('cancel');
      this._confirmResolver = null;
    }
    if (this._dragCleanup) {
      this._dragCleanup();
      this._dragCleanup = null;
    }
    const status = document.getElementById('statusMessage');
    if (status) {
      status.textContent = '';
      status.classList.remove('error');
    }
    document.getElementById('temporaryDocumentNotice')?.classList.add('hidden');
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

  showNotice(message: string, error = false): void {
    const previous = document.getElementById('temporaryDocumentNotice');
    if (!previous?.parentElement) return;
    const notice = document.createElement('section');
    notice.id = 'temporaryDocumentNotice';
    notice.className = 'temporary-document-notice';
    const icon = document.createElement('img');
    icon.className = 'temporary-document-notice-icon';
    icon.alt = '';
    const msgEl = document.createElement('span');
    msgEl.id = 'temporaryDocumentNoticeMessage';
    msgEl.textContent = message;
    notice.classList.toggle('error', error);
    notice.setAttribute('role', error ? 'alert' : 'status');
    icon.setAttribute(
      'src',
      error ? 'assets/notification/warning.svg' : 'assets/notification/notification.svg',
    );
    notice.append(icon, msgEl);
    previous.removeAttribute('id');
    previous.querySelector('#temporaryDocumentNoticeMessage')?.removeAttribute('id');
    previous.before(notice);
    if (![...this._notices].some((entry) => entry.element === previous)) previous.remove();
    const entry: NoticeEntry = {
      element: notice,
      timer: setTimeout(() => this._hideNotice(entry), NOTICE_DURATION_MS),
      exitTimer: null,
      onTransitionEnd: null,
    };
    this._notices.add(entry);
    const active = [...this._notices].filter((item) => !item.element.classList.contains('hidden'));
    if (active.length > NOTICE_LIMIT) this._hideNotice(active[0]);
  }

  private _hideNotice(entry: NoticeEntry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.element.classList.add('hidden');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this._removeNotice(entry);
      return;
    }
    entry.onTransitionEnd = (event) => {
      if (event.target === entry.element && event.propertyName === 'opacity') {
        this._removeNotice(entry);
      }
    };
    entry.element.addEventListener('transitionend', entry.onTransitionEnd);
    // A notice hidden before its first paint may never start a CSS transition.
    entry.exitTimer = setTimeout(() => this._removeNotice(entry), NOTICE_EXIT_FALLBACK_MS);
  }

  private _removeNotice(entry: NoticeEntry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    if (entry.exitTimer !== null) clearTimeout(entry.exitTimer);
    if (entry.onTransitionEnd) {
      entry.element.removeEventListener('transitionend', entry.onTransitionEnd);
    }
    entry.element.classList.add('hidden');
    // Retain the newest hidden element as the insertion point for the next notice.
    if (entry.element.id !== 'temporaryDocumentNotice') entry.element.remove();
    this._notices.delete(entry);
  }

  async showConfirmDialog(options: ConfirmDialogOptions): Promise<string> {
    if (this._confirmResolver) this.closeConfirmDialog('cancel');

    const { title, message, messageFileName, detail, draggable = false, checkbox } = options;
    const actions = options.actions ?? [
      { id: 'cancel', label: this._t('dialog.cancel') },
      { id: 'confirm', label: this._t('dialog.continue'), primary: true },
    ];

    this.setConfirmDialogDraggable(draggable);

    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const detailEl = document.getElementById('confirmDetail');
    const extraEl = document.getElementById('confirmExtra');
    const actionsEl = document.getElementById('confirmActions');
    const modal = document.getElementById('confirmModal');
    if (!titleEl || !messageEl || !detailEl || !extraEl || !actionsEl || !modal) {
      throw new Error('Confirm dialog DOM is unavailable');
    }

    titleEl.textContent = title || this._t('dialog.confirmTitle');
    this._renderConfirmMessage(messageEl, message || '', messageFileName);
    detailEl.textContent = detail ?? '';
    extraEl.replaceChildren();
    this._confirmCheckbox = null;
    if (checkbox) {
      const label = document.createElement('label');
      label.className = 'confirm-checkbox';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checkbox.checked ?? false;
      const text = document.createElement('span');
      text.textContent = checkbox.label;
      label.append(input, text);
      extraEl.append(label);
      this._confirmCheckbox = input;
    }
    this._confirmAction = options.onAction ?? null;

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
    const extraEl = document.getElementById('confirmExtra');
    if (extraEl) extraEl.replaceChildren();
    const checkboxChecked = this._confirmCheckbox?.checked ?? false;
    const onAction = this._confirmAction;
    this._confirmCheckbox = null;
    this._confirmAction = null;
    this.setConfirmDialogDraggable(false);
    onAction?.(action, checkboxChecked);
    resolver(action);
  }

  async confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    const result = await this.showConfirmDialog(options);
    return result === 'confirm';
  }

  async showUnsavedDialog(message: string, detail = '', messageFileName?: string): Promise<string> {
    return this.showConfirmDialog({
      title: this._t('dialog.unsavedTitle'),
      message,
      messageFileName,
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

  private _renderConfirmMessage(
    messageEl: HTMLElement,
    message: string,
    messageFileName?: string,
  ): void {
    if (!messageFileName) {
      messageEl.textContent = message;
      return;
    }

    const fileNameIndex = message.indexOf(messageFileName);
    if (fileNameIndex === -1) {
      messageEl.textContent = message;
      return;
    }

    const fileNameEnd = fileNameIndex + messageFileName.length;
    const fileNameEl = document.createElement('span');
    fileNameEl.className = 'confirm-message-file-name';
    fileNameEl.textContent = messageFileName;
    fileNameEl.title = messageFileName;
    messageEl.replaceChildren(
      document.createTextNode(message.slice(0, fileNameIndex)),
      fileNameEl,
      document.createTextNode(message.slice(fileNameEnd)),
    );
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
