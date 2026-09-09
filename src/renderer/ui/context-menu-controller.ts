export interface ContextMenuItem {
  readonly id?: string;
  readonly label?: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly separator?: boolean;
  readonly action?: (state: unknown) => void | Promise<void>;
}

/** Owns the application context-menu DOM; callers retain their domain-specific actions. */
export class ContextMenuController {
  private readonly menu: HTMLElement;
  private readonly closeApplicationMenu: () => void;
  private state: unknown = null;

  constructor(menu: HTMLElement, closeApplicationMenu: () => void) {
    this.menu = menu;
    this.closeApplicationMenu = closeApplicationMenu;
  }

  show(event: MouseEvent, items: readonly ContextMenuItem[], state: unknown = null): void {
    this.closeApplicationMenu();
    this.close();
    this.state = state;
    for (const item of items) {
      if (item.separator) {
        this.menu.appendChild(document.createElement('hr'));
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.contextAction = item.id ?? '';
      button.disabled = Boolean(item.disabled);
      const label = document.createElement('span');
      label.textContent = item.label ?? '';
      button.appendChild(label);
      if (item.shortcut) {
        const shortcut = document.createElement('small');
        shortcut.textContent = item.shortcut;
        button.appendChild(shortcut);
      }
      button.addEventListener('pointerdown', (pointerEvent) => {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
      });
      button.addEventListener('mousedown', (mouseEvent) => mouseEvent.preventDefault());
      button.addEventListener('click', (clickEvent) => {
        clickEvent.stopPropagation();
        const savedState = this.state;
        this.close();
        if (!button.disabled) void item.action?.(savedState);
      });
      this.menu.appendChild(button);
    }
    this.menu.style.visibility = 'hidden';
    this.menu.classList.remove('hidden');
    const margin = 6;
    this.menu.style.left = `${Math.max(margin, Math.min(event.clientX, window.innerWidth - this.menu.offsetWidth - margin))}px`;
    this.menu.style.top = `${Math.max(margin, Math.min(event.clientY, window.innerHeight - this.menu.offsetHeight - margin))}px`;
    this.menu.style.visibility = '';
  }

  close(): void {
    this.menu.classList.add('hidden');
    this.menu.replaceChildren();
    this.state = null;
  }

  isOpen(): boolean {
    return !this.menu.classList.contains('hidden');
  }

  dispose(): void {
    this.close();
  }
}
