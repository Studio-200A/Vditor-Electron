export interface DocumentLink {
  readonly element: Element;
  readonly href: string;
  readonly kind: string;
}

export interface DocumentLinkTarget {
  readonly link: DocumentLink;
  readonly headingIndex: number | null;
  readonly external?: boolean;
}

export interface DocumentLinkTab {
  readonly host: HTMLElement;
  readonly filePath: string | null;
}

export interface DocumentLinkNavigationHandlers {
  readonly onMouseOver: (event: MouseEvent) => void;
  readonly onMouseOut: (event: MouseEvent) => void;
  readonly onMouseMove: (event: MouseEvent) => void;
  readonly onClick: (event: MouseEvent) => void;
}

export interface DocumentLinkAdapter {
  documentLink(target: EventTarget | null, host: HTMLElement): DocumentLink | null;
  headingIndexForAnchor(host: HTMLElement, href: string): number;
  setDocumentLinkHint(link: DocumentLink, text: string, cursor: 'pointer' | 'text'): void;
  clearDocumentLinkHint(link: DocumentLink): void;
  expandInstantLinkForEditing(link: DocumentLink): boolean;
  focusDocumentLink(link: DocumentLink): void;
}

export interface DocumentLinkNavigationControllerOptions<TTab extends DocumentLinkTab> {
  readonly adapter: DocumentLinkAdapter;
  readonly platform: string;
  readonly translate: (key: string, params?: Record<string, string>) => string;
  readonly showMessage: (message: string, error?: boolean) => void;
  readonly showTooltip: (text: string, event: MouseEvent) => void;
  readonly hideTooltip: () => void;
  readonly resolveMarkdownLink: (
    sourcePath: string,
    href: string,
  ) => Promise<
    | { readonly kind: 'resolved'; readonly filePath: string; readonly fragment: string }
    | { readonly kind: 'unsupported' | 'missing'; readonly code: 'not-found' | string }
  >;
  readonly openPath: (filePath: string, activate: boolean, fragment: string) => Promise<void>;
  readonly openExternal: (href: string) => Promise<void>;
  readonly scrollToHeading: (tab: TTab, headingIndex: number) => void;
}

/** Coordinates semantic document-link navigation while editor runtime owns listener lifetime. */
export class DocumentLinkNavigationController<TTab extends DocumentLinkTab> {
  private readonly options: DocumentLinkNavigationControllerOptions<TTab>;
  private hovered: DocumentLinkTarget | null = null;

  constructor(options: DocumentLinkNavigationControllerOptions<TTab>) {
    this.options = options;
  }

  handlersFor(tab: TTab): DocumentLinkNavigationHandlers {
    return {
      onMouseOver: (event) => {
        const target = this.targetFor(tab, event.target);
        if (target) this.setHovered(target, event);
      },
      onMouseOut: (event) => {
        const relatedTarget = event.relatedTarget;
        if (
          !this.hovered ||
          (relatedTarget instanceof Node && this.hovered.link.element.contains(relatedTarget))
        )
          return;
        this.clearHovered();
      },
      onMouseMove: (event) => {
        if (this.hovered) this.options.showTooltip(this.tooltipText(), event);
      },
      onClick: (event) => this.handleClick(tab, event),
    };
  }

  updateHoveredCursor(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>): void {
    if (!this.hovered) return;
    this.options.adapter.setDocumentLinkHint(
      this.hovered.link,
      this.tooltipText(),
      this.hasModifier(event) ? 'pointer' : 'text',
    );
  }

