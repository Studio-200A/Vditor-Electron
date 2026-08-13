(function () {
  'use strict';

  // This is the only renderer module allowed to know Vditor's private DOM contract.
  // Keep selectors and structural assumptions here so a Vditor upgrade has one audit surface.
  const selectors = Object.freeze({
    toolbar: ':scope > .vditor-toolbar',
    toolbarItem: '.vditor-toolbar__item',
    toolbarTrigger: ':scope > button[data-type]',
    toolbarHint: ':scope > .vditor-hint',
    toolbarHints: '.vditor-hint',
    hoverTooltip: '.vditor-tooltipped--hover',
    openSubmenu: '.app-submenu-open',
    content: '.vditor-content',
    source: '.vditor-sv',
    instantRendering: '.vditor-ir',
    wysiwyg: '.vditor-wysiwyg',
    preview: '.vditor-preview',
    reset: '.vditor-reset',
    sourceNewline: 'span[data-type="newline"]',
    sourceHeading: '[data-type="heading-marker"]',
    sourceBlock: '[data-block="0"]',
    listMarker: '[data-type="li-marker"]',
    listPadding: '[data-type="padding"]',
    renderedHeading: 'h1,h2,h3,h4,h5,h6',
  });

  function editorParts(host) {
    return {
      toolbar: host?.querySelector(selectors.toolbar) || null,
      content: host?.querySelector(selectors.content) || null,
      source: host?.querySelector(selectors.source) || null,
      instantRendering: host?.querySelector(selectors.instantRendering) || null,
      wysiwyg: host?.querySelector(selectors.wysiwyg) || null,
      preview: host?.querySelector(selectors.preview) || null,
    };
  }

  function toolbarContext(target) {
    const button = target?.closest?.('button') || null;
    const item = button?.closest(selectors.toolbarItem) || null;
    const trigger = item?.querySelector(selectors.toolbarTrigger) || null;
    return { button, item, trigger, type: trigger?.dataset.type || '' };
  }

  function toolbarButton(toolbar, type) {
    if (!/^[a-z0-9-]+$/i.test(type)) return null;
    return toolbar?.querySelector(`button[data-type="${type}"]`) || null;
  }

  function toolbarHint(item) {
    return item?.querySelector(selectors.toolbarHint) || null;
  }

  function toolbarHints(root = document) {
    return Array.from(root.querySelectorAll(selectors.toolbarHints));
  }

  function hoverTooltips(root = document) {
    return Array.from(root.querySelectorAll(selectors.hoverTooltip));
  }

  function openSubmenus(root = document) {
    return Array.from(root.querySelectorAll(selectors.openSubmenu));
  }

  function codeThemeButtons(toolbar) {
    const item = toolbarButton(toolbar, 'code-theme')?.closest(selectors.toolbarItem);
    return Array.from(toolbarHint(item)?.querySelectorAll('button') || []);
  }

  function classifyCodeThemeButtons(toolbar) {
    let lightGroup = false;
    return codeThemeButtons(toolbar).map((button) => {
      const name = button.textContent.trim();
      // Vditor 3.11.x lists dark themes first and starts its light group here.
      if (name === 'ant-design') lightGroup = true;
      return { button, name, tone: lightGroup ? 'light' : 'dark' };
    });
  }

  function sourceNewlines(source) {
    return Array.from(source?.querySelectorAll(selectors.sourceNewline) || []);
  }

  function listContext(node) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const block = element?.closest?.(selectors.sourceBlock) || null;
    const marker = block?.querySelector(selectors.listMarker) || null;
    const padding = marker?.previousElementSibling?.matches(selectors.listPadding)
      ? marker.previousElementSibling
      : null;
    return { block, marker, padding };
  }

  function headingTargets(host, headingIndex) {
    const parts = editorParts(host);
    return [
      [parts.instantRendering, selectors.renderedHeading],
      [parts.wysiwyg, selectors.renderedHeading],
      [parts.source, selectors.sourceHeading],
      [parts.preview, selectors.renderedHeading],
    ].map(([editor, headingSelector]) => ({
      editor,
      heading: editor?.querySelectorAll(headingSelector)[headingIndex] || null,
    }));
  }

  function innerScroller(node) {
    return node?.closest(selectors.reset) || null;
  }

  function isRelativeImageSource(source) {
    return (
      source &&
      !source.startsWith('#') &&
      !source.startsWith('/') &&
      !source.startsWith('//') &&
      !/^[a-z][a-z\d+.-]*:/i.test(source)
    );
  }

  function resolveRelativeImageSources(host, baseUrl) {
    if (!host || !baseUrl) return;
    host.querySelectorAll('img[src]').forEach((image) => {
      if (image.dataset.vditorDesktopOriginalSrc) return;
      const source = image.getAttribute('src') || '';
      if (!isRelativeImageSource(source)) return;
      try {
        image.dataset.vditorDesktopOriginalSrc = source;
        image.setAttribute('src', new URL(source, baseUrl).href);
      } catch (_) {}
    });
  }

  function observeRelativeImageSources(host, baseUrl) {
    if (!host || !baseUrl) return null;
    const resolve = () => resolveRelativeImageSources(host, baseUrl);
    const observer = new MutationObserver(resolve);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    resolve();
    return observer;
  }

  function withOriginalImageSources(host, callback) {
    const images = Array.from(
      host?.querySelectorAll('img[data-vditor-desktop-original-src]') || [],
    );
    images.forEach((image) => {
      image.setAttribute('src', image.dataset.vditorDesktopOriginalSrc);
      delete image.dataset.vditorDesktopOriginalSrc;
    });
    try {
      return callback();
    } finally {
      images.forEach((image) => {
        const source = image.getAttribute('src') || '';
        if (!isRelativeImageSource(source)) return;
        try {
          image.dataset.vditorDesktopOriginalSrc = source;
          image.setAttribute('src', new URL(source, host.dataset.localResourceBase).href);
        } catch (_) {}
      });
    }
  }

  function validateHost(host, mountedToolbar = null) {
    const parts = editorParts(host);
    const toolbar = parts.toolbar || mountedToolbar;
    const missing = Object.entries(parts)
      .filter(([name]) => name !== 'toolbar')
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (!toolbar) missing.unshift('toolbar');
    const requiredToolbarTypes = [
      'edit-mode',
      'both',
      'preview',
      'outdent',
      'indent',
      'content-theme',
      'code-theme',
    ];
    requiredToolbarTypes.forEach((type) => {
      if (!toolbarButton(toolbar, type)) missing.push(`toolbar:${type}`);
    });
    const codeThemes = classifyCodeThemeButtons(toolbar);
    if (!codeThemes.some((item) => item.tone === 'light')) missing.push('code-theme:light');
    if (!codeThemes.some((item) => item.tone === 'dark')) missing.push('code-theme:dark');
    return { valid: missing.length === 0, missing };
  }

  window.VditorDesktopAdapter = Object.freeze({
    selectors,
    editorParts,
    toolbarContext,
    toolbarButton,
    toolbarHint,
    toolbarHints,
    hoverTooltips,
    openSubmenus,
    codeThemeButtons,
    classifyCodeThemeButtons,
    sourceNewlines,
    listContext,
    headingTargets,
    innerScroller,
    resolveRelativeImageSources,
    observeRelativeImageSources,
    withOriginalImageSources,
    validateHost,
  });
})();
