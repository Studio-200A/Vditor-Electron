export interface TabViewModel {
  readonly id: string;
  readonly title: string;
  readonly filePath: string | null;
  readonly modified: boolean;
  readonly needsAttention: boolean;
}

export interface TabControllerCallbacks {
  activate(id: string): void;
  close(id: string): void;
  move(id: string, beforeId: string, placeAfter: boolean): void;
}

export interface TabControllerOptions {
  readonly tabBar: HTMLElement;
  readonly addTab: HTMLElement;
  readonly getAttentionTitle: (tab: TabViewModel) => string;
  readonly getCloseTitle: () => string;
  readonly callbacks: TabControllerCallbacks;
}

/** Renders document tabs and owns only their pointer/click interaction. */
export class TabController {
  private readonly tabBar: HTMLElement;
  private readonly addTab: HTMLElement;
  private readonly getAttentionTitle: (tab: TabViewModel) => string;
  private readonly getCloseTitle: () => string;
  private readonly callbacks: TabControllerCallbacks;
  private draggedTabId: string | null = null;
  private dragPointerId: number | null = null;
  private dragGhost: HTMLElement | null = null;
  private draggedButton: HTMLButtonElement | null = null;
  private hasMoved = false;
  private activeTabScrollFrame: number | null = null;
  private dragResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TabControllerOptions) {
    this.tabBar = options.tabBar;
    this.addTab = options.addTab;
    this.getAttentionTitle = options.getAttentionTitle;
    this.getCloseTitle = options.getCloseTitle;
    this.callbacks = options.callbacks;
  }

  render(tabs: readonly TabViewModel[], activeId: string | null): void {
    this.tabBar.querySelectorAll('.document-tab').forEach((node) => node.remove());
    for (const tab of tabs) {
      this.tabBar.insertBefore(this.createTabButton(tab, activeId === tab.id), this.addTab);
    }
    this.scheduleActiveTabScroll();
  }

  dispose(): void {
    if (this.activeTabScrollFrame !== null) cancelAnimationFrame(this.activeTabScrollFrame);
    if (this.dragResetTimer !== null) clearTimeout(this.dragResetTimer);
    this.activeTabScrollFrame = null;
    this.dragResetTimer = null;
    this.clearDragState();
  }

  private createTabButton(tab: TabViewModel, isActive: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `document-tab${isActive ? ' active' : ''}`;
    button.dataset.id = tab.id;
    button.title = tab.filePath || tab.title;

    const title = document.createElement('span');
    title.textContent = tab.title;
    button.append(title);
    if (tab.needsAttention) {
      const attention = document.createElement('i');
      attention.className = 'conflict';
      attention.title = this.getAttentionTitle(tab);
      attention.textContent = '!';
      button.append(attention);
    }
    const dirty = document.createElement('i');
    dirty.className = 'dirty';
    dirty.textContent = tab.modified ? '●' : '';
    button.append(dirty);
    const close = document.createElement('b');
    close.title = this.getCloseTitle();
    close.textContent = '×';
    button.append(close);

    button.addEventListener('click', (event) => {
      if (this.hasMoved) return;
      if (event.target instanceof Element && event.target.closest('b'))
        this.callbacks.close(tab.id);
      else this.callbacks.activate(tab.id);
    });
    button.addEventListener('auxclick', (event) => {
      if (event.button === 1) this.callbacks.close(tab.id);
    });
    button.addEventListener('pointerdown', (event) => this.startDrag(event, button, tab.id));
    button.addEventListener('pointermove', (event) => this.updateDrag(event));
    button.addEventListener('pointerup', (event) => this.finishDrag(event));
    return button;
  }

  private startDrag(event: PointerEvent, button: HTMLButtonElement, id: string): void {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('b')))
      return;
    this.draggedTabId = id;
    this.dragPointerId = event.pointerId;
    this.draggedButton = button;
    button.setPointerCapture(event.pointerId);
  }

  private updateDrag(event: PointerEvent): void {
    if (!this.draggedTabId || event.pointerId !== this.dragPointerId) return;
    if (!this.hasMoved && Math.abs(event.movementX) + Math.abs(event.movementY) > 3) {
      this.hasMoved = true;
      this.draggedButton?.classList.add('dragging');
      this.dragGhost = this.draggedButton?.cloneNode(true) as HTMLElement | null;
      if (this.dragGhost) {
        this.dragGhost.className = 'document-tab tab-drag-ghost';
        document.body.append(this.dragGhost);
      }
    }
    if (this.dragGhost) {
      this.dragGhost.style.left = `${event.clientX}px`;
      this.dragGhost.style.top = `${event.clientY}px`;
    }
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.document-tab');
    this.tabBar
      .querySelectorAll('.document-tab.drag-over')
      .forEach((node) => node.classList.remove('drag-over'));
    if (target && target.dataset.id !== this.draggedTabId) {
      const bounds = target.getBoundingClientRect();
      target.dataset.dropSide = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
      target.classList.add('drag-over');
    }
  }

  private finishDrag(event: PointerEvent): void {
    if (!this.draggedTabId || event.pointerId !== this.dragPointerId) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.document-tab');
    const targetId = target?.dataset.id;
    if (targetId && targetId !== this.draggedTabId) {
      this.callbacks.move(this.draggedTabId, targetId, target?.dataset.dropSide === 'after');
    }
    this.clearDragState();
    this.dragResetTimer = setTimeout(() => {
      this.dragResetTimer = null;
      this.hasMoved = false;
    }, 0);
  }

  private clearDragState(): void {
    this.dragGhost?.remove();
    this.dragGhost = null;
    this.tabBar
      .querySelectorAll('.document-tab.dragging, .document-tab.drag-over')
      .forEach((node) => {
        node.classList.remove('dragging', 'drag-over');
      });
    this.draggedTabId = null;
    this.dragPointerId = null;
    this.draggedButton = null;
  }

  private scheduleActiveTabScroll(): void {
    if (this.activeTabScrollFrame !== null) cancelAnimationFrame(this.activeTabScrollFrame);
    this.activeTabScrollFrame = requestAnimationFrame(() => {
      this.activeTabScrollFrame = requestAnimationFrame(() => {
        this.activeTabScrollFrame = null;
        this.tabBar.querySelector('.document-tab.active')?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        });
      });
    });
  }
}
