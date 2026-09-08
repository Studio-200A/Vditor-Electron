import type {
  AppAPI,
  ResourceHealthActionResult,
  ResourceHealthScanSummary,
} from '../types/bridges.js';

interface ResourceDocument {
  readonly filePath: string | null;
  readonly title: string;
}

interface ResourceEditor {
  readonly host: HTMLElement;
  readonly mode: 'wysiwyg' | 'ir' | 'sv';
  readonly content: string;
}

export interface ResourceHealthDialogSize {
  readonly width: number;
  readonly height: number;
  readonly customized: boolean;
}

export interface ResourceHealthControllerOptions {
  readonly document: Document;
  readonly appAPI: Pick<
    AppAPI,
    | 'scanResourceHealth'
    | 'revealResourceHealthCandidate'
    | 'trashResourceHealthCandidates'
    | 'previewResourceHealthCandidate'
    | 'writeClipboard'
  > &
    Partial<Pick<AppAPI, 'discardResourceHealthScans'>>;
  readonly getActiveDocument: () => ResourceDocument | null;
  readonly getWorkspacePath: () => string;
  readonly getDialogSize?: () => ResourceHealthDialogSize | null | undefined;
  readonly persistDialogSize?: (size: ResourceHealthDialogSize) => void;
  readonly getActiveEditor: () => ResourceEditor | null;
  readonly removeImageReference: (editor: ResourceEditor, raw: string, source: string) => boolean;
  readonly confirmRemoveReferences?: (
    entries: readonly { targetPath: string; raw: string }[],
  ) => Promise<boolean>;
  readonly confirmRemoveReference?: (targetPath: string, raw: string) => Promise<boolean>;
  readonly translate: (key: string, variables?: Record<string, string | number>) => string;
  readonly openWorkspace: () => void;
  readonly confirmMoveToTrash: (
    candidates: readonly { relativePath: string; size: number }[],
  ) => Promise<boolean>;
  readonly showChangedSinceScanDialog?: () => Promise<boolean>;
  readonly showMessage?: (message: string, error?: boolean) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Owns resource-health page DOM, scan lifecycle, candidate selection and action intent. */
export class ResourceHealthController {
  private readonly options: ResourceHealthControllerOptions;
  private readonly modal: HTMLElement;
  private readonly card: HTMLElement;
  private readonly header: HTMLElement;
  private readonly title: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly summaryTitle: HTMLElement;
  private readonly scanStatus: HTMLElement;
  private readonly scanStatusIcon: HTMLElement;
  private readonly scanStatusText: HTMLElement;
  private readonly scanStatusDetail: HTMLElement;
  private readonly workspaceIndicator: HTMLElement;
  private readonly workspaceName: HTMLElement;
  private readonly unsavedNotice: HTMLElement;
  private readonly unsavedNoticeText: HTMLElement;
  private readonly limitations: HTMLElement;
  private readonly candidates: HTMLElement;
  private readonly results: HTMLElement;
  private readonly candidateList: HTMLElement;
  private readonly candidateDetail: HTMLElement;
  private readonly candidatePreview: HTMLImageElement;
  private readonly candidatePreviewPlaceholder: HTMLElement;
  private readonly missing: HTMLElement;
  private readonly candidatesTab: HTMLButtonElement;
  private readonly missingTab: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly overlayText: HTMLElement;
  private readonly overlayDescription: HTMLElement;
  private readonly closeOverlayButton: HTMLButtonElement;
  private readonly warningIcon: HTMLImageElement;
  private readonly rescanButton: HTMLButtonElement;
  private readonly rescanLabel: HTMLElement;
  private readonly trashButton: HTMLButtonElement;
  private readonly removeMissingButton: HTMLButtonElement;
  private readonly selectionSummary: HTMLElement;
  private readonly actionResult: HTMLElement;
  private current: ResourceHealthScanSummary | null = null;
  private scanGeneration = 0;
  private selected = new Set<string>();
  private selectedMissing = new Set<string>();
  private activeCandidateId: string | null = null;
  private previousFocus: HTMLElement | null = null;
  private dragCleanup: (() => void) | null = null;
  private resizeCleanup: (() => void) | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private openAnimationFrame: number | null = null;

