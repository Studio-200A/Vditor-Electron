export interface SidebarViewControllerOptions {
  readonly navigation: HTMLElement;
  readonly views: readonly HTMLElement[];
  readonly onOutlineSelected: () => void;
}

/** Owns Files/Outline navigation state and its application-owned DOM events. */
export class SidebarViewController {
  private readonly onNavigationClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('button[data-view]');
    if (!button || !this.options.navigation.contains(button)) return;
    this.select(button.dataset.view);
  };

  constructor(private readonly options: SidebarViewControllerOptions) {}

  init(): void {
    this.options.navigation.addEventListener('click', this.onNavigationClick);
  }

  dispose(): void {
    this.options.navigation.removeEventListener('click', this.onNavigationClick);
  }

  private select(viewName: string | undefined): void {
    if (viewName !== 'files' && viewName !== 'outline') return;
    this.options.navigation
      .querySelectorAll<HTMLButtonElement>('button[data-view]')
      .forEach((button) => {
        const isSelected = button.dataset.view === viewName;
        button.classList.toggle('active', isSelected);
        button.setAttribute('aria-selected', String(isSelected));
      });
    this.options.views.forEach((view) =>
      view.classList.toggle('active', view.id === `${viewName}View`),
    );
    if (viewName === 'outline') this.options.onOutlineSelected();
  }
}
