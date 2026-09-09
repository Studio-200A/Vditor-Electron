export interface AppTooltipControllerOptions {
  readonly tooltip: HTMLElement;
  readonly tooltipRoots: readonly HTMLElement[];
  readonly window: Pick<Window, 'innerWidth' | 'innerHeight'>;
}

/** Owns shared application tooltip rendering and delegated hover listeners. */
export class AppTooltipController {
  private hoveredTarget: HTMLElement | null = null;
  private isInitialized = false;

  constructor(private readonly options: AppTooltipControllerOptions) {}

  init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.options.tooltipRoots.forEach((root) => {
      root.addEventListener('mouseover', this.onMouseOver);
      root.addEventListener('mousemove', this.onMouseMove);
      root.addEventListener('mouseout', this.onMouseOut);
    });
  }

  dispose(): void {
    if (this.isInitialized) {
      this.options.tooltipRoots.forEach((root) => {
        root.removeEventListener('mouseover', this.onMouseOver);
        root.removeEventListener('mousemove', this.onMouseMove);
        root.removeEventListener('mouseout', this.onMouseOut);
      });
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
    if (!target || !this.isTooltipTarget(target) || target.contains(relatedTarget)) return;
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

  private isTooltipTarget(target: HTMLElement): boolean {
    return this.options.tooltipRoots.some((root) => root.contains(target));
  }
}
