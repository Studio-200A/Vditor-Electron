export type AdapterEditMode = 'wysiwyg' | 'ir' | 'sv';
export type SplitListAction = 'indent' | 'outdent';

export interface EditorParts {
  readonly toolbar: HTMLElement | null;
  readonly content: HTMLElement | null;
  readonly source: HTMLElement | null;
  readonly instantRendering: HTMLElement | null;
  readonly wysiwyg: HTMLElement | null;
  readonly preview: HTMLElement | null;
}

export interface ToolbarContext {
  readonly button: HTMLButtonElement | null;
  readonly item: HTMLElement | null;
  readonly trigger: HTMLButtonElement | null;
  readonly type: string;
}

export interface SourceLineRange {
  readonly range: Range;
  readonly fallbackRange: Range;
}

export interface CodeThemeButton {
  readonly button: HTMLButtonElement;
  readonly name: string;
  readonly tone: 'dark' | 'light';
}

export interface ListContext {
  readonly block: HTMLElement | null;
  readonly marker: HTMLElement | null;
  readonly padding: HTMLElement | null;
}

export interface HeadingTarget {
  readonly editor: HTMLElement | null;
  readonly heading: Element | null;
}

export interface OutlineSnapshotEntry {
  readonly index: number;
  readonly level: number;
  readonly text: string;
  readonly key: string;
}

export interface OutlineHeadingTarget {
  readonly scroller: HTMLElement | null;
  readonly heading: Element;
}

export interface EditorSelection {
  readonly editor: HTMLElement;
  readonly range: Range;
}

export interface SelectionScope {
  readonly scope: 'line' | 'cell' | 'block' | 'all';
}

export interface TableContext {
  readonly editor: HTMLElement;
  readonly table: HTMLTableElement;
  readonly cell: HTMLTableCellElement;
  readonly mode: Extract<AdapterEditMode, 'ir' | 'wysiwyg'>;
}

/** Minimal private Vditor surface read by the adapter's table action only. */
export interface VditorUndoAdapterSurface {
  recordFirstPosition(instance: VditorTableAdapterSurface, event: { readonly key: string }): void;
  addToUndoStack(instance: VditorTableAdapterSurface): void;
}

export interface VditorModeAdapterSurface {
  preventInput: boolean;
}

export interface VditorTableAdapterSurface {
  readonly undo?: VditorUndoAdapterSurface;
  readonly ir?: VditorModeAdapterSurface;
  readonly wysiwyg?: VditorModeAdapterSurface;
}

export interface FindMatch {
  readonly start: number;
  readonly end: number;
  readonly range: Range;
}

export interface DocumentLink {
  readonly element: Element;
  readonly href: string;
  readonly kind: 'link' | 'toc';
}

export interface HostValidationResult {
  readonly valid: boolean;
  readonly missing: string[];
}

export interface ClipboardContent {
  readonly text?: string;
  readonly html?: string;
}