  constructor(options: ResourceHealthControllerOptions) {
    this.options = options;
    const { document } = options;
    this.modal = element(document, 'section', 'resource-health-modal hidden');
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'resource-health-title');
    this.card = element(document, 'div', 'modal-card resource-health-card');
    this.header = element(document, 'header');
    this.title = element(document, 'h2');
    this.title.id = 'resource-health-title';
    this.title.textContent = options.translate('resourceHealth.title');
    this.closeButton = element(document, 'button', 'modal-close');
    this.closeButton.type = 'button';
    this.closeButton.textContent = '×';
    this.closeButton.setAttribute('aria-label', options.translate('resourceHealth.close'));
    this.closeButton.addEventListener('click', () => this.close());
    this.header.append(this.title, this.closeButton);
    this.body = element(document, 'div', 'resource-health-body');
    this.summary = element(document, 'div', 'resource-health-summary');
    this.summaryTitle = element(document, 'h3', 'resource-health-summary-title');
    this.summary.append(this.summaryTitle);
    this.scanStatus = element(document, 'section', 'resource-health-scan-status');
    this.scanStatus.setAttribute('aria-live', 'polite');
    this.scanStatusIcon = this.createAnalyzingImage(document);
    this.scanStatusIcon.classList.add('resource-health-status-animation', 'hidden');
    this.scanStatusText = element(document, 'strong', 'resource-health-scan-status-text');
    this.scanStatusDetail = element(
      document,
      'p',
      'resource-health-scan-status-detail resource-health-scan-metadata',
    );
    this.workspaceIndicator = element(document, 'div', 'resource-health-workspace hidden');
    const workspaceIcon = element(document, 'span', 'resource-health-workspace-icon');
    workspaceIcon.setAttribute('aria-hidden', 'true');
    this.workspaceName = element(document, 'span');
    this.workspaceIndicator.append(workspaceIcon, this.workspaceName);
    this.unsavedNotice = element(document, 'div', 'resource-health-unsaved-notice');
    const unsavedNoticeIcon = element(document, 'span', 'resource-health-notice-icon');
    unsavedNoticeIcon.setAttribute('aria-hidden', 'true');
    this.unsavedNoticeText = element(document, 'span');
    this.unsavedNoticeText.textContent = options.translate('resourceHealth.unsavedNotice');
    this.unsavedNotice.append(unsavedNoticeIcon, this.unsavedNoticeText);
    this.limitations = element(document, 'p', 'resource-health-limitations hidden');
    const tabs = element(document, 'div', 'resource-health-tabs');
    this.candidatesTab = element(document, 'button', 'active');
    this.candidatesTab.type = 'button';
    this.candidatesTab.textContent = options.translate('resourceHealth.candidates');
    this.candidatesTab.addEventListener('click', () => this.showTab('candidates'));
    this.missingTab = element(document, 'button');
    this.missingTab.type = 'button';
    this.missingTab.textContent = options.translate('resourceHealth.missing');
    this.missingTab.addEventListener('click', () => this.showTab('missing'));
    tabs.append(this.candidatesTab, this.missingTab);
    this.candidates = element(document, 'div', 'resource-health-candidates');
    this.candidateList = element(document, 'div', 'resource-health-candidate-list');
    this.candidateDetail = element(document, 'aside', 'resource-health-candidate-detail');
    this.candidatePreview = element(document, 'img');
    this.candidatePreview.alt = '';
    this.candidatePreview.hidden = true;
    this.candidatePreviewPlaceholder = element(
      document,
      'div',
      'resource-health-preview-placeholder',
    );
    this.candidatePreviewPlaceholder.textContent = options.translate(
      'resourceHealth.selectCandidate',
    );
    this.candidateDetail.append(this.candidatePreview, this.candidatePreviewPlaceholder);
    this.candidates.append(this.candidateList);
    this.missing = element(document, 'div', 'resource-health-missing');
    this.results = element(document, 'div', 'resource-health-results');
    this.results.append(this.candidates, this.missing, this.candidateDetail);
    this.rescanButton = element(document, 'button', 'resource-health-rescan');
    this.rescanButton.type = 'button';
    const rescanIcon = element(document, 'span', 'refresh-tree-icon resource-health-rescan-icon');
    rescanIcon.setAttribute('aria-hidden', 'true');
    this.rescanLabel = element(document, 'span');
    this.rescanLabel.textContent = options.translate('resourceHealth.rescan');
    this.rescanButton.append(rescanIcon, this.rescanLabel);
    this.rescanButton.addEventListener('click', () => void this.scan());
    this.trashButton = element(document, 'button', 'primary danger resource-health-trash');
    this.trashButton.type = 'button';
    this.trashButton.textContent = options.translate('resourceHealth.moveToTrash');
    this.trashButton.addEventListener('click', () => void this.trashSelected());
    this.removeMissingButton = element(
      document,
      'button',
      'dangerous-button resource-health-remove-missing',
    );
    this.removeMissingButton.type = 'button';
    this.removeMissingButton.textContent = options.translate('resourceHealth.removeReference');
    this.removeMissingButton.addEventListener(
      'click',
      () => void this.removeSelectedMissingReferences(),
    );
    this.actions = element(document, 'footer');
    this.selectionSummary = element(document, 'span', 'resource-health-selection-summary');
    this.actionResult = element(document, 'p', 'resource-health-action-result hidden');
    this.actions.append(this.selectionSummary, this.trashButton, this.removeMissingButton);
    this.scanStatus.append(
      this.scanStatusIcon,
      this.scanStatusText,
      this.scanStatusDetail,
      this.workspaceIndicator,
      this.rescanButton,
    );
    this.body.append(
      this.summary,
      this.scanStatus,
      this.unsavedNotice,
      this.limitations,
      this.actionResult,
      tabs,
      this.results,
    );
    this.overlay = element(document, 'div', 'resource-health-overlay');
    this.overlay.setAttribute('role', 'status');
    this.overlay.setAttribute('aria-live', 'polite');
    this.overlay.tabIndex = -1;
    this.warningIcon = element(document, 'img', 'resource-health-warning-icon hidden');
    this.warningIcon.src = 'assets/notification/warning.svg';
    this.warningIcon.alt = '';
    this.overlayText = element(document, 'p', 'resource-health-overlay-text');
    this.overlayText.setAttribute('role', 'status');
    this.overlayDescription = element(document, 'p', 'resource-health-overlay-description hidden');
    this.closeOverlayButton = element(document, 'button', 'resource-health-overlay-close');
    this.closeOverlayButton.type = 'button';
    this.closeOverlayButton.textContent = options.translate('resourceHealth.close');
    this.closeOverlayButton.addEventListener('click', () => this.close());
    const openWorkspace = element(document, 'button', 'resource-health-open-workspace hidden');
    openWorkspace.type = 'button';
    openWorkspace.textContent = options.translate('resourceHealth.openWorkspace');
    openWorkspace.addEventListener('click', () => options.openWorkspace());
    this.overlay.append(
      this.warningIcon,
      this.overlayText,
      this.overlayDescription,
      this.closeOverlayButton,
      openWorkspace,
    );
    for (const direction of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
      const resizeHandle = element(document, 'div', 'resource-health-resize-handle');
      resizeHandle.dataset.resourceHealthResize = direction;
      resizeHandle.addEventListener('mousedown', this.onResizeMouseDown);
      this.card.append(resizeHandle);
    }
    this.card.append(this.header, this.body, this.actions, this.overlay);
    this.modal.append(this.card);
    document.body.append(this.modal);
    this.header.addEventListener('mousedown', this.onHeaderMouseDown);
    this.modal.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') this.keepFocusInDialog(event);
    });
    document.addEventListener('keydown', this.onDocumentKeyDown, true);
  }

  open(): void {
    this.previousFocus =
      this.options.document.activeElement instanceof HTMLElement
        ? this.options.document.activeElement
        : null;
    this.refreshLocalizedLabels();
    this.resetPosition();
    this.restoreDialogSize();
    this.stopClosingAnimation();
    this.modal.classList.remove('hidden', 'modal-closing', 'modal-open');
    this.openAnimationFrame = window.requestAnimationFrame(() => {
      this.openAnimationFrame = window.requestAnimationFrame(() => {
        this.openAnimationFrame = null;
        this.modal.classList.add('modal-open');
      });
    });
    void this.scan();
  }

  close(): void {
    this.scanGeneration += 1;
    this.options.appAPI.discardResourceHealthScans?.();
    this.stopDragging();
    this.stopResizing();
    this.current = null;
    this.selected.clear();
    this.selectedMissing.clear();
    this.activeCandidateId = null;
    this.workspaceIndicator.classList.add('hidden');
    this.setBlocked(false);
    this.modal.classList.remove('modal-open');
    this.modal.classList.add('modal-closing');
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      this.modal.classList.remove('modal-closing');
      this.modal.classList.add('hidden');
      this.previousFocus?.focus();
      this.previousFocus = null;
    }, this.closeAnimationDuration());
  }

  invalidate(): void {
    if (this.modal.classList.contains('hidden')) return;
    this.scanGeneration += 1;
    this.options.appAPI.discardResourceHealthScans?.();
    this.current = null;
    this.renderUnavailable('resourceHealth.stale');
  }

  dispose(): void {
    this.scanGeneration += 1;
    this.stopDragging();
    this.stopResizing();
    this.stopClosingAnimation();
    this.header.removeEventListener('mousedown', this.onHeaderMouseDown);
    this.options.document.removeEventListener('keydown', this.onDocumentKeyDown, true);
    this.card
      .querySelectorAll<HTMLElement>('.resource-health-resize-handle')
      .forEach((handle) => handle.removeEventListener('mousedown', this.onResizeMouseDown));
    this.modal.remove();
  }

  private refreshLocalizedLabels(): void {
    this.title.textContent = this.options.translate('resourceHealth.title');
    this.closeButton.setAttribute('aria-label', this.options.translate('resourceHealth.close'));
    this.closeOverlayButton.textContent = this.options.translate('resourceHealth.close');
    this.rescanLabel.textContent = this.options.translate('resourceHealth.rescan');
    this.trashButton.textContent = this.options.translate('resourceHealth.moveToTrash');
    this.removeMissingButton.textContent = this.options.translate('resourceHealth.removeReference');
    this.unsavedNoticeText.textContent = this.options.translate('resourceHealth.unsavedNotice');
  }

  private stopClosingAnimation(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.openAnimationFrame !== null) {
      window.cancelAnimationFrame(this.openAnimationFrame);
      this.openAnimationFrame = null;
    }
  }

  private closeAnimationDuration(): number {
    const value = window
      .getComputedStyle(this.modal)
      .getPropertyValue('--resource-health-exit-duration')
      .trim();
    const duration = Number.parseFloat(value);
    return Number.isFinite(duration) ? duration : 140;
  }

  private readonly onHeaderMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button')))
      return;
    event.preventDefault();
    const modalBounds = this.modal.getBoundingClientRect();
    const cardBounds = this.card.getBoundingClientRect();
    this.card.style.position = 'absolute';
    const offsetX = event.clientX - cardBounds.left;
    const offsetY = event.clientY - cardBounds.top;
    const move = (moveEvent: MouseEvent): void => {
      const maximumLeft = Math.max(0, this.modal.clientWidth - this.card.offsetWidth);
      const maximumTop = Math.max(0, this.modal.clientHeight - this.card.offsetHeight);
      const left = Math.min(
        maximumLeft,
        Math.max(0, moveEvent.clientX - modalBounds.left - offsetX),
      );
      const top = Math.min(maximumTop, Math.max(0, moveEvent.clientY - modalBounds.top - offsetY));
      this.card.style.left = `${Math.round(left)}px`;
      this.card.style.top = `${Math.round(top)}px`;
    };
    const up = () => this.stopDragging();
    this.dragCleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.dragCleanup = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key !== 'Escape' ||
      this.modal.classList.contains('hidden') ||
      this.modal.classList.contains('modal-closing') ||
      this.options.document.querySelector('#confirmModal:not(.hidden)')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private stopDragging(): void {
    this.dragCleanup?.();
  }

  private readonly onResizeMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
    const direction = event.currentTarget.dataset.resourceHealthResize;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const modalBounds = this.modal.getBoundingClientRect();
    const cardBounds = this.card.getBoundingClientRect();
    const initial = {
      left: cardBounds.left - modalBounds.left,
      top: cardBounds.top - modalBounds.top,
      width: cardBounds.width,
      height: cardBounds.height,
    };
    this.card.style.position = 'absolute';
    this.setCardBounds(initial);
    const move = (moveEvent: MouseEvent): void => {
      const horizontal = moveEvent.clientX - event.clientX;
      const vertical = moveEvent.clientY - event.clientY;
      const limits = this.cardSizeLimits();
      let { left, top, width, height } = initial;
      if (direction.includes('e'))
        width = Math.min(limits.maxWidth, Math.max(limits.minWidth, width + horizontal));
      if (direction.includes('s'))
        height = Math.min(limits.maxHeight, Math.max(limits.minHeight, height + vertical));
      if (direction.includes('w')) {
        const nextWidth = Math.min(limits.maxWidth, Math.max(limits.minWidth, width - horizontal));
        left += width - nextWidth;
        width = nextWidth;
      }
      if (direction.includes('n')) {
        const nextHeight = Math.min(
          limits.maxHeight,
          Math.max(limits.minHeight, height - vertical),
        );
        top += height - nextHeight;
        height = nextHeight;
      }
      left = Math.min(Math.max(0, left), Math.max(0, this.modal.clientWidth - width));
      top = Math.min(Math.max(0, top), Math.max(0, this.modal.clientHeight - height));
      this.setCardBounds({ left, top, width, height });
    };
    const up = () => {
      this.persistDialogSize();
      this.stopResizing();
    };
    this.resizeCleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.resizeCleanup = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  private stopResizing(): void {
    this.resizeCleanup?.();
  }

  private cardSizeLimits(): {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
  } {
    const maxWidth = Math.max(1, Math.floor(window.innerWidth * 0.9));
    const maxHeight = Math.max(1, Math.floor(window.innerHeight * 0.9));
    return {
      minWidth: Math.min(760, maxWidth),
      minHeight: Math.min(520, maxHeight),
      maxWidth,
      maxHeight,
    };
  }

  private setCardBounds(bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): void {
    this.card.style.left = `${Math.round(bounds.left)}px`;
    this.card.style.top = `${Math.round(bounds.top)}px`;
    this.card.style.width = `${Math.round(bounds.width)}px`;
    this.card.style.height = `${Math.round(bounds.height)}px`;
  }

  private resetPosition(): void {
    this.card.style.removeProperty('position');
    this.card.style.removeProperty('left');
    this.card.style.removeProperty('top');
  }

  private restoreDialogSize(): void {
    const saved = this.options.getDialogSize?.();
    if (!saved?.customized) {
      this.card.style.removeProperty('width');
      this.card.style.removeProperty('height');
      return;
    }
    const limits = this.cardSizeLimits();
    this.card.style.width = `${Math.min(limits.maxWidth, Math.max(limits.minWidth, saved.width))}px`;
    this.card.style.height = `${Math.min(limits.maxHeight, Math.max(limits.minHeight, saved.height))}px`;
  }

  private persistDialogSize(): void {
    const limits = this.cardSizeLimits();
    this.options.persistDialogSize?.({
      width: Math.round(
        Math.min(limits.maxWidth, Math.max(limits.minWidth, this.card.offsetWidth)),
      ),
      height: Math.round(
        Math.min(limits.maxHeight, Math.max(limits.minHeight, this.card.offsetHeight)),
      ),
      customized: true,
    });
  }

  private async scan(): Promise<void> {
    const active = this.options.getActiveDocument();
    const workspacePath = this.options.getWorkspacePath();
    if (!active?.filePath || !workspacePath) {
      this.renderUnavailable('resourceHealth.unavailable');
      return;
    }
    const generation = ++this.scanGeneration;
    this.current = null;
    this.selected.clear();
    this.selectedMissing.clear();
    this.activeCandidateId = null;
    this.workspaceIndicator.classList.add('hidden');
    this.setBlocked(true);
    this.overlay.classList.remove('hidden', 'resource-health-overlay-error');
    this.warningIcon.classList.add('hidden');
    this.overlayDescription.classList.add('hidden');
    this.overlay
      .querySelector<HTMLButtonElement>('.resource-health-open-workspace')
      ?.classList.add('hidden');
    this.overlayText.textContent = this.options.translate('resourceHealth.scanning');
    this.renderScanStatus('resourceHealth.scanStatus.scanning');
    this.modal.setAttribute('aria-busy', 'true');
    this.renderActions();
    this.showTab('candidates');
    try {
      const summary = await this.options.appAPI.scanResourceHealth(active.filePath, workspacePath);
      if (generation !== this.scanGeneration) return;
      const currentActive = this.options.getActiveDocument();
      if (
        currentActive?.filePath !== active.filePath ||
        this.options.getWorkspacePath() !== workspacePath
      ) {
        this.renderUnavailable('resourceHealth.stale');
        return;
      }
      this.current = summary;
      this.overlay.classList.add('hidden');
      this.modal.removeAttribute('aria-busy');
      this.setBlocked(false);
      this.renderSummary(summary, active.title);
      this.rescanButton.focus();
    } catch {
      if (generation !== this.scanGeneration) return;
      this.renderUnavailable('resourceHealth.scanFailed');
    }
  }

  private renderUnavailable(key: string): void {
    this.current = null;
    this.selected.clear();
    this.selectedMissing.clear();
    this.activeCandidateId = null;
    this.modal.removeAttribute('aria-busy');
    this.setBlocked(true);
    this.overlay.classList.remove('hidden');
    this.overlay.classList.add('resource-health-overlay-error');
    this.overlay.setAttribute('role', 'alert');
    this.warningIcon.classList.remove('hidden');
    this.overlayText.textContent = this.options.translate(key);
    this.closeOverlayButton.textContent = this.options.translate('resourceHealth.close');
    this.renderScanStatus(
      key === 'resourceHealth.stale'
        ? 'resourceHealth.scanStatus.stale'
        : 'resourceHealth.scanStatus.failed',
    );
    const shouldOfferWorkspace = key === 'resourceHealth.unavailable';
    this.overlayDescription.textContent = shouldOfferWorkspace
      ? this.options.translate('resourceHealth.workspaceHint')
      : '';
    this.overlayDescription.classList.toggle('hidden', !shouldOfferWorkspace);
    this.overlay
      .querySelector<HTMLButtonElement>('.resource-health-open-workspace')
      ?.classList.toggle('hidden', !shouldOfferWorkspace);
    this.summaryTitle.textContent = shouldOfferWorkspace
      ? this.options.translate('resourceHealth.workspaceHint')
      : this.options.translate(key);
    this.summary.replaceChildren(this.summaryTitle);
    this.limitations.classList.add('hidden');
    this.candidateList.replaceChildren();
    this.missing.replaceChildren();
    this.actionResult.classList.add('hidden');
    this.renderActions();
    this.overlay.focus();
  }

  private setBlocked(blocked: boolean): void {
    this.body.inert = blocked;
    this.actions.inert = blocked;
    if (blocked) {
      this.overlay.focus();
    } else {
      this.overlay.setAttribute('role', 'status');
    }
  }

  private showTab(tab: 'candidates' | 'missing'): void {
    const candidatesActive = tab === 'candidates';
    this.candidates.hidden = !candidatesActive;
    this.missing.hidden = candidatesActive;
    this.candidateDetail.hidden = !candidatesActive;
    this.candidatesTab.classList.toggle('active', candidatesActive);
    this.missingTab.classList.toggle('active', !candidatesActive);
    this.candidatesTab.setAttribute('aria-selected', String(candidatesActive));
    this.missingTab.setAttribute('aria-selected', String(!candidatesActive));
    this.actions.replaceChildren(
      this.selectionSummary,
      ...(candidatesActive
        ? [this.trashButton, this.removeMissingButton]
        : [this.removeMissingButton, this.trashButton]),
    );
    this.renderActions();
  }

  private renderSummary(summary: ResourceHealthScanSummary, title: string): void {
    this.candidatesTab.textContent = this.options.translate('resourceHealth.candidates', {
      count: summary.candidates.length,
    });
    this.missingTab.textContent = this.options.translate('resourceHealth.missing', {
      count: summary.missingReferences.length,
    });
    this.summaryTitle.textContent = this.options.translate('resourceHealth.summary', {
      title,
      count: summary.candidates.length,
      missing: summary.missingReferences.length,
    });
    this.summary.replaceChildren(this.summaryTitle);
    this.workspaceName.textContent = summary.workspaceName;
    this.workspaceIndicator.classList.toggle('hidden', !summary.workspaceName);
    if (
      Number.isFinite(summary.savedAt) &&
      summary.documentRelativePath &&
      summary.workspaceName &&
      summary.imageDirectoryRelativePath
    ) {
      this.renderScanStatus('resourceHealth.scanStatus.complete', {
        documentPath: summary.documentRelativePath,
        workspace: summary.workspaceName,
        imageDirectory: summary.imageDirectoryRelativePath,
        savedAt: this.formatDate(summary.savedAt),
        scanned: summary.scannedSourceFiles,
      });
    } else this.renderScanStatus('resourceHealth.scanStatus.complete');
    this.actionResult.classList.add('hidden');
    this.limitations.textContent = summary.limitations.complete
      ? ''
      : this.options.translate('resourceHealth.incomplete');
    this.limitations.classList.toggle('hidden', summary.limitations.complete);
    this.candidateList.replaceChildren();
    this.renderCandidateDetail(null, '');
    for (const candidate of summary.candidates) {
      const row = element(this.options.document, 'div', 'resource-health-candidate');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', candidate.relativePath);
      const inspect = (): void => this.inspectCandidate(row, candidate, summary.revision);
      row.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('input, button')) return;
        inspect();
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        inspect();
      });
      const checkbox = element(this.options.document, 'input');
      checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selected.add(candidate.id);
        } else this.selected.delete(candidate.id);
        row.classList.toggle('is-selected', checkbox.checked);
        inspect();
        this.renderActions();
      });
      const name = element(this.options.document, 'span');
      name.textContent = `${candidate.relativePath} · ${this.formatSize(candidate.size)} · ${this.formatDate(candidate.modifiedAt)}`;
      const reveal = element(this.options.document, 'button');
      reveal.type = 'button';
      reveal.textContent = this.options.translate('resourceHealth.reveal');
      reveal.addEventListener(
        'click',
        () =>
          void this.options.appAPI.revealResourceHealthCandidate(summary.revision, candidate.id),
      );
      const copy = element(this.options.document, 'button');
      copy.type = 'button';
      copy.textContent = this.options.translate('resourceHealth.copyPath');
      copy.addEventListener(
        'click',
        () => void this.options.appAPI.writeClipboard(candidate.relativePath),
      );
      row.append(checkbox, name, copy, reveal);
      this.candidateList.append(row);
    }
    if (!summary.candidates.length) {
      const empty = element(this.options.document, 'p');
      empty.textContent = this.options.translate('resourceHealth.noCandidates');
      this.candidateList.append(empty);
    }
    this.missing.replaceChildren();
    for (const missing of summary.missingReferences) {
      const item = element(this.options.document, 'div', 'resource-health-missing-item');
      const checkbox = element(this.options.document, 'input');
      checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.selectedMissing.add(missing.targetPath);
        else this.selectedMissing.delete(missing.targetPath);
        this.renderActions();
      });
      const label = element(this.options.document, 'span');
      label.textContent = `${missing.targetPath} (${missing.locations.length})`;
      const copy = element(this.options.document, 'button');
      copy.type = 'button';
      copy.textContent = this.options.translate('resourceHealth.copyPath');
      copy.addEventListener(
        'click',
        () => void this.options.appAPI.writeClipboard(missing.targetPath),
      );
      item.append(checkbox, label, copy);
      const locations = element(this.options.document, 'ul', 'resource-health-missing-locations');
      for (const location of missing.locations) {
        const locationItem = element(this.options.document, 'li');
        const locationText = element(this.options.document, 'code');
        locationText.textContent = `${this.options.translate('resourceHealth.location', location)}: ${location.raw}`;
        const remove = element(this.options.document, 'button');
        remove.type = 'button';
        remove.textContent = this.options.translate('resourceHealth.removeReference');
        remove.setAttribute(
          'aria-label',
          `${this.options.translate('resourceHealth.removeReference')}: ${this.options.translate('resourceHealth.location', location)}`,
        );
        remove.addEventListener(
          'click',
          () =>
            void this.removeMissingReferences([
              { targetPath: missing.targetPath, raw: location.raw, source: missing.source },
            ]),
        );
        locationItem.append(locationText, remove);
        locations.append(locationItem);
      }
      item.append(locations);
      this.missing.append(item);
    }
    this.renderActions();
  }

  private async trashSelected(): Promise<void> {
    if (!this.current || !this.current.limitations.complete || !this.selected.size) return;
    const selectedCandidates = this.current.candidates.filter((candidate) =>
      this.selected.has(candidate.id),
    );
    if (!(await this.options.confirmMoveToTrash(selectedCandidates))) return;
    this.trashButton.disabled = true;
    let results: readonly ResourceHealthActionResult[];
    try {
      results = await this.options.appAPI.trashResourceHealthCandidates(this.current.revision, [
        ...this.selected,
      ]);
    } catch {
      this.options.showMessage?.(this.options.translate('resourceHealth.scanFailed'), true);
      this.renderActions();
      return;
    }
    const trashed = results.filter(
      (result: ResourceHealthActionResult) => result.code === 'trashed',
    ).length;
    const changedSinceScan = results.some((result) => result.code === 'changed-since-scan');
    if (changedSinceScan && this.options.showChangedSinceScanDialog) {
      const shouldRescan = await this.options.showChangedSinceScanDialog();
      if (shouldRescan || trashed) await this.scan();
      else this.renderActions();
      return;
    }
    this.options.showMessage?.(
      this.options.translate('resourceHealth.trashResult', { trashed, count: results.length }),
      trashed === 0,
    );
    const failures = results.filter((result) => result.code !== 'trashed');
    const partialResult = failures.length
      ? this.options.translate('resourceHealth.trashPartialResult', {
          trashed,
          count: results.length,
          failures: failures
            .map((result) => this.options.translate(`resourceHealth.action.${result.code}`))
            .join(', '),
        })
      : '';
    if (trashed) await this.scan();
    else this.renderActions();
    this.actionResult.textContent = partialResult;
    this.actionResult.classList.toggle('hidden', !partialResult);
  }

  private async removeMissingReference(
    targetPath: string,
    raw: string,
    source: string,
  ): Promise<void> {
    await this.removeMissingReferences([{ targetPath, raw, source }]);
  }

  private async removeSelectedMissingReferences(): Promise<void> {
    if (!this.current || !this.selectedMissing.size) return;
    const entries = this.current.missingReferences
      .filter((missing) => this.selectedMissing.has(missing.targetPath))
      .flatMap((missing) =>
        missing.locations.map((location) => ({
          targetPath: missing.targetPath,
          raw: location.raw,
          source: missing.source,
        })),
      );
    await this.removeMissingReferences(entries);
  }

  private async removeMissingReferences(
    entries: readonly { targetPath: string; raw: string; source: string }[],
  ): Promise<void> {
    const editor = this.options.getActiveEditor();
    if (!editor || !entries.length) return;
    const matching = entries.filter((entry) => editor.content.includes(entry.raw));
    if (!matching.length) {
      this.options.showMessage?.(this.options.translate('resourceHealth.removeSkipped'), true);
      return;
    }
    const confirmed = this.options.confirmRemoveReferences
      ? await this.options.confirmRemoveReferences(matching)
      : await this.options.confirmRemoveReference?.(matching[0].targetPath, matching[0].raw);
    if (!confirmed) return;
    let removed = 0;
    for (const entry of matching) {
      const currentEditor = this.options.getActiveEditor();
      if (
        currentEditor?.content.includes(entry.raw) &&
        this.options.removeImageReference(currentEditor, entry.raw, entry.source)
      )
        removed += 1;
    }
    this.options.showMessage?.(
      this.options.translate('resourceHealth.removeResult', { removed, count: entries.length }),
      removed === 0,
    );
    if (removed) this.invalidate();
  }

  private renderActions(): void {
    const selectedBytes =
      this.current?.candidates
        .filter((candidate) => this.selected.has(candidate.id))
        .reduce((total, candidate) => total + candidate.size, 0) ?? 0;
    this.selectionSummary.textContent = this.options.translate('resourceHealth.selectionSummary', {
      count: this.selected.size,
      size: this.formatSize(selectedBytes),
    });
    this.trashButton.disabled = !this.current?.limitations.complete || this.selected.size === 0;
    this.removeMissingButton.hidden = !this.missingTab.classList.contains('active');
    this.removeMissingButton.disabled =
      !this.current?.missingReferences.length || this.selectedMissing.size === 0;
    this.rescanButton.disabled =
      !this.options.getActiveDocument()?.filePath || !this.options.getWorkspacePath();
  }

  private renderScanStatus(key: string, variables?: Record<string, string | number>): void {
    this.scanStatusText.textContent = this.options.translate(key);
    const isComplete = key === 'resourceHealth.scanStatus.complete';
    this.scanStatusIcon.classList.toggle('hidden', !isComplete);
    this.scanStatusDetail.replaceChildren();
    if (variables) {
      const details = [
        ['resourceHealth.scanDetail.snapshot', 'documentPath'],
        ['resourceHealth.scanDetail.savedAt', 'savedAt'],
        ['resourceHealth.scanDetail.imageDirectory', 'imageDirectory'],
        ['resourceHealth.scanDetail.scanned', 'scanned'],
      ] as const;
      for (const [detailKey, variable] of details) {
        const line = element(this.options.document, 'span');
        line.textContent = this.options.translate(detailKey, { [variable]: variables[variable] });
        this.scanStatusDetail.append(line);
      }
    }
    this.scanStatusDetail.hidden = !variables;
  }

  private inspectCandidate(
    row: HTMLElement,
    candidate: ResourceHealthScanSummary['candidates'][number],
    revision: string,
  ): void {
    this.candidateList
      .querySelectorAll('.resource-health-candidate.is-active')
      .forEach((item) => item.classList.remove('is-active'));
    row.classList.add('is-active');
    this.activeCandidateId = candidate.id;
    this.renderCandidateDetail(candidate, revision);
  }

  private keepFocusInDialog(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => !node.closest('.hidden') && !node.closest('[inert]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && this.options.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.options.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private renderCandidateDetail(
    candidate: ResourceHealthScanSummary['candidates'][number] | null,
    revision: string,
  ): void {
    this.candidatePreview.hidden = true;
    this.candidatePreview.removeAttribute('src');
    this.candidatePreviewPlaceholder.hidden = false;
    this.candidatePreviewPlaceholder.replaceChildren();
    if (candidate && !candidate.previewAvailable) {
      const icon = element(
        this.options.document,
        'span',
        'resource-health-preview-unavailable-icon',
      );
      icon.setAttribute('aria-hidden', 'true');
      const message = element(this.options.document, 'span');
      message.textContent = this.options.translate('resourceHealth.previewUnavailable');
      this.candidatePreviewPlaceholder.append(icon, message);
    } else {
      this.candidatePreviewPlaceholder.textContent = candidate
        ? this.options.translate('resourceHealth.previewUnavailable')
        : this.options.translate('resourceHealth.selectCandidate');
    }
    if (!candidate?.previewAvailable) return;
    void this.options.appAPI
      .previewResourceHealthCandidate(revision, candidate.id)
      .then((url) => {
        if (!url || this.current?.revision !== revision || this.activeCandidateId !== candidate.id)
          return;
        this.candidatePreview.src = url;
        this.candidatePreview.hidden = false;
        this.candidatePreviewPlaceholder.hidden = true;
      })
      .catch(() => undefined);
  }

  private formatSize(bytes: number): string {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.ceil(bytes / 1024)} KB`;
  }

  private formatDate(value: number): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(value),
    );
  }

  private createAnalyzingImage(document: Document): HTMLElement {
    const icon = element(document, 'div', 'resource-health-analyzing-image');
    icon.setAttribute('aria-hidden', 'true');
    const analyzingPathData =
      'M4.27209 20.7279L10.8686 14.1314C11.2646 13.7354 11.4627 13.5373 11.691 13.4632C11.8918 13.3979 12.1082 13.3979 12.309 13.4632C12.5373 13.5373 12.7354 13.7354 13.1314 14.1314L19.6839 20.6839M14 15L16.8686 12.1314C17.2646 11.7354 17.4627 11.5373 17.691 11.4632C17.8918 11.3979 18.1082 11.3979 18.309 11.4632C18.5373 11.5373 18.7354 11.7354 19.1314 12.1314L22 15M10 9C10 10.1046 9.10457 11 8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9ZM6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z';
    const framePathData =
      'M6.8 21H17.2C18.8802 21 19.7202 21 20.362 20.673C20.9265 20.3854 21.3854 19.9265 21.673 19.362C22 18.7202 22 17.8802 22 16.2V7.8C22 6.11984 22 5.27976 21.673 4.63803C21.3854 4.07354 20.9265 3.6146 20.362 3.32698C19.7202 3 18.8802 3 17.2 3H6.8C5.11984 3 4.27976 3 3.63803 3.32698C3.07354 3.6146 2.6146 4.07354 2.32698 4.63803C2 5.27976 2 6.11984 2 7.8V16.2C2 17.8802 2 18.7202 2.32698 19.362C2.6146 19.9265 3.07354 20.3854 3.63803 20.673C4.27976 21 5.11984 21 6.8 21Z';
    const svg = (className: string, pathData: string): SVGSVGElement => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      node.setAttribute('class', className);
      node.setAttribute('viewBox', '0 0 24 24');
      node.setAttribute('fill', 'none');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      node.append(path);
      return node;
    };
    const mask = element(document, 'span', 'resource-health-analyzing-image__mask');
    mask.append(svg('', analyzingPathData));
    // The source animation intentionally layers a pixel-art frame under the smooth masked glyph.
    const frame = svg('resource-health-analyzing-image__glyph', framePathData);
    const pixelRects = [
      [6, 19, 1, 1],
      [7, 18, 1, 1],
      [7, 19, 3, 1],
      [9, 18, 1, 1],
      [14, 19, 3, 1],
      [15, 18, 1, 1],
      [5, 18, 2, 1],
      [5, 17, 1, 1],
      [10, 19, 1, 1],
      [7, 17, 1, 1],
      [11, 19, 1, 1],
      [10, 18, 1, 1],
      [17, 19, 1, 1],
      [15, 4, 2, 1],
      [3, 9, 1, 3],
      [4, 10, 1, 2],
      [6, 9, 1, 1],
      [15, 5, 1, 1],
      [20, 8, 1, 3],
      [19, 9, 1, 1],
      [7, 13, 1, 1],
      [9, 11, 1, 1],
      [16, 12, 1, 2],
      [13, 14, 1, 1],
      [12, 11, 1, 1],
      [10, 9, 1, 1],
      [10, 15, 1, 1],
      [10, 13, 1, 1],
      [15, 9, 1, 1],
      [13, 10, 1, 1],
      [12, 14, 1, 1],
      [5, 4, 3, 1],
      [6, 5, 1, 1],
      [7, 14, 1, 2],
      [6, 14, 3, 1],
      [16, 8, 1, 1],
      [8, 9, 1, 1],
      [20, 16, 1, 1],
      [12, 12, 1, 1],
      [8, 8, 1, 1],
      [14, 12, 1, 1],
      [17, 16, 2, 1],
      [14, 17, 1, 1],
      [11, 5, 3, 1],
      [12, 4, 1, 1],
      [12, 7, 1, 1],
      [7, 11, 1, 1],
      [15, 15, 1, 1],
      [11, 11, 1, 1],
      [13, 9, 1, 1],
      [12, 15, 1, 1],
      [9, 12, 2, 1],
      [19, 13, 2, 1],
      [9, 6, 1, 1],
      [20, 4, 1, 1],
      [19, 4, 1, 1],
      [3, 15, 1, 2],
      [3, 19, 1, 1],
    ] as const;
    for (const [x, y, width, height] of pixelRects) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', 'currentColor');
      frame.append(rect);
    }
    icon.append(
      mask,
      element(document, 'span', 'resource-health-analyzing-image__scanline'),
      frame,
    );
    return icon;
  }
}
