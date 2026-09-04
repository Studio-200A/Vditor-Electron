export interface MenuActionItem {
  readonly label: string;
  readonly action: () => void;
  readonly shortcut?: string;
  readonly checked?: () => boolean;
  readonly disabled?: () => boolean;
}

export interface MenuSubmenuItem {
  readonly label: string;
  readonly children: readonly MenuItem[];
  readonly keepOpen?: boolean;
  readonly disabled?: () => boolean;
}

export type MenuItem = MenuActionItem | MenuSubmenuItem | null;

export interface MenuControllerOptions {
  readonly menuBar: HTMLElement;
  readonly titlebar: HTMLElement;
  readonly toggleSidebar: HTMLElement | null;
  readonly translate: (key: string) => string;
  readonly getMenu: (name: string) => readonly MenuItem[];
  readonly onPopupCreated: (popup: HTMLElement) => void;
}

function isSubmenu(item: MenuItem): item is MenuSubmenuItem {
  return item !== null && 'children' in item;
}

/** Owns application-menu popup DOM, checked-state rendering, and listener cleanup. */
export class MenuController {
  private readonly options: MenuControllerOptions;
  private reopenOnHover = false;
  private readonly onDocumentClick = () => this.close();
  private readonly onWindowBlur = () => this.close();

  constructor(options: MenuControllerOptions) {
    this.options = options;
  }

  init(): void {
    this.close();
    this.options.menuBar.dataset.ready = 'true';
    this.options.menuBar
      .querySelectorAll<HTMLButtonElement>(':scope > button[data-menu]')
      .forEach((trigger) => {
        trigger.onclick = (event) => {
          event.stopPropagation();
          if (trigger.classList.contains('active')) this.close();
          else this.open(trigger);
        };
        trigger.onmouseenter = () => {
          const active =
            this.options.menuBar.querySelector<HTMLButtonElement>(':scope > button.active');
          if (this.reopenOnHover || (active && active !== trigger)) {
            this.reopenOnHover = false;
            this.open(trigger);
          }
        };
      });
    if (this.options.toggleSidebar) {
      this.options.toggleSidebar.onmouseenter = () => {
        if (this.options.menuBar.querySelector(':scope > button.active')) {
          this.close();
          this.reopenOnHover = true;
        }
      };
    }
    document.addEventListener('click', this.onDocumentClick);
    window.addEventListener('blur', this.onWindowBlur);
  }

  close(): void {
    document.querySelectorAll('.app-menu-popup').forEach((popup) => popup.remove());
    this.options.menuBar
      .querySelectorAll(':scope > button')
      .forEach((button) => button.classList.remove('active'));
    this.options.titlebar.classList.remove('app-menu-open');
    this.reopenOnHover = false;
  }

  dispose(): void {
    this.close();
    this.options.menuBar
      .querySelectorAll<HTMLButtonElement>(':scope > button[data-menu]')
      .forEach((trigger) => {
        trigger.onclick = null;
        trigger.onmouseenter = null;
      });
    if (this.options.toggleSidebar) this.options.toggleSidebar.onmouseenter = null;
    document.removeEventListener('click', this.onDocumentClick);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  private open(trigger: HTMLButtonElement): void {
    this.close();
    trigger.classList.add('active');
    this.options.titlebar.classList.add('app-menu-open');
    const popup = document.createElement('div');
    popup.className = 'app-menu-popup';
    this.fillPopup(popup, this.options.getMenu(trigger.dataset.menu ?? ''));
    document.body.appendChild(popup);
    const rect = trigger.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom}px`;
  }

  private fillPopup(popup: HTMLElement, items: readonly MenuItem[]): void {
    for (const item of items) {
      if (!item) {
        popup.appendChild(document.createElement('hr'));
        continue;
      }
      const button = document.createElement('button');
      if (isSubmenu(item)) {
        button.className = 'has-submenu';
        button.disabled = item.disabled?.() ?? false;
        this.appendLabel(button, item.label, undefined, null);
        const openSubmenu = (event: Event) => {
          if (button.disabled) return;
          event.stopPropagation();
          document.querySelectorAll('.app-menu-popup.submenu').forEach((menu) => menu.remove());
          const submenu = document.createElement('div');
          submenu.className = 'app-menu-popup submenu';
          submenu.dataset.keepOpen = String(Boolean(item.keepOpen));
          this.fillPopup(submenu, item.children);
          document.body.appendChild(submenu);
          const rect = button.getBoundingClientRect();
          submenu.style.left = `${Math.min(rect.right, window.innerWidth - submenu.offsetWidth - 4)}px`;
          submenu.style.top = `${Math.min(rect.top - 5, window.innerHeight - submenu.offsetHeight - 4)}px`;
        };
        button.onmouseenter = openSubmenu;
        button.onclick = openSubmenu;
      } else {
        const disabled = item.disabled?.() ?? false;
        button.disabled = disabled;
        this.appendLabel(
          button,
          item.label,
          item.shortcut,
          disabled ? null : (item.checked?.() ?? null),
        );
        button.onmouseenter = () => {
          if (!popup.classList.contains('submenu'))
            document.querySelectorAll('.app-menu-popup.submenu').forEach((menu) => menu.remove());
        };
        button.onclick = (event) => {
          event.stopPropagation();
          item.action();
          if (popup.dataset.keepOpen === 'true') this.refreshChecks(popup, items);
          else this.close();
        };
      }
      popup.appendChild(button);
    }
    this.options.onPopupCreated(popup);
  }

  private appendLabel(
    button: HTMLButtonElement,
    key: string,
    shortcut: string | undefined,
    checked: boolean | null,
  ): void {
    const label = document.createElement('span');
    const checkmark = document.createElement('i');
    checkmark.className = 'checkmark';
    checkmark.textContent = checked === null ? '' : checked ? '✓' : '';
    label.append(checkmark, document.createTextNode(this.options.translate(key)));
    button.appendChild(label);
    const shortcutNode = document.createElement('small');
    shortcutNode.textContent = shortcut ?? '';
    button.appendChild(shortcutNode);
  }

  private refreshChecks(popup: HTMLElement, items: readonly MenuItem[]): void {
    popup.querySelectorAll<HTMLButtonElement>(':scope > button').forEach((button, index) => {
      const item = items.filter((candidate) => candidate !== null)[index];
      if (!item || isSubmenu(item)) return;
      const checkmark = button.querySelector('.checkmark');
      if (checkmark && item.checked) checkmark.textContent = item.checked() ? '✓' : '';
    });
  }
}
