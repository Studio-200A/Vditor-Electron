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
    instantExpandedNode: '.vditor-ir__node--expand',
    instantLinkText: '.vditor-ir__link',
    instantLinkDestination: '.vditor-ir__marker--link',
    tocTarget: '.vditor-toc [data-target-id]',
  });
  const documentLinkPresentation = new WeakMap();

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

  function hideNativeOutlineControl(toolbar) {
    const button = toolbarButton(toolbar, 'outline');
    const item = button?.closest(selectors.toolbarItem);
    if (!item) return false;
    // Vditor 3.11.3 toggles this private toolbar item during mode changes even
    // when its outline panel is disabled. Keep the item for that contract but
    // Mark the private item for the application stylesheet. Its !important
    // rule survives Vditor's inline display updates during mode switches.
    item.dataset.vditorDesktopHiddenOutline = 'true';
    return true;
  }

  function keepSplitToolbarActionsAvailable(toolbar) {
    let found = false;
    ['outdent', 'indent'].forEach((type) => {
      const item = toolbarButton(toolbar, type)?.closest(selectors.toolbarItem);
      if (!item) return;
      // Vditor 3.11.3 hides and disables these in SV, while Desktop handles
      // the commands against the source selection. Keep their layout stable
      // so a mode switch does not need a delayed second toolbar mutation.
      item.dataset.vditorDesktopSplitToolbarAction = 'true';
      found = true;
    });
    return found;
  }

  function toolbarHint(item) {
    return item?.querySelector(selectors.toolbarHint) || null;
  }

  function selectEditMode(toolbar, mode) {
    if (!['wysiwyg', 'ir', 'sv'].includes(mode)) return false;
    const editModeItem = toolbarButton(toolbar, 'edit-mode')?.closest(selectors.toolbarItem);
    // Vditor 3.11.x binds its supported mode transition to these hint buttons.
    // Dispatching through that control preserves Vditor's mode, toolbar, undo, and focus handling.
    const button = toolbarHint(editModeItem)?.querySelector(`button[data-mode="${mode}"]`);
    if (!button) return false;
    button.click();
    return true;
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

  function outlineContentElement(host, mode) {
    const parts = editorParts(host);
    // Vditor 3.11.3 Outline.render() uses previewElement whenever the preview
    // pane is visible; otherwise it uses the current mode's editor element.
    if (parts.preview?.style.display === 'block')
      return parts.preview.querySelector(selectors.reset);
    const editor = activeEditor(host, mode);
    return editor?.matches?.(selectors.reset)
      ? editor
      : editor?.querySelector(`:scope > ${selectors.reset}`) || editor;
  }

  function directOutlineHeadings(editor) {
    return Array.from(editor?.children || []).flatMap((element) => {
      if (!element.matches?.(selectors.renderedHeading)) return [];
      const text = headingText(element).trim();
      if (!text) return [];
      return [{ element, level: Number.parseInt(element.tagName.slice(1), 10), text }];
    });
  }

  function outlineSnapshot(host, mode) {
    const occurrences = new Map();
    return directOutlineHeadings(outlineContentElement(host, mode)).map((heading, index) => {
      const identity = `${heading.level}:${heading.text}`;
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      return { index, level: heading.level, text: heading.text, key: `${identity}:${occurrence}` };
    });
  }

  function outlineScrollContainer(host, mode) {
    const parts = editorParts(host);
    // Vditor 3.11.3 scrolls the outer preview pane, while rendered editor
    // modes scroll their reset child and SV scrolls its source element.
    if (parts.preview?.style.display === 'block') return parts.preview;
    return editorScrollContainer(host, mode);
  }

  function outlineHeadingTargets(host, mode, headingIndex) {
    const canonical = outlineContentElement(host, mode);
    const canonicalHeadings = directOutlineHeadings(canonical);
    const heading = canonicalHeadings[headingIndex];
    if (!canonical || !heading) return [];
    const targets = [{ scroller: outlineScrollContainer(host, mode), heading: heading.element }];
    // Desktop additionally keeps both SV panes aligned when their heading
    // counts agree. A mismatch is left on the canonical preview target rather
    // than guessing an index in a different semantic collection.
    if (mode === 'sv') {
      const source = editorParts(host).source;
      const sourceHeadings = Array.from(source?.querySelectorAll(selectors.sourceHeading) || []);
      if (source && sourceHeadings.length === canonicalHeadings.length)
        targets.unshift({ scroller: source, heading: sourceHeadings[headingIndex] });
    }
    return targets;
  }

  function observeOutlineChanges(host, callback) {
    if (!host || typeof callback !== 'function') return null;
    const observer = new MutationObserver(callback);
    observer.observe(host, {
      attributes: true,
      attributeFilter: ['style'],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return observer;
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

  function activeEditor(host, mode) {
    const parts = editorParts(host);
    if (mode === 'sv') return parts.source;
    if (mode === 'wysiwyg') return parts.wysiwyg;
    return parts.instantRendering;
  }

  function editorScrollContainer(host, mode) {
    const editor = activeEditor(host, mode);
    if (!editor) return null;
    // In Vditor 3.11.x rendered modes scroll their private .vditor-reset child,
    // while SV scrolls its editor element directly.
    return mode === 'sv' ? editor : editor.querySelector(selectors.reset) || editor;
  }

  function setEditorBottomSpacer(host, height) {
    if (!Number.isFinite(height)) return false;
    // Vditor 3.11.3 renders --editor-bottom through a trailing ::after in
    // SV, IR, and WYSIWYG. Set every mode so its bottom space survives a
    // mode switch without changing the user's typewriter-mode setting.
    const value = `${Math.max(0, Math.round(height))}px`;
    const parts = editorParts(host);
    const editors = [parts.source, parts.instantRendering, parts.wysiwyg, parts.preview];
    editors.forEach((editor) => editor?.style.setProperty('--editor-bottom', value));
    return editors.some(Boolean);
  }

  const findHighlightName = 'vditor-desktop-find';
  const activeFindHighlightName = 'vditor-desktop-find-active';
  const documentNavigationScroll = Object.freeze({
    minDuration: 140,
    maxDuration: 240,
    millisecondsPerPixel: 0.16,
  });
  const documentNavigationAnimations = new WeakMap();

  function animateDocumentNavigationScroll(scroller, destination) {
    if (!scroller || !Number.isFinite(destination)) return false;
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = Math.min(maximum, Math.max(0, destination));
    const previousAnimation = documentNavigationAnimations.get(scroller);
    if (previousAnimation) cancelAnimationFrame(previousAnimation);
    documentNavigationAnimations.delete(scroller);
    const start = scroller.scrollTop;
    const distance = target - start;
    if (
      Math.abs(distance) < 1 ||
      globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      scroller.scrollTop = target;
      return false;
    }
    const duration = Math.min(
      documentNavigationScroll.maxDuration,
      Math.max(
        documentNavigationScroll.minDuration,
        Math.abs(distance) * documentNavigationScroll.millisecondsPerPixel,
      ),
    );
    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      scroller.scrollTop = start + distance * eased;
      if (progress < 1) documentNavigationAnimations.set(scroller, requestAnimationFrame(step));
      else documentNavigationAnimations.delete(scroller);
    };
    documentNavigationAnimations.set(scroller, requestAnimationFrame(step));
    return true;
  }

  function textMatches(host, mode, query, caseSensitive = false) {
    const editor = activeEditor(host, mode);
    if (!editor || !query) return [];
    const nodes = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue) nodes.push(node);
    }
    const text = nodes.map((item) => item.nodeValue).join('');
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const matches = [];
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, from);
      if (start < 0) break;
      from = start + Math.max(needle.length, 1);
      const end = start + query.length;
      let offset = 0;
      let startNode = null;
      let endNode = null;
      let startOffset = 0;
      let endOffset = 0;
      for (const textNode of nodes) {
        const next = offset + textNode.nodeValue.length;
        if (!startNode && start >= offset && start <= next) {
          startNode = textNode;
          startOffset = start - offset;
        }
        if (end >= offset && end <= next) {
          endNode = textNode;
          endOffset = end - offset;
          break;
        }
        offset = next;
      }
      if (!startNode || !endNode) continue;
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      matches.push({ start, end, range });
    }
    return matches;
  }

  function clearFindHighlights() {
    if (!globalThis.CSS?.highlights) return;
    globalThis.CSS.highlights.delete(findHighlightName);
    globalThis.CSS.highlights.delete(activeFindHighlightName);
  }

  function highlightTextMatches(host, mode, query, activeIndex, caseSensitive = false) {
    const matches = textMatches(host, mode, query, caseSensitive);
    clearFindHighlights();
    if (!globalThis.CSS?.highlights || typeof globalThis.Highlight !== 'function') return matches;
    if (matches.length) {
      globalThis.CSS.highlights.set(
        findHighlightName,
        new globalThis.Highlight(...matches.map((match) => match.range)),
      );
    }
    const active = matches[activeIndex];
    if (active)
      globalThis.CSS.highlights.set(
        activeFindHighlightName,
        new globalThis.Highlight(active.range),
      );
    return matches;
  }

  function scrollRangeIntoView(range, editor) {
    if (!range || !editor) return false;
    if (typeof range.getBoundingClientRect !== 'function') return false;
    const target =
      (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement) || editor;
    // Vditor 3.11.3 has no public find-navigation API. Its rendered modes may scroll either
    // the editor or its private .vditor-reset child, so keep this fallback centralized here.
    const scroller =
      [innerScroller(target), editor].find(
        (candidate) => candidate && candidate.scrollHeight > candidate.clientHeight + 1,
      ) || editor;
    const targetRect = range.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    if (!targetRect.height || !scrollerRect.height) return false;
    const inset = Math.min(48, Math.max(24, scroller.clientHeight * 0.12));
    if (
      targetRect.top >= scrollerRect.top + inset &&
      targetRect.bottom <= scrollerRect.bottom - inset
    )
      return false;
    const targetTop = scroller.scrollTop + targetRect.top - scrollerRect.top;
    const destination = Math.max(
      0,
      Math.min(
        scroller.scrollHeight - scroller.clientHeight,
        targetTop - Math.max(0, (scroller.clientHeight - targetRect.height) / 2),
      ),
    );
    return animateDocumentNavigationScroll(scroller, destination);
  }

  function revealTextMatch(host, mode, query, occurrence = 0, caseSensitive = false) {
    const matches = highlightTextMatches(host, mode, query, occurrence, caseSensitive);
    const match = matches[occurrence];
    if (!match) return false;
    scrollRangeIntoView(match.range, activeEditor(host, mode));
    return true;
  }

  function selectTextMatch(host, mode, query, occurrence = 0, caseSensitive = false) {
    const matches = highlightTextMatches(host, mode, query, occurrence, caseSensitive);
    const match = matches[occurrence];
    if (!match) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(match.range);
    return true;
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
    // Vditor 3.11.x renders TOC entries as descendants with data-target-id instead
    // of anchors. Keep that private contract in this adapter for upgrade auditing.
    const tocTarget = element.closest?.(selectors.tocTarget);
    if (tocTarget && host.contains(tocTarget)) {
      const targetId = tocTarget.getAttribute('data-target-id')?.trim();
      if (targetId) return { element: tocTarget, href: `#${targetId}`, kind: 'toc' };
    }
    const link = element.closest?.('a[href^="#"]');
    if (link) return { element: link, href: link.getAttribute('href') || '', kind: 'link' };
    const instantLink = element.closest?.(selectors.instantLink);
    if (!instantLink || !host.contains(instantLink)) return null;
    const href = instantLink.querySelector(selectors.instantLinkDestination)?.textContent?.trim();
    return href?.startsWith('#') ? { element: instantLink, href, kind: 'link' } : null;
  }

  function documentLink(target, host) {
    const anchor = documentAnchor(target, host);
    if (anchor) return anchor;
    const element = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!element || !host?.contains(element)) return null;
    const link = element.closest?.('a[href]');
    if (link && host.contains(link))
      return { element: link, href: link.getAttribute('href') || '', kind: 'link' };
    const instantLink = element.closest?.(selectors.instantLink);
    if (!instantLink || !host.contains(instantLink)) return null;
    const href = instantLink.querySelector(selectors.instantLinkDestination)?.textContent?.trim();
    return href ? { element: instantLink, href, kind: 'link' } : null;
  }

  function setDocumentLinkHint(link, hint, cursor) {
    const element = link?.element;
    if (!element || typeof hint !== 'string') return false;
    if (!documentLinkPresentation.has(element)) {
      documentLinkPresentation.set(element, {
        title: element.getAttribute('title'),
        cursor: element.style.cursor,
      });
    }
    // The application renders the navigation hint itself. Suppress native titles
    // while hovered so author-provided titles do not create a second tooltip.
    element.removeAttribute('title');
    element.style.cursor = cursor;
    return true;
  }

  function clearDocumentLinkHint(link) {
    const element = link?.element;
    const presentation = element && documentLinkPresentation.get(element);
    if (!element || !presentation) return false;
    if (presentation.title === null) element.removeAttribute('title');
    else element.title = presentation.title;
    element.style.cursor = presentation.cursor;
    documentLinkPresentation.delete(element);
    return true;
  }

  function focusDocumentLink(link) {
    const element = link?.element;
    if (!element) return false;
    const editor = element.closest?.(`${selectors.instantRendering}, ${selectors.wysiwyg}`);
    if (!editor) return false;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
    return true;
  }

  function expandInstantLinkForEditing(link) {
    const element = link?.element;
    if (!element?.matches?.(selectors.instantLink)) return false;
    // Once the node is expanded, Vditor's own click handler must receive later
    // clicks so the browser can place the caret in either link text or URL marker.
    if (element.classList.contains('vditor-ir__node--expand')) return false;
    // Vditor 3.11.x returns early for an IR link click before calling expandMarker().
    // Mirror expandMarker() by closing the previous expansion before opening this node,
    // while preserving the browser's click-position range.
    const editor = element.closest(selectors.instantRendering);
    editor?.querySelectorAll(selectors.instantExpandedNode).forEach((node) => {
      node.classList.remove('vditor-ir__node--expand');
    });
    element.classList.add('vditor-ir__node--expand');
    element.classList.remove('vditor-ir__node--hidden');
    const selection = window.getSelection();
    const text = element.querySelector(selectors.instantLinkText);
    if (!selection?.rangeCount || !text?.contains(selection.getRangeAt(0).startContainer)) {
      const range = document.createRange();
      range.selectNodeContents(text || element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    editor?.focus();
    return true;
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

  function relativeSourceFromAppUrl(source) {
    try {
      const url = new URL(source);
      if (url.protocol !== 'app:' || url.hostname !== 'app') return '';
      const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      return pathname ? `${pathname}${url.search}${url.hash}` : '';
    } catch (_) {
      return '';
    }
  }

  function relativeSourceFromLocalUrl(source, baseUrl) {
    try {
      const base = new URL(baseUrl);
      const url = new URL(source);
      if (
        url.protocol !== 'local-file:' ||
        url.protocol !== base.protocol ||
        url.hostname !== base.hostname
      )
        return '';
      const baseParts = decodeURIComponent(base.pathname).split('/').filter(Boolean);
      const targetParts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
      let shared = 0;
      while (shared < baseParts.length && baseParts[shared] === targetParts[shared]) shared += 1;
      const relativeParts = [
        ...Array.from({ length: baseParts.length - shared }, () => '..'),
        ...targetParts.slice(shared),
      ];
      const relativePath = relativeParts.map(encodeURIComponent).join('/');
      return `${relativePath}${url.search}${url.hash}`;
    } catch (_) {
      return '';
    }
  }

  function resolveRelativeImageSources(host, baseUrl) {
    if (!host || !baseUrl) return;
    host.querySelectorAll('img[src]').forEach((image) => {
      if (image.dataset.vditorDesktopOriginalSrc) return;
      const source = image.getAttribute('src') || '';
      // Vditor resolves Markdown images against the app document before this
      // observer sees them. Restore that app://app path to its Markdown-relative
      // form, then resolve it against the active document directory instead.
      const relativeSource = isRelativeImageSource(source)
        ? source
        : relativeSourceFromAppUrl(source) || relativeSourceFromLocalUrl(source, baseUrl);
      if (!relativeSource) return;
      try {
        image.dataset.vditorDesktopOriginalSrc = relativeSource;
        image.setAttribute('src', new URL(relativeSource, baseUrl).href);
      } catch (_) {}
    });
  }

  function resolveRelativeDocumentLinks(host, baseUrl) {
    if (!host || !baseUrl) return;
    host.querySelectorAll('a[href]').forEach((link) => {
      const relativeSource = relativeSourceFromLocalUrl(link.getAttribute('href') || '', baseUrl);
      if (relativeSource) link.setAttribute('href', relativeSource);
    });
  }

  function observeRelativeImageSources(host, baseUrl) {
    if (!host || !baseUrl) return null;
    const resolve = () => {
      resolveRelativeImageSources(host, baseUrl);
      resolveRelativeDocumentLinks(host, baseUrl);
    };
    const observer = new MutationObserver(resolve);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href'],
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
    if (parts.preview && !parts.preview.querySelector(selectors.reset))
      missing.push('preview:content');
    if (!toolbar) missing.unshift('toolbar');
    const requiredToolbarTypes = [
      'edit-mode',
      'both',
      'preview',
      'outdent',
      'indent',
      'outline',
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
    hideNativeOutlineControl,
    keepSplitToolbarActionsAvailable,
    toolbarHint,
    selectEditMode,
    toolbarHints,
    hoverTooltips,
    openSubmenus,
    codeThemeButtons,
    classifyCodeThemeButtons,
    sourceNewlines,
    listContext,
    headingTargets,
    outlineContentElement,
    outlineSnapshot,
    outlineScrollContainer,
    outlineHeadingTargets,
    observeOutlineChanges,
    innerScroller,
    scrollContainers,
    activeEditor,
    editorScrollContainer,
    setEditorBottomSpacer,
    textMatches,
    clearFindHighlights,
    highlightTextMatches,
    animateDocumentNavigationScroll,
    scrollRangeIntoView,
    revealTextMatch,
    selectTextMatch,
    documentAnchor,
    documentLink,
    setDocumentLinkHint,
    clearDocumentLinkHint,
    focusDocumentLink,
    expandInstantLinkForEditing,
    headingIndexForAnchor,
    relativeSourceFromLocalUrl,
    resolveRelativeImageSources,
    resolveRelativeDocumentLinks,
    observeRelativeImageSources,
    withOriginalImageSources,
    validateHost,
  });
})();
