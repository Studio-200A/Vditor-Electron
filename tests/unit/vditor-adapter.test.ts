import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';

describe('Vditor DOM compatibility adapter', () => {
  let window: JSDOM['window'];
  let adapter: any;

  beforeEach(() => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    window = dom.window;
    window.eval(fs.readFileSync(path.resolve('src/renderer/vditor-adapter.js'), 'utf8'));
    adapter = (window as any).VditorDesktopAdapter;
  });

  function createHost(): HTMLElement {
    const host = window.document.createElement('section');
    host.innerHTML = `
      <div class="vditor-toolbar">
        ${['edit-mode', 'both', 'preview', 'outdent', 'indent', 'content-theme']
          .map(
            (type) =>
              `<div class="vditor-toolbar__item"><button data-type="${type}"></button></div>`,
          )
          .join('')}
        <div class="vditor-toolbar__item">
          <button data-type="code-theme"></button>
          <div class="vditor-hint"><button>monokai</button><button>ant-design</button></div>
        </div>
      </div>
      <div class="vditor-content">
        <pre class="vditor-sv vditor-reset"><span data-type="heading-marker">#</span><span data-type="newline">\n</span></pre>
        <pre class="vditor-ir"><h1><span data-type="heading-marker"># </span>IR</h1><span data-type="a"><span class="vditor-ir__link">Jump</span><span class="vditor-ir__marker--link">#ir</span></span></pre>
        <pre class="vditor-wysiwyg"><h1>WYSIWYG</h1><a href="https://example.com">External</a></pre>
        <div class="vditor-preview"><h1>Preview</h1></div>
      </div>`;
    return host;
  }

  it('centralizes and validates the supported Vditor structure', () => {
    const host = createHost();
    expect(Object.isFrozen(adapter.selectors)).toBe(true);
    expect(adapter.validateHost(host)).toEqual({ valid: true, missing: [] });
    expect(adapter.sourceNewlines(adapter.editorParts(host).source)).toHaveLength(1);
    expect(adapter.headingTargets(host, 0).every(({ heading }: any) => heading)).toBe(true);
    expect(adapter.scrollContainers(host).length).toBeGreaterThanOrEqual(4);
  });

  it('classifies the Vditor 3.11 code-theme menu at its light-theme boundary', () => {
    const themes = adapter.classifyCodeThemeButtons(adapter.editorParts(createHost()).toolbar);
    expect(themes.map(({ name, tone }: any) => [name, tone])).toEqual([
      ['monokai', 'dark'],
      ['ant-design', 'light'],
    ]);
  });

  it('reports private DOM drift instead of failing silently', () => {
    const host = createHost();
    adapter.editorParts(host).source.remove();
    expect(adapter.validateHost(host)).toMatchObject({ valid: false, missing: ['source'] });
  });

  it('resolves Vditor list internals through one compatibility boundary', () => {
    const source = window.document.createElement('pre');
    source.innerHTML =
      '<span data-block="0"><span data-type="padding">  </span><span data-type="li-marker">- </span></span>';
    const marker = source.querySelector('[data-type="li-marker"]');
    const context = adapter.listContext(marker?.firstChild);
    expect(context.marker).toBe(marker);
    expect(context.padding?.dataset.type).toBe('padding');
  });

  it('maps document hash links to rendered heading indexes', () => {
    const host = createHost();
    const preview = adapter.editorParts(host).preview;
    preview.innerHTML =
      '<div class="vditor-toc"><span data-target-id="intro">Intro</span></div><h1 id="intro">Intro</h1><h2>Target Section</h2>';
    expect(adapter.headingIndexForAnchor(host, '#intro')).toBe(0);
    expect(adapter.headingIndexForAnchor(host, '#target-section')).toBe(1);
    expect(adapter.headingIndexForAnchor(host, '#missing')).toBe(-1);
    const instantLink = adapter
      .editorParts(host)
      .instantRendering.querySelector('.vditor-ir__link');
    expect(adapter.documentAnchor(instantLink, host).href).toBe('#ir');
    const tocEntry = preview.querySelector('[data-target-id="intro"]');
    expect(adapter.documentAnchor(tocEntry, host)).toMatchObject({ href: '#intro', kind: 'toc' });
    const externalLink = adapter.editorParts(host).wysiwyg.querySelector('a');
    expect(adapter.documentLink(externalLink, host)).toMatchObject({
      href: 'https://example.com',
      kind: 'link',
    });
  });

  it('suppresses and restores native document-link titles while showing an app hint', () => {
    const host = createHost();
    const externalLink = adapter.editorParts(host).wysiwyg.querySelector('a');
    externalLink.title = 'Original title';
    const link = adapter.documentLink(externalLink, host);
    expect(adapter.setDocumentLinkHint(link, 'Ctrl+Click to follow link', 'pointer')).toBe(true);
    expect(externalLink.hasAttribute('title')).toBe(false);
    expect(externalLink.style.cursor).toBe('pointer');
    expect(adapter.clearDocumentLinkHint(link)).toBe(true);
    expect(externalLink).toHaveProperty('title', 'Original title');
    expect(externalLink.style.cursor).toBe('');
  });

  it('places the selection in editable document links but not preview TOC entries', () => {
    const host = createHost();
    window.document.body.append(host);
    const instantLink = adapter
      .editorParts(host)
      .instantRendering.querySelector('.vditor-ir__link');
    const link = adapter.documentAnchor(instantLink, host);
    link.element.closest('.vditor-ir').focus = () => {};
    expect(adapter.focusDocumentLink(link)).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(link.element);

    const preview = adapter.editorParts(host).preview;
    preview.innerHTML = '<div class="vditor-toc"><span data-target-id="intro">Intro</span></div>';
    expect(adapter.focusDocumentLink(adapter.documentAnchor(preview.firstChild, host))).toBe(false);
  });

  it('expands an Instant Rendering link without discarding its text selection', () => {
    const host = createHost();
    window.document.body.append(host);
    const text = adapter.editorParts(host).instantRendering.querySelector('.vditor-ir__link');
    const range = window.document.createRange();
    range.selectNodeContents(text);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    text.closest('.vditor-ir').focus = () => {};

    expect(adapter.expandInstantLinkForEditing(adapter.documentLink(text, host))).toBe(true);
    expect(text.closest('[data-type="a"]')?.classList.contains('vditor-ir__node--expand')).toBe(
      true,
    );
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(adapter.expandInstantLinkForEditing(adapter.documentLink(text, host))).toBe(false);
  });

  it('closes the prior Instant Rendering link expansion before opening another', () => {
    const host = createHost();
    window.document.body.append(host);
    const instantRendering = adapter.editorParts(host).instantRendering;
    instantRendering.insertAdjacentHTML(
      'beforeend',
      '<span data-type="a"><span class="vditor-ir__link">Second</span><span class="vditor-ir__marker--link">#second</span></span>',
    );
    instantRendering.focus = () => {};
    const [first, second] = instantRendering.querySelectorAll('.vditor-ir__link');

    adapter.expandInstantLinkForEditing(adapter.documentLink(first, host));
    adapter.expandInstantLinkForEditing(adapter.documentLink(second, host));

    expect(first.closest('[data-type="a"]')?.classList.contains('vditor-ir__node--expand')).toBe(
      false,
    );
    expect(second.closest('[data-type="a"]')?.classList.contains('vditor-ir__node--expand')).toBe(
      true,
    );
  });

  it('resolves app-protocol image paths back to the active document directory', () => {
    const host = createHost();
    const image = window.document.createElement('img');
    image.src = 'app://app/assets/screenshot-light.webp';
    host.append(image);

    adapter.resolveRelativeImageSources(host, 'local-file://root/home/project/');

    expect(image.dataset.vditorDesktopOriginalSrc).toBe('assets/screenshot-light.webp');
    expect(image.getAttribute('src')).toBe(
      'local-file://root/home/project/assets/screenshot-light.webp',
    );
  });

  it('creates reusable text-match ranges for the active editor without searching the preview', () => {
    const host = createHost();
    window.document.body.append(host);
    const source = adapter.editorParts(host).source;
    source.innerHTML = '<span>alpha </span><span>beta alpha</span>';
    expect(adapter.activeEditor(host, 'sv')).toBe(source);
    expect(adapter.textMatches(host, 'sv', 'alpha')).toHaveLength(2);
    expect(adapter.revealTextMatch(host, 'sv', 'alpha', 1)).toBe(true);
    expect(window.getSelection()?.toString()).toBe('');
    expect(adapter.selectTextMatch(host, 'sv', 'alpha', 1)).toBe(true);
    expect(window.getSelection()?.toString()).toBe('alpha');
    expect(adapter.selectTextMatch(host, 'sv', 'missing', 0)).toBe(false);
  });
});
