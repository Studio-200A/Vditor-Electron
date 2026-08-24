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
        ${['edit-mode', 'both', 'preview', 'outdent', 'indent', 'outline', 'content-theme']
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
        <div class="vditor-ir"><pre class="vditor-reset"><h1><span data-type="heading-marker"># </span>IR</h1><span data-type="a"><span class="vditor-ir__link">Jump</span><span class="vditor-ir__marker--link">#ir</span></span></pre></div>
        <div class="vditor-wysiwyg"><pre class="vditor-reset"><h1>WYSIWYG</h1><a href="https://example.com">External</a></pre></div>
        <div class="vditor-preview"><div class="vditor-reset"><h1>Preview</h1></div></div>
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

  it('applies one bottom spacer to every Vditor editing surface', () => {
    const host = createHost();
    const parts = adapter.editorParts(host);

    expect(adapter.setEditorBottomSpacer(host, 241.6)).toBe(true);
    [parts.source, parts.instantRendering, parts.wysiwyg, parts.preview].forEach((editor) =>
      expect(editor.style.getPropertyValue('--editor-bottom')).toBe('242px'),
    );
    expect(adapter.setEditorBottomSpacer(host, Number.NaN)).toBe(false);
  });

  it('classifies the Vditor 3.11 code-theme menu at its light-theme boundary', () => {
    const themes = adapter.classifyCodeThemeButtons(adapter.editorParts(createHost()).toolbar);
    expect(themes.map(({ name, tone }: any) => [name, tone])).toEqual([
      ['monokai', 'dark'],
      ['ant-design', 'light'],
    ]);
  });

  it('keeps Vditor native outline internals available while hiding their control', () => {
    const toolbar = adapter.editorParts(createHost()).toolbar;

    expect(adapter.hideNativeOutlineControl(toolbar)).toBe(true);
    const item = adapter.toolbarButton(toolbar, 'outline')?.closest('.vditor-toolbar__item');
    expect(item?.dataset.vditorDesktopHiddenOutline).toBe('true');
  });

  it('keeps Desktop split-view list actions in a stable toolbar slot', () => {
    const toolbar = adapter.editorParts(createHost()).toolbar;

    expect(adapter.keepSplitToolbarActionsAvailable(toolbar)).toBe(true);
    ['outdent', 'indent'].forEach((type) => {
      const item = adapter.toolbarButton(toolbar, type)?.closest('.vditor-toolbar__item');
      expect(item?.dataset.vditorDesktopSplitToolbarAction).toBe('true');
    });
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

  it('returns a range for every source-text line when markers contain multiple lines', () => {
    const source = window.document.createElement('pre');
    source.innerHTML =
      '<span data-type="marker">first\nsecond\n</span><span data-type="newline">\n</span><span>third</span><span data-type="newline">\n</span>';

    const lines = adapter.sourceLineRanges(source);

    expect(lines.map(({ range }: any) => range.toString())).toEqual([
      'first',
      'second',
      '',
      'third',
    ]);
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

  it('uses the same current editor or visible preview content as Vditor native outline', () => {
    const host = createHost();
    const instant = adapter.editorParts(host).instantRendering;
    const instantContent = instant.querySelector('.vditor-reset');
    instantContent.innerHTML = '<h1>Editor title</h1>';
    expect(adapter.outlineSnapshot(host, 'ir')).toEqual([
      { index: 0, key: '1:Editor title:0', level: 1, text: 'Editor title' },
    ]);

    const preview = adapter.editorParts(host).preview;
    preview.style.display = 'block';
    preview.querySelector('.vditor-reset').innerHTML =
      '<h1>Preview title</h1><h2>Repeated</h2><h2>Repeated</h2>';
    expect(adapter.outlineSnapshot(host, 'ir')).toEqual([
      { index: 0, key: '1:Preview title:0', level: 1, text: 'Preview title' },
      { index: 1, key: '2:Repeated:0', level: 2, text: 'Repeated' },
      { index: 2, key: '2:Repeated:1', level: 2, text: 'Repeated' },
    ]);

    preview.style.display = 'none';
    instantContent.innerHTML = '';
    expect(adapter.outlineSnapshot(host, 'ir')).toEqual([]);
  });

  it('keeps outline heading targets attached to their elements and actual scroll containers', () => {
    const host = createHost();
    const instant = adapter.editorParts(host).instantRendering;
    const instantContent = instant.querySelector('.vditor-reset');
    instantContent.innerHTML = '<h1>Top</h1><p>Intro</p><h2>Target</h2>';

    const instantTarget = adapter.outlineHeadingTargets(host, 'ir', 1);
    expect(instantTarget).toHaveLength(1);
    expect(instantTarget[0].heading).toBe(instantContent.querySelector('h2'));
    expect(instantTarget[0].scroller).toBe(instantContent);

    const { preview, source } = adapter.editorParts(host);
    preview.style.display = 'block';
    preview.querySelector('.vditor-reset').innerHTML = '<h1>Top</h1><p>Intro</p><h2>Target</h2>';
    source.innerHTML =
      '<span data-type="heading-marker">#</span><span data-type="heading-marker">##</span>';

    const splitTargets = adapter.outlineHeadingTargets(host, 'sv', 1);
    expect(splitTargets).toHaveLength(2);
    expect(splitTargets[0].scroller).toBe(source);
    expect(splitTargets[0].heading).toBe(
      source.querySelectorAll('[data-type="heading-marker"]')[1],
    );
    expect(splitTargets[1].scroller).toBe(preview);
    expect(splitTargets[1].heading).toBe(preview.querySelector('h2'));
  });

  it('observes asynchronous preview outline changes and supports cleanup', async () => {
    const host = createHost();
    let changes = 0;
    const observer = adapter.observeOutlineChanges(host, () => {
      changes += 1;
    });
    adapter
      .editorParts(host)
      .preview.querySelector('.vditor-reset')
      .append(window.document.createElement('h2'));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(changes).toBeGreaterThan(0);

    observer.disconnect();
    const afterDisconnect = changes;
    adapter.editorParts(host).preview.style.display = 'block';
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(changes).toBe(afterDisconnect);
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

  it('restores link-base URLs to relative document paths', () => {
    const host = createHost();
    const link = window.document.createElement('a');
    link.href = 'local-file://root/home/project/docs/target.md#section';
    host.append(link);

    adapter.resolveRelativeDocumentLinks(host, 'local-file://root/home/project/docs/');

    expect(link.getAttribute('href')).toBe('target.md#section');
    expect(
      adapter.relativeSourceFromLocalUrl(
        'local-file://root/home/project/assets/pixel.png',
        'local-file://root/home/project/docs/',
      ),
    ).toBe('../assets/pixel.png');
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

  it('selects the current rendered block before the whole editor', () => {
    const host = createHost();
    window.document.body.append(host);
    const content = adapter.editorParts(host).wysiwyg.querySelector('.vditor-reset');
    content.innerHTML = '<p data-block="0">First block</p><p data-block="0">Second block</p>';
    const firstText = content.querySelector('p').firstChild;
    const caret = window.document.createRange();
    caret.setStart(firstText, 2);
    caret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(caret);

    expect(adapter.isEditableTarget(host, 'wysiwyg', firstText)).toBe(true);
    expect(adapter.selectCurrentContextOrAll(host, 'wysiwyg')).toEqual({ scope: 'block' });
    expect(window.getSelection()?.toString()).toBe('First block');
    expect(adapter.selectCurrentContextOrAll(host, 'wysiwyg')).toEqual({ scope: 'all' });
    expect(window.getSelection()?.toString()).toBe('First blockSecond block');
  });

  it('uses table cells and source lines as the first selection context', () => {
    const host = createHost();
    window.document.body.append(host);
    const { instantRendering, source } = adapter.editorParts(host);
    const instantContent = instantRendering.querySelector('.vditor-reset');
    instantContent.innerHTML =
      '<table data-block="0"><tbody><tr><td>Cell text</td><td> \u200b</td></tr></tbody></table>';
    const cellText = instantContent.querySelector('td').firstChild;
    const caret = window.document.createRange();
    caret.setStart(cellText, 2);
    caret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(caret);
    expect(adapter.selectCurrentContextOrAll(host, 'ir')).toEqual({ scope: 'cell' });
    expect(window.getSelection()?.toString()).toBe('Cell text');

    const emptyCell = instantContent.querySelectorAll('td')[1];
    const emptyCaret = window.document.createRange();
    emptyCaret.setStart(emptyCell, 0);
    emptyCaret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(emptyCaret);
    expect(adapter.selectCurrentContextOrAll(host, 'ir')).toEqual({ scope: 'all' });

    source.innerHTML =
      '<span>first line</span><span data-type="newline">\n</span><span>second line</span><span data-type="newline">\n</span>';
    const secondText = source.querySelectorAll('span')[2].firstChild;
    const sourceCaret = window.document.createRange();
    sourceCaret.setStart(secondText, 3);
    sourceCaret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(sourceCaret);
    expect(adapter.selectCurrentContextOrAll(host, 'sv')).toEqual({ scope: 'line' });
    expect(window.getSelection()?.toString()).toBe('second line');
    expect(adapter.selectCurrentContextOrAll(host, 'sv')).toEqual({ scope: 'all' });
    expect(window.getSelection()?.toString()).toBe('first line\nsecond line\n');

    source.innerHTML =
      '<div data-block="0"><span class="vditor-sv__marker">&lt;p&gt;<span data-type="newline">\n</span>  &lt;a&gt;badge&lt;/a&gt;<span data-type="newline">\n</span>&lt;/p&gt;</span><span data-type="newline">\n</span></div>';
    const htmlLine = Array.from(source.querySelector('.vditor-sv__marker').childNodes).find(
      (node) => node.nodeType === window.Node.TEXT_NODE && node.textContent?.includes('badge'),
    );
    if (!htmlLine) throw new Error('Expected nested raw HTML source line');
    const htmlCaret = window.document.createRange();
    htmlCaret.setStart(htmlLine, htmlLine.textContent.length);
    htmlCaret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(htmlCaret);
    expect(adapter.selectCurrentContextOrAll(host, 'sv')).toEqual({ scope: 'line' });
    expect(window.getSelection()?.toString()).toBe('  <a>badge</a>');
  });

  it('keeps table context, Range restoration, and table mutations behind the adapter', () => {
    const host = createHost();
    window.document.body.append(host);
    const content = adapter.editorParts(host).instantRendering.querySelector('.vditor-reset');
    content.innerHTML =
      '<table data-block="0"><thead><tr><th>head</th></tr></thead><tbody><tr><td>value</td></tr></tbody></table>';
    const cell = content.querySelector('td');
    const text = cell.firstChild;
    const range = window.document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const saved = adapter.captureEditorSelection(host, 'ir');
    const otherRange = window.document.createRange();
    otherRange.selectNodeContents(content.querySelector('th'));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(otherRange);
    content.focus = () => {};
    expect(adapter.restoreEditorSelection(saved)).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(text);

    const context = adapter.tableContext(host, 'ir', text);
    expect(context).toMatchObject({ cell, table: content.querySelector('table'), mode: 'ir' });
    expect(adapter.tableContext(host, 'sv', text)).toBeNull();
    let inputs = 0;
    context.editor.addEventListener('input', () => {
      inputs += 1;
    });
    expect(adapter.performTableAction(context, 'insert-row')).toBe(true);
    expect(context.table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(adapter.performTableAction(context, 'insert-column')).toBe(true);
    expect(context.table.rows[0].cells).toHaveLength(2);
    expect(adapter.performTableAction(context, 'delete-column')).toBe(true);
    expect(context.table.rows[0].cells).toHaveLength(1);
    expect(inputs).toBe(3);
  });

  it('leaves Vditor auxiliary controls and preview content out of editor selection handling', () => {
    const host = createHost();
    window.document.body.append(host);
    const { source, wysiwyg, preview } = adapter.editorParts(host);
    const input = window.document.createElement('input');
    const sourceMarker = window.document.createElement('span');
    sourceMarker.contentEditable = 'false';
    source.append(sourceMarker);
    wysiwyg.querySelector('.vditor-reset').append(input);
    expect(adapter.isEditableTarget(host, 'wysiwyg', input)).toBe(false);
    expect(adapter.isEditableTarget(host, 'wysiwyg', preview)).toBe(false);
    expect(adapter.isEditableTarget(host, 'sv', sourceMarker)).toBe(true);
  });
});
