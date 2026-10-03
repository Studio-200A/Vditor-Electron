import type { MarkdownLinkResolution } from '../../shared/contracts/markdown-link.js';

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
  setDocumentLinkCursor(link: DocumentLink, cursor: 'text'): void;
  clearDocumentLinkHint(link: DocumentLink): void;
  expandInstantLinkForEditing(link: DocumentLink): boolean;
  focusDocumentLink(link: DocumentLink): void;
}

export interface DocumentLinkNavigationControllerOptions<TTab extends DocumentLinkTab> {
  readonly adapter: DocumentLinkAdapter;
  readonly platform: string;
  readonly translate: (key: string, params?: Record<string, string>) => string;
  readonly showMessage: (message: string, error?: boolean) => void;
  readonly formatError: (error: unknown) => string;
  readonly showTooltip: (text: string, event: MouseEvent) => void;
  readonly hideTooltip: () => void;
  readonly resolveMarkdownLink: (
    sourcePath: string,
    href: string,
  ) => Promise<MarkdownLinkResolution>;
  readonly openPath: (filePath: string, activate: boolean, fragment: string) => Promise<void>;
  readonly openExternal: (href: string) => Promise<void>;
  readonly scrollToHeading: (tab: TTab, headingIndex: number) => void;
}

/** Coordinates semantic document-link navigation while editor runtime owns listener lifetime. */
export class DocumentLinkNavigationController<TTab extends DocumentLinkTab> {
  private readonly options: DocumentLinkNavigationControllerOptions<TTab>;
  private hovered: DocumentLinkTarget | null = null;
  private blockedHoveredLink: DocumentLink | null = null;

  constructor(options: DocumentLinkNavigationControllerOptions<TTab>) {
    this.options = options;
  }

  handlersFor(tab: TTab): DocumentLinkNavigationHandlers {
    return {
      onMouseOver: (event) => {
        const link = this.options.adapter.documentLink(event.target, tab.host);
        const target = link && this.targetForLink(tab, link);
        if (target) this.setHovered(target, event);
        else if (link?.kind === 'link') this.setBlockedHovered(link, event);
      },
      onMouseOut: (event) => {
        const relatedTarget = event.relatedTarget;
        const hoveredElement = this.hovered?.link.element ?? this.blockedHoveredLink?.element;
        if (
          !hoveredElement ||
          (relatedTarget instanceof Node && hoveredElement.contains(relatedTarget))
        )
          return;
        this.clearHovered();
      },
      onMouseMove: (event) => {
        if (this.hovered) this.options.showTooltip(this.tooltipText(), event);
        else if (this.blockedHoveredLink) {
          const message = this.unsupportedLinkMessage(this.blockedHoveredLink.href);
          if (message) this.options.showTooltip(message, event);
        }
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

  clearHoveredLink(): void {
    this.clearHovered();
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
    return this.targetForLink(tab, link);
  }

  private targetForLink(tab: TTab, link: DocumentLink): DocumentLinkTarget | null {
    if (link.href.startsWith('#')) {
      const headingIndex = this.options.adapter.headingIndexForAnchor(tab.host, link.href);
      return headingIndex < 0 ? null : { link, headingIndex };
    }
    if (this.isSupportedExternalLink(link.href))
      return { link, headingIndex: null, external: true };
    return this.localLinkKind(link.href) === 'relative-markdown'
      ? { link, headingIndex: null, external: false }
      : null;
  }

  private blockUnsupportedNavigation(tab: TTab, event: MouseEvent): boolean {
    const link = this.options.adapter.documentLink(event.target, tab.host);
    if (!link || link.kind !== 'link') return false;
    event.preventDefault();
    event.stopPropagation();
    if (this.hasModifier(event) && !link.href.startsWith('#'))
      this.options.showMessage(
        this.unsupportedLinkMessage(link.href) ?? this.options.translate('message.linkUnsupported'),
        true,
      );
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
    } catch (error) {
      this.options.showMessage(
        this.options.translate('message.openFailed', { error: this.options.formatError(error) }),
        true,
      );
      return;
    }
    if (resolution.kind !== 'resolved') {
      this.options.showMessage(
        this.options.translate(
          resolution.code === 'not-found'
            ? 'message.linkTargetMissing'
            : resolution.code === 'invalid-source'
              ? 'message.linkSourceUnavailable'
              : resolution.code === 'unsupported-target'
                ? 'message.linkFileTypeUnsupported'
                : 'message.linkUnsupported',
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
    const link = this.hovered?.link ?? this.blockedHoveredLink;
    if (!link) return;
    this.options.adapter.clearDocumentLinkHint(link);
    this.hovered = null;
    this.blockedHoveredLink = null;
    this.options.hideTooltip();
  }

  private setBlockedHovered(link: DocumentLink, event: MouseEvent): void {
    if (this.blockedHoveredLink?.element !== link.element) {
      this.clearHovered();
      this.blockedHoveredLink = link;
    }
    const message = this.unsupportedLinkMessage(link.href);
    if (message) {
      this.options.adapter.setDocumentLinkHint(link, message, 'text');
      this.options.showTooltip(message, event);
    } else this.options.adapter.setDocumentLinkCursor(link, 'text');
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

  private unsupportedLinkMessage(href: string): string | null {
    switch (this.localLinkKind(href)) {
      case 'file-type':
        return this.options.translate('message.linkFileTypeUnsupported');
      case 'absolute-path':
        return this.options.translate('message.linkAbsolutePathUnsupported');
      case 'file-protocol':
        return this.options.translate('message.linkFileProtocolUnsupported');
      default:
        return null;
    }
  }

  private localLinkKind(
    href: string,
  ): 'relative-markdown' | 'file-type' | 'absolute-path' | 'file-protocol' | 'unsupported' {
    const rawPath = href.split('#', 1)[0]?.trim() ?? '';
    if (!rawPath) return 'unsupported';
    if (/^file:/i.test(rawPath)) return 'file-protocol';
    if (/^[a-z]:[\\/]/i.test(rawPath)) return 'absolute-path';
    if (/^[a-z][a-z\d+.-]*:/i.test(rawPath)) return 'unsupported';
    try {
      const decodedPath = decodeURIComponent(rawPath);
      if (
        decodedPath.startsWith('/') ||
        decodedPath.startsWith('\\') ||
        /^[a-z]:[\\/]/i.test(decodedPath)
      )
        return 'absolute-path';
      return /\.(?:md|markdown|mdown|mkd|mkdn)$/i.test(decodedPath)
        ? 'relative-markdown'
        : 'file-type';
    } catch {
      return 'unsupported';
    }
  }
}
