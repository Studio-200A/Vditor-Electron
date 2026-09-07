import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentLinkNavigationController,
  type DocumentLink,
  type DocumentLinkNavigationControllerOptions,
  type DocumentLinkTab,
} from '../../../src/renderer/editor/document-link-navigation-controller';

interface TestTab extends DocumentLinkTab {
  readonly id: string;
}

describe('DocumentLinkNavigationController', () => {
  let dom: JSDOM;
  let host: HTMLElement;
  let linkElement: HTMLAnchorElement;
  let link: DocumentLink;
  let options: DocumentLinkNavigationControllerOptions<TestTab>;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body><div id="host"><a id="link"></a></div></body>', {
      url: 'https://example.test',
    });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('Node', dom.window.Node);
    host = document.getElementById('host') as HTMLElement;
    linkElement = document.getElementById('link') as HTMLAnchorElement;
    link = { element: linkElement, href: 'target.md#section', kind: 'link' };
    options = {
      adapter: {
        documentLink: (target) => (target === linkElement ? link : null),
        headingIndexForAnchor: () => 0,
        setDocumentLinkHint: vi.fn(),
        setDocumentLinkCursor: vi.fn(),
        clearDocumentLinkHint: vi.fn(),
        expandInstantLinkForEditing: vi.fn(() => false),
        focusDocumentLink: vi.fn(),
      },
      platform: 'linux',
      translate: (key, params) => `${key}:${params?.modifier ?? ''}`,
      showMessage: vi.fn(),
      showTooltip: vi.fn(),
      hideTooltip: vi.fn(),
      resolveMarkdownLink: vi.fn(async () => ({
        kind: 'resolved' as const,
        filePath: '/notes/target.md',
        fragment: 'section',
      })),
      openPath: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      scrollToHeading: vi.fn(),
    };
  });

  afterEach(() => vi.unstubAllGlobals());

  function attach(controller: DocumentLinkNavigationController<TestTab>, tab: TestTab): void {
    const handlers = controller.handlersFor(tab);
    host.addEventListener('click', handlers.onClick);
    host.addEventListener('mouseover', handlers.onMouseOver);
    host.addEventListener('mouseout', handlers.onMouseOut);
  }

  it('resolves a modified relative Markdown link and opens its fragment', async () => {
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });

    linkElement.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );

    await vi.waitFor(() => {
      expect(options.resolveMarkdownLink).toHaveBeenCalledWith(
        '/notes/source.md',
        'target.md#section',
      );
      expect(options.openPath).toHaveBeenCalledWith('/notes/target.md', true, 'section');
    });
  });

  it('blocks unsupported link schemes before browser navigation', () => {
    link = { element: linkElement, href: 'javascript:alert(1)', kind: 'link' };
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });

    linkElement.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(options.adapter.expandInstantLinkForEditing).toHaveBeenCalledWith(link);
    expect(options.resolveMarkdownLink).not.toHaveBeenCalled();
  });

  it('uses a text cursor without a navigation hint for unsupported links', () => {
    link = { element: linkElement, href: 'javascript:alert(1)', kind: 'link' };
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });

    linkElement.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    expect(options.adapter.setDocumentLinkCursor).toHaveBeenCalledWith(link, 'text');
    expect(options.adapter.setDocumentLinkHint).not.toHaveBeenCalled();
    expect(options.showTooltip).not.toHaveBeenCalled();

    linkElement.dispatchEvent(
      new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(options.adapter.clearDocumentLinkHint).toHaveBeenCalledWith(link);
  });

  it('shows a platform-specific modifier hint and clears it when leaving the link', () => {
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });

    linkElement.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    expect(options.adapter.setDocumentLinkHint).toHaveBeenCalledWith(
      link,
      'link.followWithModifier:Ctrl',
      'text',
    );
    controller.updateHoveredCursor({ ctrlKey: true, metaKey: false });
    expect(options.adapter.setDocumentLinkHint).toHaveBeenLastCalledWith(
      link,
      'link.followWithModifier:Ctrl',
      'pointer',
    );
    linkElement.dispatchEvent(
      new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(options.showTooltip).toHaveBeenCalled();
    expect(options.adapter.clearDocumentLinkHint).toHaveBeenCalledWith(link);
    expect(options.hideTooltip).toHaveBeenCalledOnce();
  });
});