  private async handleClick(tab: TTab, event: MouseEvent): Promise<void> {
    const target = this.targetFor(tab, event.target);
    if (!target) {
      this.blockUnsupportedNavigation(tab, event);
      return;
    }
    this.setHovered(target, event);
    const hasModifier = this.hasModifier(event);
    if (hasModifier || target.link.kind === 'toc') {
      event.preventDefault();
      event.stopPropagation();
    }
    if (hasModifier) {
      if (target.headingIndex !== null) this.options.scrollToHeading(tab, target.headingIndex);
      else if (target.external) await this.options.openExternal(target.link.href);
      else await this.openRelativeMarkdownLink(tab, target.link.href);
      return;
    }
    if (this.options.adapter.expandInstantLinkForEditing(target.link)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (target.link.kind === 'toc') this.options.adapter.focusDocumentLink(target.link);
  }

  private targetFor(tab: TTab, eventTarget: EventTarget | null): DocumentLinkTarget | null {
    const link = this.options.adapter.documentLink(eventTarget, tab.host);
    if (!link) return null;
    if (link.href.startsWith('#')) {
      const headingIndex = this.options.adapter.headingIndexForAnchor(tab.host, link.href);
      return headingIndex < 0 ? null : { link, headingIndex };
    }
    if (this.isSupportedExternalLink(link.href))
      return { link, headingIndex: null, external: true };
    return this.isPotentialRelativeMarkdownLink(link.href)
      ? { link, headingIndex: null, external: false }
      : null;
  }

  private blockUnsupportedNavigation(tab: TTab, event: MouseEvent): boolean {
    const link = this.options.adapter.documentLink(event.target, tab.host);
    if (!link || link.kind !== 'link') return false;
    event.preventDefault();
    event.stopPropagation();
    this.options.adapter.expandInstantLinkForEditing(link);
    return true;
  }

  private async openRelativeMarkdownLink(tab: TTab, href: string): Promise<void> {
    if (!tab.filePath) {
      this.options.showMessage(this.options.translate('message.linkSaveFirst'), true);
      return;
    }
    let resolution: Awaited<
      ReturnType<DocumentLinkNavigationController<TTab>['resolveMarkdownLink']>
    >;
    try {
      resolution = await this.resolveMarkdownLink(tab.filePath, href);
    } catch {
      this.options.showMessage(this.options.translate('message.linkTargetMissing'), true);
      return;
    }
    if (resolution.kind !== 'resolved') {
      this.options.showMessage(
        this.options.translate(
          resolution.code === 'not-found' ? 'message.linkTargetMissing' : 'message.linkUnsupported',
        ),
        true,
      );
      return;
    }
    await this.options.openPath(resolution.filePath, true, resolution.fragment);
  }

  private async resolveMarkdownLink(sourcePath: string, href: string) {
    return this.options.resolveMarkdownLink(sourcePath, href);
  }

  private setHovered(target: DocumentLinkTarget, event: MouseEvent): void {
    if (this.hovered?.link.element !== target.link.element) {
      this.clearHovered();
      this.hovered = target;
    }
    this.options.adapter.setDocumentLinkHint(
      target.link,
      this.tooltipText(),
      this.hasModifier(event) ? 'pointer' : 'text',
    );
    this.options.showTooltip(this.tooltipText(), event);
  }

  private clearHovered(): void {
    if (!this.hovered) return;
    this.options.adapter.clearDocumentLinkHint(this.hovered.link);
    this.hovered = null;
    this.options.hideTooltip();
  }

  private tooltipText(): string {
    return this.options.translate('link.followWithModifier', {
      modifier: this.options.platform === 'darwin' ? 'Cmd' : 'Ctrl',
    });
  }

  private hasModifier(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>): boolean {
    return this.options.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  }

  private isSupportedExternalLink(href: string): boolean {
    try {
      return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol);
    } catch {
      return false;
    }
  }

  private isPotentialRelativeMarkdownLink(href: string): boolean {
    const rawPath = href.split('#', 1)[0]?.trim() ?? '';
    if (!rawPath || rawPath.startsWith('/') || rawPath.startsWith('\\')) return false;
    if (/^[a-z][a-z\d+.-]*:/i.test(rawPath)) return false;
    try {
      return /\.(?:md|markdown|mdown|mkd|mkdn)$/i.test(decodeURIComponent(rawPath));
    } catch {
      return false;
    }
  }
}
