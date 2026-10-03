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
      translate: (key, params) => `${key}:${params?.modifier ?? params?.error ?? ''}`,
      showMessage: vi.fn(),
      formatError: vi.fn(() => 'Operation failed'),
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
    host.addEventListener('mousemove', handlers.onMouseMove);
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
    expect(options.showMessage).not.toHaveBeenCalled();
  });

  it.each(['not-found', 'invalid-source', 'unsupported-target'] as const)(
    'reports a %s resolution without opening a document',
    async (code) => {
      vi.mocked(options.resolveMarkdownLink).mockResolvedValue({ kind: 'error', code });
      const controller = new DocumentLinkNavigationController(options);
      attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });
      linkElement.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
      );
      const key = {
        'not-found': 'message.linkTargetMissing',
        'invalid-source': 'message.linkSourceUnavailable',
        'unsupported-target': 'message.linkFileTypeUnsupported',
      }[code];
      await vi.waitFor(() => expect(options.showMessage).toHaveBeenCalledWith(`${key}:`, true));
      expect(options.openPath).not.toHaveBeenCalled();
    },
  );

  it('reports a failed IPC resolution without claiming the target is missing', async () => {
    const failure = new Error('IPC_PERMISSION_DENIED');
    vi.mocked(options.resolveMarkdownLink).mockRejectedValue(failure);
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });
    linkElement.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    await vi.waitFor(() =>
      expect(options.showMessage).toHaveBeenCalledWith('message.openFailed:Operation failed', true),
    );
    expect(options.formatError).toHaveBeenCalledWith(failure);
    expect(options.openPath).not.toHaveBeenCalled();
  });

  it.each([
    ['target.txt', 'message.linkFileTypeUnsupported'],
    ['/notes/target.md', 'message.linkAbsolutePathUnsupported'],
    ['file:///notes/target.md', 'message.linkFileProtocolUnsupported'],
    ['C:\\notes\\target.md', 'message.linkAbsolutePathUnsupported'],
    ['%2Fnotes%2Ftarget.md', 'message.linkAbsolutePathUnsupported'],
  ])('reports unsupported navigation for a modified click on %s', (href, key) => {
    link = { element: linkElement, href, kind: 'link' };
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });
    const event = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    linkElement.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(options.showMessage).toHaveBeenCalledWith(`${key}:`, true);
    expect(options.resolveMarkdownLink).not.toHaveBeenCalled();
    expect(options.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    ['target.txt', 'message.linkFileTypeUnsupported'],
    ['/notes/target.md', 'message.linkAbsolutePathUnsupported'],
    ['file:///notes/target.md', 'message.linkFileProtocolUnsupported'],
  ])('shows the rejection reason with a text cursor while hovering %s', (href, key) => {
    link = { element: linkElement, href, kind: 'link' };
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });
    linkElement.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
    expect(options.adapter.setDocumentLinkHint).toHaveBeenCalledWith(link, `${key}:`, 'text');
    controller.updateHoveredCursor({ ctrlKey: true, metaKey: false });
    expect(options.adapter.setDocumentLinkHint).toHaveBeenCalledTimes(1);
    linkElement.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
    expect(options.showTooltip).toHaveBeenLastCalledWith(`${key}:`, expect.anything());
    expect(options.showMessage).not.toHaveBeenCalled();
    linkElement.dispatchEvent(
      new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(options.adapter.clearDocumentLinkHint).toHaveBeenCalledWith(link);
    expect(options.hideTooltip).toHaveBeenCalledOnce();
    controller.updateHoveredCursor({ ctrlKey: true, metaKey: false });
    expect(options.adapter.setDocumentLinkHint).toHaveBeenCalledTimes(1);
  });

  it('keeps unsupported local links editable without a modifier', () => {
    link = { element: linkElement, href: 'target.txt', kind: 'link' };
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: '/notes/source.md' });
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    linkElement.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(options.adapter.expandInstantLinkForEditing).toHaveBeenCalledWith(link);
    expect(options.showMessage).not.toHaveBeenCalled();
  });

  it('asks to save an untitled source before following its relative link', async () => {
    const controller = new DocumentLinkNavigationController(options);
    attach(controller, { id: 'tab', host, filePath: null });
    linkElement.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    await vi.waitFor(() =>
      expect(options.showMessage).toHaveBeenCalledWith('message.linkSaveFirst:', true),
    );
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
