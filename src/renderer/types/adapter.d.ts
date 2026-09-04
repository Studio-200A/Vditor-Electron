export interface EditorParts {
  toolbar: HTMLElement | null;
  content: HTMLElement | null;
  source: HTMLElement | null;
  instantRendering: HTMLElement | null;
  wysiwyg: HTMLElement | null;
  preview: HTMLElement | null;
}

export interface ToolbarContext {
  button: HTMLButtonElement | null;
  item: HTMLElement | null;
  trigger: HTMLElement | null;
  type: string;
}

export interface VditorDesktopAdapter {
  readonly selectors: Readonly<Record<string, string>>;
  editorParts(host: HTMLElement): EditorParts;
  ensureSplitResizer(host: HTMLElement): HTMLElement | null;
  splitViewVisibility(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
  ): { sourceVisible: boolean; previewVisible: boolean } | null;
  toolbarContext(target: EventTarget | null): ToolbarContext;
  toolbarButton(toolbar: HTMLElement | null, type: string): HTMLButtonElement | null;
  hideNativeOutlineControl(toolbar: HTMLElement | null): void;
  keepSplitToolbarActionsAvailable(toolbar: HTMLElement | null): void;
  toolbarHint(toolbar: HTMLElement | null, type: string): HTMLElement | null;
  selectEditMode(host: HTMLElement, mode: 'wysiwyg' | 'ir' | 'sv'): void;
  editModeShortcut(host: HTMLElement): 'wysiwyg' | 'ir' | 'sv' | null;
  toolbarHints(toolbar: HTMLElement | null): HTMLElement[];
  hoverTooltips(root?: Document | HTMLElement): HTMLElement[];
  openSubmenus(root?: Document | HTMLElement): HTMLElement[];
  codeThemeButtons(root?: Document | HTMLElement): HTMLElement[];
  classifyCodeThemeButtons(buttons: HTMLElement[]): { valid: boolean; missing: string[] };
  sourceNewlines(host: HTMLElement): HTMLElement[];
  sourceLineRanges(host: HTMLElement): HTMLElement[];
  renderSplitDecorations(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    showWhitespace: boolean,
    tabSize: number,
  ): boolean;
  syncSplitDecorationScroll(host: HTMLElement): boolean;
  captureSplitIndentSelection(host: HTMLElement): Range | null;
  applySplitListIndent(host: HTMLElement, type: 'indent' | 'outdent', range: Range | null): boolean;
  installSplitAutoIndent(host: HTMLElement, shouldAutoIndent: () => boolean): (() => void) | null;
  listContext(host: HTMLElement): unknown;
  headingTargets(host: HTMLElement): HTMLElement[];
  outlineContentElement(host: HTMLElement): HTMLElement | null;
  outlineSnapshot(host: HTMLElement): unknown;
  outlineScrollContainer(host: HTMLElement): HTMLElement | null;
  outlineHeadingTargets(host: HTMLElement): HTMLElement[];
  observeOutlineChanges(host: HTMLElement, callback: () => void): { disconnect(): void };
  innerScroller(host: HTMLElement): HTMLElement | null;
  scrollContainers(host: HTMLElement): HTMLElement[];
  activeEditor(host: HTMLElement): HTMLElement | null;
  editorScrollContainer(host: HTMLElement): HTMLElement | null;
  preserveTableScrollDuringInput(host: HTMLElement): void;
  isEditableTarget(target: EventTarget | null): boolean;
  captureEditorSelection(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    target?: EventTarget | null,
  ): { editor: HTMLElement; range: Range } | null;
  restoreEditorSelection(selection: { editor: HTMLElement; range: Range } | null): boolean;
  selectCurrentContextOrAll(host: HTMLElement): void;
  tableContext(host: HTMLElement): unknown;
  performTableAction(host: HTMLElement, action: string): void;
  executeEditorCommand(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    command: string,
    clipboard?: { text: string; html: string } | null,
  ): boolean;
  selectedTableCell(host: HTMLElement): HTMLElement | null;
  selectTableCellContents(host: HTMLElement, cell: HTMLElement): void;
  setEditorBottomSpacer(host: HTMLElement, height: number): void;
  textMatches(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    query: string,
    caseSensitive?: boolean,
  ): unknown[];
  clearFindHighlights(host: HTMLElement): void;
  highlightTextMatches(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    query: string,
    activeIndex: number,
    caseSensitive?: boolean,
  ): unknown[];
  animateDocumentNavigationScroll(host: HTMLElement, target: number): boolean;
  scrollRangeIntoView(host: HTMLElement, range: Range): boolean;
  revealTextMatch(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    query: string,
    occurrence?: number,
    caseSensitive?: boolean,
  ): boolean;
  selectTextMatch(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    query: string,
    occurrence?: number,
    caseSensitive?: boolean,
  ): boolean;
  replaceTextMatch(
    host: HTMLElement,
    mode: 'wysiwyg' | 'ir' | 'sv',
    query: string,
    occurrence: number,
    replacement: string,
    caseSensitive?: boolean,
  ): boolean;
  documentAnchor(host: HTMLElement): HTMLElement | null;
  documentLink(host: HTMLElement): HTMLElement | null;
  setDocumentLinkHint(host: HTMLElement, element: HTMLElement): void;
  clearDocumentLinkHint(host: HTMLElement): void;
  focusDocumentLink(host: HTMLElement): void;
  expandInstantLinkForEditing(host: HTMLElement): void;
  headingIndexForAnchor(host: HTMLElement, anchor: string): number;
  relativeSourceFromLocalUrl(url: string): string | null;
  resolveRelativeImageSources(host: HTMLElement, baseDir: string): { restore(): void };
  resolveRelativeDocumentLinks(host: HTMLElement, baseDir: string): { restore(): void };
  observeRelativeImageSources(
    host: HTMLElement,
    baseDir: string,
    callback: () => void,
  ): { disconnect(): void };
  reloadImageSources(host: HTMLElement): void;
  withOriginalImageSources(host: HTMLElement): { restore(): void };
  validateHost(host: HTMLElement): boolean;
}

declare global {
  interface Window {
    VditorDesktopAdapter: VditorDesktopAdapter;
  }
}
