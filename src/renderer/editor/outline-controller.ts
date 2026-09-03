export interface OutlineHeading {
  readonly level: number;
  readonly key: string;
  readonly text: string;
}

export interface OutlineTab {
  readonly host: HTMLElement;
  readonly mode: string;
  readonly outlineCollapsed: Set<string>;
}

export interface OutlineControllerOptions<TTab extends OutlineTab> {
  readonly view: HTMLElement;
  readonly tree: HTMLElement;
  readonly getActiveTab: () => TTab | null;
  readonly getSnapshot: (tab: TTab) => OutlineHeading[];
  readonly scrollToHeading: (tab: TTab, index: number) => void;
  readonly translate: (
    key: 'sidebar.noDocument' | 'sidebar.noHeadings' | 'outline.expand' | 'outline.collapse',
  ) => string;
}

interface OutlineNode extends OutlineHeading {
  readonly outlineIndex: number;
  readonly children: OutlineNode[];
}

/** Owns the Desktop outline DOM and its single deferred refresh. */
export class OutlineController<TTab extends OutlineTab> {
  private readonly view: HTMLElement;
  private readonly tree: HTMLElement;
  private readonly getActiveTab: () => TTab | null;
  private readonly getSnapshot: (tab: TTab) => OutlineHeading[];
  private readonly scrollToHeading: (tab: TTab, index: number) => void;
  private readonly translate: OutlineControllerOptions<TTab>['translate'];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: OutlineControllerOptions<TTab>) {
    this.view = options.view;
    this.tree = options.tree;
    this.getActiveTab = options.getActiveTab;
    this.getSnapshot = options.getSnapshot;
    this.scrollToHeading = options.scrollToHeading;
    this.translate = options.translate;
  }

  schedule(): void {
    if (!this.view.classList.contains('active')) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.render();
    }, 300);
  }

  onRuntimeChanged(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.render();
  }

  render(): void {
    if (!this.view.classList.contains('active')) return;
    const tab = this.getActiveTab();
    this.tree.replaceChildren();
    if (!tab) {
      this.tree.append(this.emptyState(this.translate('sidebar.noDocument')));
      return;
    }
    const headings = this.getSnapshot(tab);
    if (!headings.length) {
      this.tree.append(this.emptyState(this.translate('sidebar.noHeadings')));
      return;
    }
    this.toTree(headings).forEach((node) => this.tree.append(this.createNode(tab, node)));
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.tree.replaceChildren();
  }

  private emptyState(message: string): HTMLDivElement {
    const node = document.createElement('div');
    node.className = 'empty';
    node.textContent = message;
    return node;
  }

  private toTree(headings: readonly OutlineHeading[]): OutlineNode[] {
    const roots: OutlineNode[] = [];
    const stack: OutlineNode[] = [];
    headings.forEach((heading, outlineIndex) => {
      const node: OutlineNode = { ...heading, outlineIndex, children: [] };
      while (stack.length && stack.at(-1)!.level >= node.level) stack.pop();
      if (stack.length) stack.at(-1)!.children.push(node);
      else roots.push(node);
      stack.push(node);
    });
    return roots;
  }

  private createNode(tab: TTab, node: OutlineNode): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'outline-node';
    const row = document.createElement('div');
    row.className = 'outline-row';
    if (node.children.length) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'outline-toggle';
      const applyCollapsedState = (collapsed: boolean): void => {
        wrapper.classList.toggle('collapsed', collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        const label = this.translate(collapsed ? 'outline.expand' : 'outline.collapse');
        toggle.dataset.tooltip = label;
        toggle.setAttribute('aria-label', label);
        toggle.textContent = collapsed ? '›' : '⌄';
      };
      applyCollapsedState(tab.outlineCollapsed.has(node.key));
      toggle.addEventListener('click', () => {
        const collapsed = !wrapper.classList.contains('collapsed');
        if (collapsed) tab.outlineCollapsed.add(node.key);
        else tab.outlineCollapsed.delete(node.key);
        applyCollapsedState(collapsed);
      });
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'outline-toggle-spacer';
      row.append(spacer);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-item';
    button.textContent = node.text;
    button.addEventListener('click', () => this.scrollToHeading(tab, node.outlineIndex));
    row.append(button);
    wrapper.append(row);
    if (node.children.length) {
      const children = document.createElement('div');
      children.className = 'outline-children';
      node.children.forEach((child) => children.append(this.createNode(tab, child)));
      wrapper.append(children);
    }
    return wrapper;
  }
}