export interface VditorDesktopAdapter {
  readonly selectors: Readonly<Record<string, string>>;
  editorParts(host: HTMLElement | null | undefined): EditorParts;
  ensureSplitResizer(host: HTMLElement | null | undefined): HTMLElement | null;
  splitViewVisibility(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
  ): { readonly sourceVisible: boolean; readonly previewVisible: boolean } | null;
  toolbarContext(target: EventTarget | null | undefined): ToolbarContext;
  toolbarButton(toolbar: HTMLElement | null | undefined, type: string): HTMLButtonElement | null;
  hideNativeOutlineControl(toolbar: HTMLElement | null | undefined): boolean;
  keepSplitToolbarActionsAvailable(toolbar: HTMLElement | null | undefined): boolean;
  toolbarHint(item: Element | null | undefined): HTMLElement | null;
  selectEditMode(toolbar: HTMLElement | null | undefined, mode: AdapterEditMode): boolean;
  editModeShortcut(event: KeyboardEvent | null | undefined): AdapterEditMode | null;
  toolbarHints(root?: Document | HTMLElement): HTMLElement[];
  hoverTooltips(root?: Document | HTMLElement): HTMLElement[];
  openSubmenus(root?: Document | HTMLElement): HTMLElement[];
  codeThemeButtons(toolbar: HTMLElement | null | undefined): HTMLButtonElement[];
  classifyCodeThemeButtons(toolbar: HTMLElement | null | undefined): CodeThemeButton[];
  sourceNewlines(source: HTMLElement | null | undefined): HTMLElement[];
  sourceLineRanges(source: HTMLElement | null | undefined): SourceLineRange[];
  renderSplitDecorations(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    showWhitespace: boolean,
    tabSize: number,
  ): boolean;
  syncSplitDecorationScroll(host: HTMLElement | null | undefined): boolean;
  captureSplitIndentSelection(host: HTMLElement | null | undefined): Range | null;
  applySplitListIndent(
    host: HTMLElement | null | undefined,
    type: SplitListAction,
    storedRange: Range | null | undefined,
  ): boolean;
  installSplitAutoIndent(
    host: HTMLElement | null | undefined,
    shouldAutoIndent: () => boolean,
  ): (() => void) | null;
  listContext(node: Node | null | undefined): ListContext;
  headingTargets(host: HTMLElement | null | undefined, headingIndex: number): HeadingTarget[];
  outlineContentElement(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
  ): HTMLElement | null;
  outlineSnapshot(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
  ): OutlineSnapshotEntry[];
  outlineScrollContainer(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
  ): HTMLElement | null;
  outlineHeadingTargets(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    headingIndex: number,
  ): OutlineHeadingTarget[];
  observeOutlineChanges(
    host: HTMLElement | null | undefined,
    callback: MutationCallback,
  ): MutationObserver | null;
  innerScroller(node: Element | null | undefined): HTMLElement | null;
  scrollContainers(host: HTMLElement | null | undefined): HTMLElement[];
  activeEditor(host: HTMLElement | null | undefined, mode: AdapterEditMode): HTMLElement | null;
  editorScrollContainer(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
  ): HTMLElement | null;
  preserveTableScrollDuringInput(
    host: HTMLElement | null | undefined,
    getMode: () => AdapterEditMode,
  ): () => void;
  isEditableTarget(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    target: EventTarget | null | undefined,
  ): boolean;
  captureEditorSelection(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    target?: EventTarget | null,
    clientX?: number | null,
    clientY?: number | null,
  ): EditorSelection | null;
  restoreEditorSelection(selection: EditorSelection | null | undefined): boolean;
  selectCurrentContextOrAll(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
  ): SelectionScope | null;
  tableContext(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    target: EventTarget | null | undefined,
  ): TableContext | null;
  performTableAction(
    context: TableContext | null | undefined,
    action: 'insert-row' | 'delete-row' | 'insert-column' | 'delete-column',
    vditor?: VditorTableAdapterSurface | null,
  ): boolean;
  executeEditorCommand(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    command: string,
    clipboard?: ClipboardContent | null,
  ): boolean;
  selectedTableCell(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
  ): { readonly editor: HTMLElement; readonly cell: HTMLTableCellElement } | null;
  selectTableCellContents(
    cell: HTMLTableCellElement | null | undefined,
    editor: HTMLElement | null | undefined,
  ): boolean;
  setEditorBottomSpacer(host: HTMLElement | null | undefined, height: number): boolean;
  textMatches(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    query: string,
    caseSensitive?: boolean,
  ): FindMatch[];
  clearFindHighlights(): void;
  highlightTextMatches(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    query: string,
    activeIndex: number,
    caseSensitive?: boolean,
  ): FindMatch[];
  animateDocumentNavigationScroll(
    scroller: HTMLElement | null | undefined,
    destination: number,
  ): boolean;
  scrollRangeIntoView(
    range: Range | null | undefined,
    editor: HTMLElement | null | undefined,
  ): boolean;
  revealTextMatch(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    query: string,
    occurrence?: number,
    caseSensitive?: boolean,
  ): boolean;
  selectTextMatch(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    query: string,
    occurrence?: number,
    caseSensitive?: boolean,
  ): boolean;
  replaceTextMatch(
    host: HTMLElement | null | undefined,
    mode: AdapterEditMode,
    query: string,
    occurrence: number,
    replacement: string,
    caseSensitive?: boolean,
  ): boolean;
  documentAnchor(
    target: EventTarget | null | undefined,
    host: HTMLElement | null | undefined,
  ): DocumentLink | null;
  documentLink(
    target: EventTarget | null | undefined,
    host: HTMLElement | null | undefined,
  ): DocumentLink | null;
  setDocumentLinkHint(link: DocumentLink | null | undefined, hint: string, cursor: string): boolean;
  clearDocumentLinkHint(link: DocumentLink | null | undefined): boolean;
  focusDocumentLink(link: DocumentLink | null | undefined): boolean;
  expandInstantLinkForEditing(link: DocumentLink | null | undefined): boolean;
  headingIndexForAnchor(host: HTMLElement | null | undefined, href: string): number;
  relativeSourceFromLocalUrl(source: string, baseUrl: string): string;
  resolveRelativeImageSources(host: HTMLElement | null | undefined, baseUrl: string): void;
  resolveRelativeDocumentLinks(host: HTMLElement | null | undefined, baseUrl: string): void;
  observeRelativeImageSources(
    host: HTMLElement | null | undefined,
    baseUrl: string,
  ): MutationObserver | null;
  reloadImageSources(host: HTMLElement | null | undefined): number;
  withOriginalImageSources<T>(host: HTMLElement | null | undefined, callback: () => T): T;
  validateHost(
    host: HTMLElement | null | undefined,
    mountedToolbar?: HTMLElement | null,
  ): HostValidationResult;
}

declare global {
  interface Window {
    VditorDesktopAdapter: VditorDesktopAdapter;
  }
}
