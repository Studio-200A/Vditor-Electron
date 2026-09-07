export interface AppTooltipControllerOptions {
  readonly tooltip: HTMLElement;
  readonly sidebar: HTMLElement;
  readonly window: Pick<Window, 'innerWidth' | 'innerHeight'>;
}

/** Owns the shared application tooltip and sidebar hover listeners. */
export class AppTooltipController {
  private hoveredTarget: HTMLElement | null = null;
  private isInitialized = false;

  constructor(private readonly options: AppTooltipControllerOptions) {}

  init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.options.sidebar.addEventListener('mouseover', this.onMouseOver);
    this.options.sidebar.addEventListener('mousemove', this.onMouseMove);
    this.options.sidebar.addEventListener('mouseout', this.onMouseOut);
  }

  dispose(): void {
    if (this.isInitialized) {
      this.options.sidebar.removeEventListener('mouseover', this.onMouseOver);
      this.options.sidebar.removeEventListener('mousemove', this.onMouseMove);
      this.options.sidebar.removeEventListener('mouseout', this.onMouseOut);
      this.isInitialized = false;
    }
    this.hoveredTarget = null;
    this.hide();
  }

  hide(): void {
    this.options.tooltip.hidden = true;
  }

  show(text: string, event: MouseEvent): void {
    const { tooltip, window } = this.options;
    tooltip.textContent = text;
    tooltip.hidden = false;
    const left = Math.min(window.innerWidth - tooltip.offsetWidth - 8, event.clientX + 12);
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - tooltip.offsetHeight - 8, event.clientY + 18)}px`;
  }

  private readonly onMouseOver = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-tooltip]');
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!target || !this.options.sidebar.contains(target) || target.contains(relatedTarget)) return;
    const text = target.dataset.tooltip;
    if (!text) return;
    this.hoveredTarget = target;
    this.show(text, event);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const text = this.hoveredTarget?.dataset.tooltip;
    if (text) this.show(text, event);
  };

  private readonly onMouseOut = (event: MouseEvent): void => {
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!this.hoveredTarget || this.hoveredTarget.contains(relatedTarget)) return;
    this.hoveredTarget = null;
    this.hide();
  };
}
