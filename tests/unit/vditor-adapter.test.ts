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
        <pre class="vditor-ir"><h1>IR</h1></pre>
        <pre class="vditor-wysiwyg"><h1>WYSIWYG</h1></pre>
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
});
