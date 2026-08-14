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
    instantLink: '[data-type="a"]',
    instantLinkDestination: '.vditor-ir__marker--link',
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

  function scrollContainers(host) {
    const parts = editorParts(host);
    const candidates = [parts.source, parts.instantRendering, parts.wysiwyg, parts.preview];
    [parts.instantRendering, parts.wysiwyg, parts.preview].forEach((editor) => {
      const reset = editor?.querySelector(selectors.reset);
      if (reset) candidates.push(reset);
    });
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  function normalizedAnchor(value) {
    const fragment = String(value || '').replace(/^#/, '');
    try {
      return decodeURIComponent(fragment).trim().toLowerCase();
    } catch (_) {
      return fragment.trim().toLowerCase();
    }
  }

  function headingSlug(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  function headingText(heading) {
    const copy = heading.cloneNode(true);
    copy.querySelectorAll(selectors.sourceHeading).forEach((marker) => marker.remove());
    return copy.textContent || '';
  }

  function documentAnchor(target, host) {
    const element = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!element || !host?.contains(element)) return null;
    const link = element.closest?.('a[href^="#"]');
    if (link) return { element: link, href: link.getAttribute('href') || '' };
    const instantLink = element.closest?.(selectors.instantLink);
    if (!instantLink || !host.contains(instantLink)) return null;
    const href = instantLink.querySelector(selectors.instantLinkDestination)?.textContent?.trim();
    return href?.startsWith('#') ? { element: instantLink, href } : null;
  }

  function headingIndexForAnchor(host, href) {
    const anchor = normalizedAnchor(href);
    if (!anchor) return -1;
    const parts = editorParts(host);
    for (const editor of [parts.instantRendering, parts.wysiwyg, parts.preview]) {
      const headings = Array.from(editor?.querySelectorAll(selectors.renderedHeading) || []);
      const exactTarget = Array.from(
        editor?.querySelectorAll('[id], [name], [data-id]') || [],
      ).find((node) =>
        [node.id, node.getAttribute('name'), node.getAttribute('data-id')]
          .filter(Boolean)
          .some((value) => normalizedAnchor(value) === anchor),
      );
      if (exactTarget) {
        const heading = exactTarget.matches(selectors.renderedHeading)
          ? exactTarget
          : exactTarget.closest(selectors.renderedHeading);
        const index = headings.indexOf(heading);
        if (index >= 0) return index;
      }
      const index = headings.findIndex((heading) => {
        const text = headingText(heading);
        return normalizedAnchor(text) === anchor || headingSlug(text) === anchor;
      });
      if (index >= 0) return index;
    }
    return -1;
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
    scrollContainers,
    documentAnchor,
    headingIndexForAnchor,
    resolveRelativeImageSources,
    observeRelativeImageSources,
    withOriginalImageSources,
    validateHost,
  });
})();
