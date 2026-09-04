import type { VditorDesktopAdapter } from './adapter.js';

/** Runtime tests compare this declaration manifest with the frozen adapter facade. */
export const ADAPTER_PUBLIC_KEYS = [
  'selectors',
  'editorParts',
  'ensureSplitResizer',
  'splitViewVisibility',
  'toolbarContext',
  'toolbarButton',
  'hideNativeOutlineControl',
  'keepSplitToolbarActionsAvailable',
  'toolbarHint',
  'selectEditMode',
  'editModeShortcut',
  'toolbarHints',
  'hoverTooltips',
  'openSubmenus',
  'codeThemeButtons',
  'classifyCodeThemeButtons',
  'sourceNewlines',
  'sourceLineRanges',
  'renderSplitDecorations',
  'syncSplitDecorationScroll',
  'captureSplitIndentSelection',
  'applySplitListIndent',
  'installSplitAutoIndent',
  'listContext',
  'headingTargets',
  'outlineContentElement',
  'outlineSnapshot',
  'outlineScrollContainer',
  'outlineHeadingTargets',
  'observeOutlineChanges',
  'innerScroller',
  'scrollContainers',
  'activeEditor',
  'editorScrollContainer',
  'preserveTableScrollDuringInput',
  'isEditableTarget',
  'captureEditorSelection',
  'restoreEditorSelection',
  'selectCurrentContextOrAll',
  'tableContext',
  'performTableAction',
  'executeEditorCommand',
  'selectedTableCell',
  'selectTableCellContents',
  'setEditorBottomSpacer',
  'textMatches',
  'clearFindHighlights',
  'highlightTextMatches',
  'animateDocumentNavigationScroll',
  'scrollRangeIntoView',
  'revealTextMatch',
  'selectTextMatch',
  'replaceTextMatch',
  'documentAnchor',
  'documentLink',
  'setDocumentLinkHint',
  'clearDocumentLinkHint',
  'focusDocumentLink',
  'expandInstantLinkForEditing',
  'headingIndexForAnchor',
  'relativeSourceFromLocalUrl',
  'resolveRelativeImageSources',
  'resolveRelativeDocumentLinks',
  'observeRelativeImageSources',
  'reloadImageSources',
  'withOriginalImageSources',
  'validateHost',
] as const satisfies readonly (keyof VditorDesktopAdapter)[];

/** This file is included by renderer strict typechecking but has no runtime caller. */
export function verifyAdapterCallContract(adapter: VditorDesktopAdapter, host: HTMLElement): void {
  const parts = adapter.editorParts(host);
  const toolbar = parts.toolbar;
  const selection = adapter.captureSplitIndentSelection(host);
  const table = adapter.tableContext(host, 'ir', host);
  const link = adapter.documentLink(host, host);

  adapter.ensureSplitResizer(host);
  adapter.splitViewVisibility(host, 'sv');
  adapter.toolbarContext(host);
  adapter.toolbarButton(toolbar, 'edit-mode');
  adapter.hideNativeOutlineControl(toolbar);
  adapter.keepSplitToolbarActionsAvailable(toolbar);
  adapter.toolbarHint(toolbar);
  adapter.selectEditMode(toolbar, 'wysiwyg');
  adapter.editModeShortcut(new KeyboardEvent('keydown'));
  adapter.toolbarHints(document);
  adapter.hoverTooltips(host);
  adapter.openSubmenus(host);
  adapter.codeThemeButtons(toolbar);
  adapter.classifyCodeThemeButtons(toolbar);
  adapter.sourceNewlines(parts.source);
  adapter.sourceLineRanges(parts.source);
  adapter.renderSplitDecorations(host, 'sv', true, 4);
  adapter.syncSplitDecorationScroll(host);
  adapter.applySplitListIndent(host, 'indent', selection);
  adapter.installSplitAutoIndent(host, () => true);
  adapter.listContext(host.firstChild);
  adapter.headingTargets(host, 0);
  adapter.outlineContentElement(host, 'ir');
  adapter.outlineSnapshot(host, 'ir');
  adapter.outlineScrollContainer(host, 'ir');
  adapter.outlineHeadingTargets(host, 'sv', 0);
  adapter.observeOutlineChanges(host, () => undefined);
  adapter.innerScroller(host);
  adapter.scrollContainers(host);
  adapter.activeEditor(host, 'ir');
  adapter.editorScrollContainer(host, 'ir');
  adapter.preserveTableScrollDuringInput(host, () => 'ir');
  adapter.isEditableTarget(host, 'ir', host);
  adapter.restoreEditorSelection(adapter.captureEditorSelection(host, 'ir', host, 0, 0));
  adapter.selectCurrentContextOrAll(host, 'ir');
  adapter.performTableAction(table, 'insert-row');
  adapter.executeEditorCommand(host, 'ir', 'paste', { text: 'text', html: '<p>text</p>' });
  const selectedCell = adapter.selectedTableCell(host, 'ir');
  adapter.selectTableCellContents(selectedCell?.cell, selectedCell?.editor);
  adapter.setEditorBottomSpacer(host, 24);
  const matches = adapter.textMatches(host, 'ir', 'text');
  adapter.clearFindHighlights();
  adapter.highlightTextMatches(host, 'ir', 'text', 0);
  adapter.animateDocumentNavigationScroll(host, 24);
  adapter.scrollRangeIntoView(matches[0]?.range, host);
  adapter.revealTextMatch(host, 'ir', 'text');
  adapter.selectTextMatch(host, 'ir', 'text');
  adapter.replaceTextMatch(host, 'ir', 'text', 0, 'replacement');
  adapter.documentAnchor(host, host);
  adapter.setDocumentLinkHint(link, 'hint', 'pointer');
  adapter.clearDocumentLinkHint(link);
  adapter.focusDocumentLink(link);
  adapter.expandInstantLinkForEditing(link);
  adapter.headingIndexForAnchor(host, '#heading');
  adapter.relativeSourceFromLocalUrl('local-file://root/image.png', 'local-file://root/');
  adapter.resolveRelativeImageSources(host, 'local-file://root/');
  adapter.resolveRelativeDocumentLinks(host, 'local-file://root/');
  adapter.observeRelativeImageSources(host, 'local-file://root/');
  adapter.reloadImageSources(host);
  adapter.withOriginalImageSources(host, () => 1);
  adapter.validateHost(host, toolbar);

  // @ts-expect-error Adapter modes are a finite Vditor contract.
  adapter.selectEditMode(toolbar, 'preview');
  // @ts-expect-error Relative-source conversion requires both URLs.
  adapter.relativeSourceFromLocalUrl('local-file://root/image.png');
}
