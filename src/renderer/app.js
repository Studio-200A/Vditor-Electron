(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    tabs: [],
    activeId: null,
    workspace: '',
    settings: null,
    defaultSettings: null,
    locale: 'en_US',
    untitledCounter: 0,
    treeTimer: null,
    ignoredChanges: new Map(),
  };
  const LOCALES = window.VditorDesktopLocales || {};
  const DEFAULT_TOOLBAR = [
    'emoji',
    'headings',
    'bold',
    'italic',
    'strike',
    'link',
    '|',
    'list',
    'ordered-list',
    'check',
    'outdent',
    'indent',
    '|',
    'quote',
    'line',
    'code',
    'inline-code',
    '|',
    'upload',
    'table',
    '|',
    'undo',
    'redo',
    '|',
    'fullscreen',
    'edit-mode',
    'both',
    'preview',
    'outline',
    'code-theme',
    'content-theme',
  ];
  let messageTimer;
  let appMenuCloseHandler;
  let settingsSaveTimer;

  function resolveLocale(locale) {
    if (locale && locale !== 'system' && LOCALES[locale]) return locale;
    return /^zh(?:-|_)/i.test(navigator.language) ? 'zh_CN' : 'en_US';
  }

  function t(key, params = {}) {
    const table = LOCALES[state.locale] || LOCALES.en_US || {};
    const fallback = (LOCALES.en_US || {})[key] || key;
    return String(table[key] || fallback).replace(
      /\{(\w+)\}/g,
      (_match, name) => params[name] ?? `{${name}}`,
    );
  }

  function applyLocale(locale) {
    state.locale = resolveLocale(locale);
    document.documentElement.lang = state.locale === 'zh_CN' ? 'zh-CN' : 'en-US';
    $$('[data-i18n]').forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    $$('[data-i18n-title]').forEach((node) => {
      const value = t(node.dataset.i18nTitle);
      node.title = value;
      node.setAttribute('aria-label', value);
    });
    $$('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    $$('[data-i18n-label]').forEach((label) => {
      Array.from(label.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .forEach((node) => node.remove());
      let text = label.querySelector(':scope > .i18n-label');
      if (!text) {
        text = document.createElement('span');
        text.className = 'i18n-label';
        label.insertBefore(text, label.firstChild);
      }
      text.textContent = t(label.dataset.i18nLabel);
    });
    if (state.workspace) {
      $('#workspaceName').textContent = fileName(state.workspace);
      $('#workspaceHeading').title = state.workspace;
    }
    if ($('#appMenuBar')?.dataset.ready === 'true') setupAppMenus();
    renderTabs();
    updateActiveUI();
    renderOutline();
  }

  function uid() {
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }
  function activeTab() {
    return state.tabs.find((tab) => tab.id === state.activeId) || null;
  }
  function escapeHTML(value) {
    const node = document.createElement('div');
    node.textContent = String(value);
    return node.innerHTML;
  }
  function fileName(filePath) {
    return filePath ? filePath.replace(/\\/g, '/').split('/').pop() : '';
  }
  function stripExtension(name) {
    return name.replace(/\.(md|markdown)$/i, '');
  }
  function detectLineEnding(content) {
    return /\r\n/.test(content) ? 'CRLF' : 'LF';
  }
  function localResourceBase(baseDir) {
    if (!baseDir) return '';
    const encodedPath = baseDir
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `local-file://root${encodedPath.endsWith('/') ? encodedPath : `${encodedPath}/`}`;
  }
  function treeIcon(type) {
    return type === 'directory'
      ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5h5l1.6 2h8.4v8.5h-15z"/><path d="M2.5 7.5v-3h5l1.6 2h8.4v1"/></svg>'
      : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.5v4h4"/></svg>';
  }

  function showMessage(message, error = false) {
    const target = $('#statusMessage');
    target.textContent = message;
    target.classList.toggle('error', error);
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      target.textContent = '';
      target.classList.remove('error');
    }, 4500);
  }

  async function resolveTheme() {
    return state.settings.systemTheme ? await window.appAPI.getSystemTheme() : state.settings.theme;
  }

  async function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if ($('#statusThemeToggle')) $('#statusThemeToggle').checked = theme === 'dark';
    const contentTheme =
      theme === 'dark' && state.settings.contentTheme === 'light'
        ? 'dark'
        : state.settings.contentTheme;
    state.tabs.forEach((tab) => {
      if (tab.vditor) {
        try {
          tab.vditor.setTheme(
            theme,
            contentTheme,
            state.settings.codeTheme,
            'app://app/vditor/dist/css/content-theme',
          );
        } catch (_) {}
      }
    });
  }

  function applyPresentationSettings() {
    const s = state.settings;
    const uiZoom = Number(s.uiZoom || 100);
    const editorRatio = Number(s.editorZoom || 100) / uiZoom;
    const previewRatio = Number(s.previewZoom || 100) / uiZoom;
    const root = document.documentElement.style;
    root.setProperty('--ui-font', s.uiFontFamily);
    root.setProperty('--ui-scale', String(uiZoom / 100));
    root.setProperty('--source-font', s.editorFontFamily);
    root.setProperty('--source-size', `${s.editorFontSize * editorRatio}px`);
    root.setProperty('--rendered-font', s.previewFontFamily);
    root.setProperty('--rendered-size', `${s.previewFontSize * editorRatio}px`);
    root.setProperty('--preview-size', `${s.previewFontSize * previewRatio}px`);
    root.setProperty('--code-font', s.previewCodeFontFamily);
    root.setProperty('--code-size', `${s.previewCodeFontSize * editorRatio}px`);
    root.setProperty('--preview-code-size', `${s.previewCodeFontSize * previewRatio}px`);
    root.setProperty(
      '--editor-text-width',
      `${Math.min(100, Math.max(40, Number(s.editorTextWidth || 100)))}%`,
    );
    $('#app').classList.toggle('toolbar-hidden', s.toolbarVisible === false);
    window.appAPI.setZoomFactor(uiZoom);
  }

  function scheduleSplitLineNumbers(tab) {
    if (!tab) return;
    if (tab.lineNumberFrame) cancelAnimationFrame(tab.lineNumberFrame);
    tab.lineNumberFrame = requestAnimationFrame(() => {
      tab.lineNumberFrame = null;
      updateSplitLineNumbers(tab);
    });
  }

  function observeSplitLineNumbers(tab) {
    tab.lineObserver?.disconnect();
    tab.lineResizeObserver?.disconnect();
    const sv = tab.host.querySelector('.vditor-sv');
    if (!sv) return;
    tab.lineObserver = new MutationObserver(() => scheduleSplitLineNumbers(tab));
    tab.lineObserver.observe(sv, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['class', 'style'],
    });
    tab.lineResizeObserver = new ResizeObserver(() => scheduleSplitLineNumbers(tab));
    tab.lineResizeObserver.observe(sv);
  }

  function disconnectSplitLineNumbers(tab) {
    tab.lineObserver?.disconnect();
    tab.lineResizeObserver?.disconnect();
    if (tab.lineNumberFrame) cancelAnimationFrame(tab.lineNumberFrame);
    tab.lineObserver = null;
    tab.lineResizeObserver = null;
    tab.lineNumberFrame = null;
  }

  function headingMetadata(tab) {
    return currentContent(tab)
      .split(/\r?\n/)
      .map((line, index) => {
        const match = line.match(/^(#{1,6})\s+/);
        return match ? { line: index, level: match[1].length } : null;
      })
      .filter(Boolean);
  }

  function applyHeadingFolds(tab, sv, headings) {
    const hiddenLines = new Set();
    sv.querySelectorAll('[data-fold-owner]').forEach((node) =>
      node.removeAttribute('data-fold-owner'),
    );
    sv.querySelectorAll('[data-folded-heading]').forEach((node) =>
      node.removeAttribute('data-folded-heading'),
    );
    const lineNodes = [[]];
    Array.from(sv.children).forEach((block) => {
      Array.from(block.childNodes).forEach((node) => {
        lineNodes.at(-1).push(node);
        if (node.nodeType === Node.ELEMENT_NODE && node.dataset.type === 'newline')
          lineNodes.push([]);
      });
    });
    headings.forEach((heading, index) => {
      if (!tab.foldedHeadings.has(heading.line)) return;
      const boundaryLine = headings
        .slice(index + 1)
        .find((item) => item.level <= heading.level)?.line;
      const totalLines = currentContent(tab).split(/\r?\n/).length;
      for (let line = heading.line + 1; line < (boundaryLine ?? totalLines); line += 1)
        hiddenLines.add(line);
    });
    headings.forEach((heading) => {
      if (!tab.foldedHeadings.has(heading.line)) return;
      const headingNode = (lineNodes[heading.line] || []).find(
        (node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (node.matches(`.h${heading.level}`) || node.querySelector(`.h${heading.level}`)),
      );
      if (headingNode) headingNode.dataset.foldedHeading = 'true';
    });
    hiddenLines.forEach((line) => {
      (lineNodes[line] || []).forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) node.dataset.foldOwner = 'true';
      });
    });
    return hiddenLines;
  }

  function renderWhitespaceMarkers(tab, sv, positions, hiddenLines) {
    const content = tab.host.querySelector('.vditor-content');
    let layer = content.querySelector(':scope > .sv-whitespace-layer');
    if (!state.settings.showWhitespace) {
      layer?.remove();
      return;
    }
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'sv-whitespace-layer';
      content.appendChild(layer);
    }
    layer.style.left = `${sv.offsetLeft}px`;
    layer.style.top = `${sv.offsetTop}px`;
    layer.style.width = `${sv.clientWidth}px`;
    layer.style.height = `${sv.clientHeight}px`;
    const canvas = document.createElement('div');
    canvas.className = 'sv-whitespace-canvas';
    canvas.style.height = `${sv.scrollHeight}px`;
    canvas.style.transform = `translateY(${-sv.scrollTop}px)`;
    currentContent(tab)
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (hiddenLines.has(index) || !/[ \t]/.test(line)) return;
        const marker = document.createElement('span');
        marker.className = 'sv-whitespace-line';
        marker.style.top = `${positions[index] || 0}px`;
        const expanded = line.replace(/\t/g, ' '.repeat(Number(state.settings.tabSize) || 4));
        marker.textContent = Array.from(expanded, (character) =>
          character === ' ' ? '·' : '\u00a0',
        ).join('');
        canvas.appendChild(marker);
      });
    layer.replaceChildren(canvas);
  }

  function ensureSplitResizer(tab) {
    const content = tab.host.querySelector('.vditor-content');
    const preview = tab.host.querySelector('.vditor-preview');
    if (!content || !preview) return;
    let resizer = content.querySelector(':scope > .sv-split-resizer');
    if (!resizer) {
      resizer = document.createElement('div');
      resizer.className = 'sv-split-resizer hidden';
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      content.insertBefore(resizer, preview);
      resizer.addEventListener('mousedown', (event) => {
        event.preventDefault();
        resizer.classList.add('dragging');
        const move = (moveEvent) => {
          const rect = content.getBoundingClientRect();
          const ratio = Math.min(
            80,
            Math.max(20, ((moveEvent.clientX - rect.left) / rect.width) * 100),
          );
          state.settings.splitRatio =
            Math.abs(ratio - 50) <= 2.5 ? 50 : Math.round(ratio * 10) / 10;
          resizer.classList.toggle('snapped', state.settings.splitRatio === 50);
          tab.host.style.setProperty('--split-source-width', `${state.settings.splitRatio}%`);
          scheduleSplitLineNumbers(tab);
        };
        const up = () => {
          resizer.classList.remove('dragging');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          window.appAPI.saveSettings({ splitRatio: state.settings.splitRatio });
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
    }
    tab.host.style.setProperty('--split-source-width', `${state.settings.splitRatio || 50}%`);
    tab.splitResizer = resizer;
  }

  function updateSplitLineNumbers(tab) {
    if (!tab || !tab.vditor || !tab.ready) return;
    const content = tab.host.querySelector('.vditor-content');
    const sv = tab.host.querySelector('.vditor-sv');
    if (!content || !sv) return;
    let gutter = content.querySelector(':scope > .sv-line-numbers');
    if (!gutter) {
      gutter = document.createElement('div');
      gutter.className = 'sv-line-numbers';
      content.insertBefore(gutter, content.firstChild);
      sv.addEventListener('scroll', () => {
        gutter.scrollTop = sv.scrollTop;
        const whitespaceCanvas = content.querySelector('.sv-whitespace-canvas');
        if (whitespaceCanvas) whitespaceCanvas.style.transform = `translateY(${-sv.scrollTop}px)`;
      });
    }
    const isSplitView = tab.vditor.getCurrentMode() === 'sv';
    gutter.classList.toggle('hidden', !isSplitView);
    if (tab.splitResizer) {
      const previewVisible =
        getComputedStyle(tab.host.querySelector('.vditor-preview')).display !== 'none';
      tab.splitResizer.classList.toggle('hidden', !isSplitView || !previewVisible);
    }
    if (!isSplitView) {
      content.querySelector(':scope > .sv-whitespace-layer')?.remove();
      return;
    }

    const count = Math.max(1, currentContent(tab).split(/\r?\n/).length);
    const headings = headingMetadata(tab);
    const hiddenLines = applyHeadingFolds(tab, sv, headings);
    const style = getComputedStyle(sv);
    const lineHeight =
      Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    const svRect = sv.getBoundingClientRect();
    const newlines = Array.from(sv.querySelectorAll('span[data-type="newline"]'));
    const positions = [];
    let startContainer = sv;
    let startOffset = 0;
    for (let index = 0; index < count; index += 1) {
      const newline = newlines[index];
      const range = document.createRange();
      range.setStart(startContainer, startOffset);
      if (newline) range.setEndBefore(newline);
      else range.setEnd(sv, sv.childNodes.length);
      const rect = Array.from(range.getClientRects()).find((item) => item.height > 0);
      const fallbackRect = newline?.getBoundingClientRect();
      const measuredRect = rect || fallbackRect;
      const measuredTop = measuredRect
        ? measuredRect.top -
          svRect.top +
          sv.scrollTop +
          Math.max(0, (measuredRect.height - lineHeight) / 2)
        : (positions[index - 1] ?? (Number.parseFloat(style.paddingTop) || 0)) + lineHeight;
      positions.push(measuredTop);
      if (newline?.parentNode) {
        startContainer = newline.parentNode;
        startOffset = Array.prototype.indexOf.call(startContainer.childNodes, newline) + 1;
      }
    }

    const canvas = document.createElement('div');
    canvas.className = 'sv-line-number-canvas';
    canvas.style.height = `${Math.max(sv.scrollHeight, positions.at(-1) + lineHeight)}px`;
    positions.forEach((top, index) => {
      if (hiddenLines.has(index)) return;
      const number = document.createElement('span');
      number.className = 'sv-line-number';
      number.style.top = `${top}px`;
      number.textContent = String(index + 1);
      const heading = headings.find((item) => item.line === index);
      if (heading) {
        number.classList.add('has-fold');
        const toggle = document.createElement('button');
        toggle.className = 'sv-fold-toggle';
        toggle.type = 'button';
        toggle.textContent = tab.foldedHeadings.has(index) ? '▶' : '▼';
        toggle.title = tab.foldedHeadings.has(index) ? 'Expand section' : 'Collapse section';
        toggle.onclick = (event) => {
          event.stopPropagation();
          if (tab.foldedHeadings.has(index)) tab.foldedHeadings.delete(index);
          else tab.foldedHeadings.add(index);
          scheduleSplitLineNumbers(tab);
        };
        number.prepend(toggle);
      }
      canvas.appendChild(number);
    });
    gutter.replaceChildren(canvas);
    gutter.scrollTop = sv.scrollTop;
    renderWhitespaceMarkers(tab, sv, positions, hiddenLines);
  }

  function setupSplitEditorEnhancements(tab) {
    const sv = tab.host.querySelector('.vditor-sv');
    if (!sv || sv.dataset.desktopEnhancements === 'true') return;
    sv.dataset.desktopEnhancements = 'true';
    sv.addEventListener(
      'keydown',
      (event) => {
        if (
          !state.settings.autoIndent ||
          event.key !== 'Enter' ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!sv.contains(range.startContainer)) return;
        const beforeCursor = range.cloneRange();
        beforeCursor.selectNodeContents(sv);
        beforeCursor.setEnd(range.startContainer, range.startOffset);
        const currentLine = beforeCursor.toString().split('\n').at(-1) || '';
        const indentation = currentLine.match(/^[ \t]+/)?.[0];
        if (!indentation || /^\s*(?:[-+*]|\d+\.)\s/.test(currentLine)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        range.deleteContents();
        const inserted = document.createTextNode(`\n${indentation}`);
        range.insertNode(inserted);
        range.setStartAfter(inserted);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        sv.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: `\n${indentation}`,
          }),
        );
      },
      true,
    );
  }

  function editorOptions(tab) {
    const s = state.settings;
    const wasModified = tab.modified;
    const savedBefore = tab.savedContent;
    const lang = state.locale;
    return {
      value: tab.content,
      mode: tab.mode,
      theme: document.documentElement.dataset.theme || s.theme,
      lang,
      icon: s.iconSet,
      cdn: 'app://app/vditor',
      height: '100%',
      width: '100%',
      minHeight: 300,
      placeholder: s.placeholder || t('editor.placeholder'),
      typewriterMode: s.typewriterMode,
      tab: s.tabInsertSpaces ? ' '.repeat(Number(s.tabSize) || 4) : '\t',
      rtl: s.rtl,
      toolbar: s.toolbarItems && s.toolbarItems.length ? s.toolbarItems : DEFAULT_TOOLBAR,
      // The Vditor toolbar is mounted into the application toolbar. Its visibility
      // is controlled as one layout part from View > Layout.
      toolbarConfig: { hide: false, pin: false },
      cache: { enable: false },
      undoDelay: 500,
      preview: {
        mode: s.previewMode,
        delay: s.previewDelay,
        maxWidth: s.previewMaxWidth,
        hljs: { enable: s.enableHighlight, lineNumber: s.lineNumbers, style: s.codeTheme },
        math: { engine: s.mathEngine },
        markdown: {
          autoSpace: s.enableAutoSpace,
          callout: s.enableCallout,
          footnotes: s.enableFootnotes,
          imageCaption: s.enableImageCaption,
          mark: s.enableMark,
          sub: s.enableSub,
          sup: s.enableSup,
          toc: s.toc,
          paragraphBeginningSpace: s.paragraphBeginningSpace,
          fixTermTypo: s.fixTermTypo,
          gfmAutoLink: s.gfmAutoLink,
          listStyle: s.listStyle,
          sanitize: s.sanitize,
          linkBase: localResourceBase(tab.baseDir),
          codeBlockPreview: true,
          mathBlockPreview: true,
        },
        theme: { current: s.contentTheme, path: 'app://app/vditor/dist/css/content-theme' },
      },
      upload: { accept: 'image/*', handler: (files) => handleImageUpload(tab, files) },
      after: () => {
        const normalized = currentContent(tab);
        tab.content = normalized;
        tab.savedContent = wasModified ? savedBefore : normalized;
        tab.modified = wasModified || normalized !== tab.savedContent;
        tab.ready = true;
        tab.toolbar = tab.host.querySelector(':scope > .vditor-toolbar');
        tab.toolbar.addEventListener(
          'click',
          (event) => handleVditorToolbarClick(tab, event),
          true,
        );
        if (tab.id === state.activeId) mountEditorToolbar(tab);
        renderTabs();
        updateActiveUI();
        observeSplitLineNumbers(tab);
        ensureSplitResizer(tab);
        setupSplitEditorEnhancements(tab);
        scheduleSplitLineNumbers(tab);
        setTimeout(() => tab.vditor && tab.vditor.focus(), 0);
      },
      input: (value) => onEditorInput(tab, value),
      blur: (value) => {
        tab.content = value;
      },
    };
  }

  function handleVditorToolbarClick(tab, event) {
    const button = event.target.closest?.('button');
    const item = button?.closest('.vditor-toolbar__item');
    const trigger = item?.querySelector(':scope > button[data-type]');
    if (!button || !trigger) return;
    const type = trigger.dataset.type;
    if (button === trigger) {
      if (type === 'both') setTimeout(() => scheduleSplitLineNumbers(tab), 50);
      return;
    }
    if (type === 'edit-mode' && ['wysiwyg', 'ir', 'sv'].includes(button.dataset.mode)) {
      setTimeout(() => {
        if (!tab.vditor) return;
        tab.mode = tab.vditor.getCurrentMode();
        state.settings.editMode = tab.mode;
        window.appAPI.saveSettings({ editMode: tab.mode });
        updateActiveUI();
        scheduleSplitLineNumbers(tab);
      }, 50);
    } else if (type === 'code-theme') {
      const codeTheme = button.textContent.trim();
      if (!codeTheme) return;
      state.settings.codeTheme = codeTheme;
      window.appAPI.saveSettings({ codeTheme });
    } else if (type === 'content-theme' && button.dataset.type) {
      state.settings.contentTheme = button.dataset.type;
      window.appAPI.saveSettings({ contentTheme: button.dataset.type });
    }
  }

  function ensureEditor(tab) {
    if (tab.vditor) return;
    tab.ready = false;
    try {
      tab.vditor = new Vditor(tab.host, editorOptions(tab));
    } catch (error) {
      tab.host.innerHTML = `<div class="fatal"><h2>编辑器初始化失败</h2><p>${escapeHTML(error.message)}</p></div>`;
      showMessage(error.message, true);
    }
  }

  function restoreEditorToolbar(tab) {
    if (tab && tab.toolbar && tab.toolbar.parentElement === $('#vditorToolbarMount')) {
      tab.host.insertBefore(tab.toolbar, tab.host.firstChild);
    }
  }

  function mountEditorToolbar(tab) {
    const mount = $('#vditorToolbarMount');
    const mounted = mount.querySelector(':scope > .vditor-toolbar');
    if (mounted && mounted !== tab.toolbar) {
      const owner = state.tabs.find((item) => item.toolbar === mounted);
      if (owner && owner.host.isConnected) owner.host.insertBefore(mounted, owner.host.firstChild);
      else mounted.remove();
    }
    if (tab.toolbar && tab.toolbar.parentElement !== mount) mount.appendChild(tab.toolbar);
  }

  function rebuildEditor(tab, mode) {
    disconnectSplitLineNumbers(tab);
    if (tab.vditor) {
      restoreEditorToolbar(tab);
      try {
        tab.content = tab.vditor.getValue();
        tab.vditor.destroy();
      } catch (_) {}
      tab.vditor = null;
      tab.toolbar = null;
    }
    tab.host.innerHTML = '';
    if (mode) tab.mode = mode;
    if (tab.id === state.activeId) ensureEditor(tab);
  }

  function createTab({
    filePath = null,
    content = '',
    encoding = 'utf-8',
    baseDir = '',
    activate = true,
  } = {}) {
    if (state.tabs.length >= 20) {
      showMessage(t('message.maxTabs'), true);
      return null;
    }
    const title = filePath
      ? fileName(filePath)
      : t('tab.untitled', { number: ++state.untitledCounter });
    const tab = {
      id: uid(),
      filePath,
      title,
      content,
      savedContent: content,
      encoding,
      lineEnding: detectLineEnding(content),
      baseDir,
      modified: false,
      mode: state.settings.editMode,
      vditor: null,
      ready: false,
      saveTimer: null,
      toolbar: null,
      lineObserver: null,
      lineResizeObserver: null,
      lineNumberFrame: null,
      foldedHeadings: new Set(),
      splitResizer: null,
      host: document.createElement('section'),
    };
    tab.host.className = 'editor-host';
    tab.host.dataset.tabId = tab.id;
    tab.host.addEventListener(
      'click',
      (event) => {
        const modeButton = event.target.closest && event.target.closest('[data-mode]');
        if (!modeButton || !['wysiwyg', 'ir', 'sv'].includes(modeButton.dataset.mode)) return;
        setTimeout(() => {
          if (!tab.vditor) return;
          tab.mode = tab.vditor.getCurrentMode();
          state.settings.editMode = tab.mode;
          window.appAPI.saveSettings({ editMode: tab.mode });
          if (tab.id === state.activeId) updateActiveUI();
          scheduleSplitLineNumbers(tab);
        }, 50);
      },
      true,
    );
    $('#editorArea').appendChild(tab.host);
    state.tabs.push(tab);
    renderTabs();
    if (activate) switchTab(tab.id);
    persistSession();
    return tab;
  }

  async function openPaths(paths) {
    for (const filePath of paths || []) await openPath(filePath, false);
    const last = paths && paths[paths.length - 1];
    const tab = state.tabs.find((item) => item.filePath === last);
    if (tab) switchTab(tab.id);
  }

  async function openPath(filePath, activate = true) {
    const existing = state.tabs.find((tab) => tab.filePath === filePath);
    if (existing) {
      if (activate) switchTab(existing.id);
      return existing;
    }
    try {
      const result = await window.fileAPI.readFile(filePath);
      const baseDir = await window.fileAPI.dirname(filePath);
      const tab = createTab({
        filePath,
        content: result.content,
        encoding: result.encoding,
        baseDir,
        activate,
      });
      rememberRecent(filePath);
      return tab;
    } catch (error) {
      showMessage(t('message.openFailed', { error: error.message }), true);
      return null;
    }
  }

  async function newTab() {
    createTab();
  }

  function switchTab(id) {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    restoreEditorToolbar(activeTab());
    state.activeId = id;
    state.tabs.forEach((item) => item.host.classList.toggle('active', item.id === id));
    ensureEditor(tab);
    if (tab.toolbar) mountEditorToolbar(tab);
    renderTabs();
    updateActiveUI();
    renderOutline();
    persistSession();
  }

  async function closeTab(id) {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    if (tab.modified) {
      const proceed = await window.appAPI.confirm({
        message: t('confirm.closeDirty', { title: tab.title }),
        detail: t('confirm.closeDirtyDetail'),
      });
      if (!proceed) return;
    }
    clearTimeout(tab.saveTimer);
    disconnectSplitLineNumbers(tab);
    restoreEditorToolbar(tab);
    if (tab.vditor) {
      try {
        tab.vditor.destroy();
      } catch (_) {}
    }
    tab.host.remove();
    const index = state.tabs.indexOf(tab);
    state.tabs.splice(index, 1);
    if (!state.tabs.length) {
      state.activeId = null;
      $('#vditorToolbarMount').innerHTML = '';
      renderTabs();
      updateActiveUI();
      renderOutline();
      persistSession();
    } else if (state.activeId === id) switchTab(state.tabs[Math.max(0, index - 1)].id);
    else {
      renderTabs();
      updateEmptyState();
      persistSession();
    }
  }

  function renderTabs() {
    $$('.document-tab', $('#tabBar')).forEach((node) => node.remove());
    const add = $('#addTab');
    state.tabs.forEach((tab) => {
      const button = document.createElement('button');
      button.className = `document-tab${tab.id === state.activeId ? ' active' : ''}`;
      button.dataset.id = tab.id;
      button.title = tab.filePath || tab.title;
      button.innerHTML = `<span>${escapeHTML(tab.title)}</span><i class="dirty">${tab.modified ? '●' : ''}</i><b title="${escapeHTML(t('tab.close'))}">×</b>`;
      button.addEventListener('click', (event) =>
        event.target.tagName === 'B' ? closeTab(tab.id) : switchTab(tab.id),
      );
      button.addEventListener('auxclick', (event) => {
        if (event.button === 1) closeTab(tab.id);
      });
      $('#tabBar').insertBefore(button, add);
    });
  }

  function onEditorInput(tab, value) {
    tab.content = value;
    tab.modified = value !== tab.savedContent;
    renderTabs();
    if (tab.id === state.activeId) {
      updateActiveUI();
      scheduleOutline();
    }
    scheduleSplitLineNumbers(tab);
    if (state.settings.autoSave && tab.filePath && tab.modified) {
      clearTimeout(tab.saveTimer);
      tab.saveTimer = setTimeout(() => saveTab(tab), state.settings.autoSaveDelay);
    }
  }

  function currentContent(tab) {
    if (!tab) return '';
    try {
      return tab.vditor ? tab.vditor.getValue() : tab.content;
    } catch (_) {
      return tab.content;
    }
  }

  async function saveTab(tab = activeTab(), saveAs = false) {
    if (!tab) return false;
    let destination = tab.filePath;
    if (!destination || saveAs)
      destination = await window.fileAPI.saveFileDialog(destination || `${tab.title}.md`);
    if (!destination) return false;
    try {
      const content = currentContent(tab);
      const diskContent =
        tab.lineEnding === 'CRLF'
          ? content.replace(/\r?\n/g, '\r\n')
          : content.replace(/\r\n/g, '\n');
      state.ignoredChanges.set(destination, Date.now() + 1500);
      await window.fileAPI.writeFile(destination, diskContent);
      const previousBaseDir = tab.baseDir;
      tab.filePath = destination;
      tab.title = fileName(destination);
      tab.content = content;
      tab.savedContent = content;
      tab.modified = false;
      tab.encoding = 'utf-8';
      tab.baseDir = await window.fileAPI.dirname(destination);
      if (previousBaseDir !== tab.baseDir) rebuildEditor(tab);
      rememberRecent(destination);
      renderTabs();
      updateActiveUI();
      persistSession();
      showMessage(t('message.saved', { title: tab.title }));
      return true;
    } catch (error) {
      showMessage(t('message.saveFailed', { error: error.message }), true);
      return false;
    }
  }

  function updateActiveUI() {
    updateEmptyState();
    const tab = activeTab();
    if (!tab) {
      document.title = 'Vditor Desktop';
      $('#windowTitle').textContent = 'Vditor Desktop';
      $('#statusPath').textContent = '';
      $('#statusMode').textContent = '—';
      $('#statusWords').textContent = t('status.words', { count: 0 });
      $('#statusChars').textContent = t('status.chars', { count: 0 });
      $('#statusLines').textContent = t('status.lines', { count: 0 });
      $('#statusEncoding').textContent = '—';
      $('#statusLineEnding').textContent = '—';
      return;
    }
    const content = currentContent(tab);
    tab.content = content;
    document.title = `${tab.modified ? '● ' : ''}${tab.title} — Vditor Desktop`;
    $('#windowTitle').textContent = `${tab.modified ? '● ' : ''}${tab.title} — Vditor Desktop`;
    $('#statusPath').textContent = tab.filePath || '';
    $('#statusPath').title = tab.filePath || '';
    const currentMode = tab.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab.mode;
    tab.mode = currentMode;
    $('#statusMode').textContent = currentMode.toUpperCase();
    const chars = content.replace(/\s/g, '').length;
    const latinWords = (content.match(/[A-Za-z0-9_]+/g) || []).length;
    const hanChars = (content.match(/[\u3400-\u9fff]/g) || []).length;
    $('#statusWords').textContent = t('status.words', { count: latinWords + hanChars });
    $('#statusChars').textContent = t('status.chars', { count: chars });
    $('#statusLines').textContent = t('status.lines', { count: content.split(/\r?\n/).length });
    $('#statusEncoding').textContent = tab.encoding.toUpperCase();
    $('#statusLineEnding').textContent = tab.lineEnding;
    $$('.tree-file.active').forEach((node) => node.classList.remove('active'));
    if (tab.filePath) {
      const node = $(`.tree-file[data-path="${CSS.escape(tab.filePath)}"]`);
      if (node) node.classList.add('active');
    }
  }

  function updateEmptyState() {
    const empty = $('#noTabs');
    if (empty) empty.classList.toggle('hidden', state.tabs.length > 0);
  }

  async function chooseFiles() {
    const paths = await window.fileAPI.openFileDialog();
    await openPaths(paths);
  }
  async function chooseFolder() {
    const folder = await window.fileAPI.openFolderDialog();
    if (folder) await setWorkspace(folder);
  }

  async function setWorkspace(folder) {
    state.workspace = folder || '';
    $('#workspaceName').textContent = folder ? fileName(folder) : t('sidebar.noWorkspace');
    $('#workspaceHeading').title = folder || t('sidebar.openFolder');
    await window.fileAPI.watch(folder || undefined);
    await refreshTree();
    if (folder) {
      const recent = [
        folder,
        ...(state.settings.recentPaths || []).filter((item) => item !== folder),
      ].slice(0, 10);
      state.settings.recentPaths = recent;
      state.settings.defaultOpenPath = folder;
      await window.appAPI.saveSettings({ recentPaths: recent, defaultOpenPath: folder });
    }
    persistSession();
  }

  async function refreshTree() {
    const root = $('#fileTree');
    root.innerHTML = '';
    if (!state.workspace) {
      root.innerHTML = `<button id="openFolderEmpty" class="empty-action">${escapeHTML(t('sidebar.openFolder'))}</button>`;
      $('#openFolderEmpty').onclick = chooseFolder;
      return;
    }
    await appendDirectory(root, state.workspace, true);
  }

  async function appendDirectory(container, dirPath, expanded) {
    let entries;
    try {
      entries = await window.fileAPI.listDir(dirPath);
    } catch (error) {
      showMessage(error.message, true);
      return;
    }
    const extensions = (state.settings.fileExplorer.visibleExtensions || ['md']).map((ext) =>
      ext.replace(/^\./, '').toLowerCase(),
    );
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.type === 'file' && !extensions.includes(entry.name.split('.').pop().toLowerCase()))
        continue;
      const row = document.createElement('div');
      row.className = `tree-row tree-${entry.type === 'directory' ? 'dir' : 'file'}`;
      row.dataset.path = entry.path;
      row.draggable = true;
      row.innerHTML = `<span class="chevron">${entry.type === 'directory' ? '›' : ''}</span><span class="file-icon">${treeIcon(entry.type)}</span><span class="tree-name">${escapeHTML(entry.name)}</span>`;
      container.appendChild(row);
      row.addEventListener('contextmenu', (event) => showTreeMenu(event, entry));
      row.addEventListener('dragstart', (event) =>
        event.dataTransfer.setData('text/x-vditor-path', entry.path),
      );
      if (entry.type === 'file') row.addEventListener('click', () => openPath(entry.path));
      else {
        const children = document.createElement('div');
        children.className = 'tree-children';
        container.appendChild(children);
        row.addEventListener('click', async () => {
          const open = row.classList.toggle('expanded');
          row.querySelector('.chevron').textContent = open ? '⌄' : '›';
          if (open && !children.dataset.loaded) {
            children.dataset.loaded = 'true';
            await appendDirectory(children, entry.path, false);
          }
        });
        row.addEventListener('dragover', (event) => {
          event.preventDefault();
          row.classList.add('drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', async (event) => {
          event.preventDefault();
          row.classList.remove('drop-target');
          const source = event.dataTransfer.getData('text/x-vditor-path');
          if (source) {
            try {
              await window.fileAPI.moveItem(source, entry.path);
              refreshTree();
            } catch (error) {
              showMessage(error.message, true);
            }
          }
        });
        if (expanded) row.click();
      }
    }
  }

  function showTreeMenu(event, entry) {
    event.preventDefault();
    const menu = $('#contextMenu');
    menu.innerHTML = '';
    const actions =
      entry.type === 'directory'
        ? [
            [t('context.newFile'), () => createExplorerItem(entry.path, 'file')],
            [t('context.newFolder'), () => createExplorerItem(entry.path, 'directory')],
          ]
        : [];
    actions.push(
      [t('context.rename'), () => renameExplorerItem(entry)],
      [t('context.trash'), () => deleteExplorerItem(entry)],
      [t('context.reveal'), () => window.appAPI.showItemInFolder(entry.path)],
    );
    actions.forEach(([label, fn]) => {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = () => {
        menu.classList.add('hidden');
        fn();
      };
      menu.appendChild(button);
    });
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.classList.remove('hidden');
  }

  async function createExplorerItem(parent, type) {
    const name = prompt(type === 'file' ? t('workspace.fileName') : t('workspace.folderName'));
    if (!name) return;
    try {
      const created = await window.fileAPI.createItem(parent, name, type);
      await refreshTree();
      if (type === 'file') openPath(created);
    } catch (error) {
      showMessage(error.message, true);
    }
  }
  async function renameExplorerItem(entry) {
    const name = prompt(t('workspace.rename'), entry.name);
    if (!name || name === entry.name) return;
    try {
      const destination = await window.fileAPI.renameItem(entry.path, name);
      state.tabs
        .filter((tab) => tab.filePath === entry.path)
        .forEach((tab) => {
          tab.filePath = destination;
          tab.title = name;
        });
      renderTabs();
      refreshTree();
      persistSession();
    } catch (error) {
      showMessage(error.message, true);
    }
  }
  async function deleteExplorerItem(entry) {
    const proceed = await window.appAPI.confirm({
      message: t('workspace.delete', { name: entry.name }),
    });
    if (!proceed) return;
    try {
      await window.fileAPI.deleteItem(entry.path);
      await refreshTree();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function scheduleOutline() {
    clearTimeout(state.outlineTimer);
    state.outlineTimer = setTimeout(renderOutline, 300);
  }
  function renderOutline() {
    const tab = activeTab();
    const target = $('#outlineTree');
    target.innerHTML = '';
    if (!tab) {
      target.innerHTML = `<div class="empty">${escapeHTML(t('sidebar.noDocument'))}</div>`;
      return;
    }
    const headings = [];
    currentContent(tab)
      .split('\n')
      .forEach((line, index) => {
        const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
        if (match) headings.push({ level: match[1].length, text: match[2], line: index });
      });
    if (!headings.length) {
      target.innerHTML = `<div class="empty">${escapeHTML(t('sidebar.noHeadings'))}</div>`;
      return;
    }
    headings.forEach((heading) => {
      const button = document.createElement('button');
      button.style.paddingLeft = `${10 + (heading.level - 1) * 14}px`;
      button.textContent = heading.text;
      button.title = t('outline.line', { line: heading.line + 1 });
      button.onclick = () => scrollToHeading(tab, heading.text);
      target.appendChild(button);
    });
  }
  function scrollToHeading(tab, text) {
    const candidates = $$(
      'h1,h2,h3,h4,h5,h6,.vditor-ir__node,.vditor-wysiwyg [data-block]',
      tab.host,
    );
    const node = candidates.find((item) => item.textContent.trim().includes(text));
    if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (tab.vditor) tab.vditor.focus();
  }

  async function handleImageUpload(tab, files) {
    if (!tab.filePath) {
      showMessage('请先保存文档，再插入本地图片', true);
      return 'Document must be saved first';
    }
    try {
      const docDir = await window.fileAPI.dirname(tab.filePath);
      const assetsName = state.settings.pasteImagesDir || './assets';
      const assetsDir = `${docDir}/${assetsName.replace(/^\.\//, '')}`;
      const markdown = [];
      for (const file of files) {
        const safeName = `${Date.now()}-${file.name.replace(/[^\w.\-\u4e00-\u9fff]/g, '_')}`;
        const destination = `${assetsDir}/${safeName}`;
        const bytes = await compressImage(file);
        await window.fileAPI.writeBinaryFile(destination, bytes);
        const relative = await window.fileAPI.relative(docDir, destination);
        markdown.push(`![${file.name}](${encodeURI(relative)})`);
      }
      tab.vditor.insertMD(markdown.join('\n'));
      return null;
    } catch (error) {
      showMessage(`图片保存失败：${error.message}`, true);
      return error.message;
    }
  }

  async function compressImage(file) {
    const original = new Uint8Array(await file.arrayBuffer());
    if (!file.type.match(/^image\/(png|jpeg|webp)$/) || !state.settings.imageMaxWidth)
      return original;
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width <= state.settings.imageMaxWidth) {
        bitmap.close();
        return original;
      }
      const ratio = state.settings.imageMaxWidth / bitmap.width;
      const canvas = document.createElement('canvas');
      canvas.width = state.settings.imageMaxWidth;
      canvas.height = Math.round(bitmap.height * ratio);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, file.type, state.settings.imageQuality),
      );
      return blob ? new Uint8Array(await blob.arrayBuffer()) : original;
    } catch (_) {
      return original;
    }
  }

  function makeExportHTML(tab) {
    const body = tab.vditor ? tab.vditor.getHTML() : `<pre>${escapeHTML(tab.content)}</pre>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(stripExtension(tab.title))}</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#24292f}pre,code{font-family:ui-monospace,monospace}pre{padding:16px;overflow:auto;background:#f6f8fa}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:6px 12px}</style></head><body>${body}</body></html>`;
  }
  async function exportHTML() {
    const tab = activeTab();
    if (!tab) return;
    const output = await window.fileAPI.exportDialog('html', `${stripExtension(tab.title)}.html`);
    if (output) {
      await window.fileAPI.writeFile(output, makeExportHTML(tab));
      showMessage(`已导出 ${output}`);
    }
  }
  async function exportPDF() {
    const tab = activeTab();
    if (!tab) return;
    const output = await window.appAPI.exportPDF(
      makeExportHTML(tab),
      `${stripExtension(tab.title)}.pdf`,
    );
    if (output) showMessage(`已导出 ${output}`);
  }

  function rememberRecent(filePath) {
    const recent = [
      { path: filePath, title: fileName(filePath), openedAt: Date.now() },
      ...(state.settings.recentFiles || []).filter((item) => item.path !== filePath),
    ].slice(0, 20);
    state.settings.recentFiles = recent;
    window.appAPI.saveSettings({ recentFiles: recent });
  }
  function persistSession() {
    if (!state.settings) return;
    const session = {
      workspacePath: state.settings.restoreWorkspace ? state.workspace : '',
      activeFilePath: state.settings.restoreTabs && activeTab() ? activeTab().filePath : null,
      openFiles: state.settings.restoreTabs
        ? state.tabs.map((tab) => tab.filePath).filter(Boolean)
        : [],
    };
    state.settings.session = session;
    window.appAPI.saveSettings({ session });
  }

  function openSettings() {
    const f = $('#settingsForm');
    $$('[name]', f).forEach((input) => {
      const key = input.name;
      let value;
      value = state.settings[key];
      if (
        key === 'codeTheme' &&
        value &&
        !Array.from(input.options).some((option) => option.value === value)
      ) {
        input.add(new Option(value, value));
      }
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (value !== undefined) input.value = value;
    });
    const tab = activeTab();
    const currentMode = tab?.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab?.mode;
    $('#previewZoomSetting').classList.toggle('hidden', currentMode !== 'sv');
    $('#editorTextWidthValue').textContent = `${$('#editorTextWidth').value}%`;
    $('#settingsModal').classList.remove('hidden');
  }
  async function saveSettings(closeAfterSave = true) {
    clearTimeout(settingsSaveTimer);
    const form = $('#settingsForm');
    const patch = {};
    const openModes = new Map(
      state.tabs.map((tab) => [
        tab.id,
        tab.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab.mode,
      ]),
    );
    $$('[name]', form).forEach((input) => {
      if (
        (input.type === 'number' || input.type === 'range') &&
        (!input.value || !input.validity.valid)
      )
        return;
      patch[input.name] =
        input.type === 'checkbox'
          ? input.checked
          : input.type === 'number' || input.type === 'range' || input.name.endsWith('Zoom')
            ? Number(input.value)
            : input.value;
    });
    patch.toolbarConfig = state.settings.toolbarConfig;
    state.settings = await window.appAPI.saveSettings(patch);
    if (closeAfterSave) $('#settingsModal').classList.add('hidden');
    applyLocale(state.settings.locale);
    applyPresentationSettings();
    await applyTheme(await resolveTheme());
    state.tabs.forEach((tab) => {
      tab.mode = openModes.get(tab.id) || tab.mode;
      rebuildEditor(tab);
    });
    showMessage(t('message.settingsSaved'));
  }

  async function resetCurrentSettingsPage() {
    const panel = $('[data-settings-panel].active');
    if (!panel || !state.defaultSettings) return;
    $$('[name]', panel).forEach((input) => {
      const value = state.defaultSettings[input.name];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (value !== undefined) input.value = value;
    });
    if (panel.dataset.settingsPanel === 'editor')
      $('#editorTextWidthValue').textContent = `${$('#editorTextWidth').value}%`;
    await saveSettings(false);
  }

  function scheduleLiveSettingsSave(event) {
    const input = event.target;
    if (
      (input.type === 'number' || input.type === 'range') &&
      (!input.value || !input.validity.valid)
    )
      return;
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(
      () => saveSettings(false),
      input.type === 'text' || input.type === 'number' ? 250 : 0,
    );
  }

  function setupSettingsDrag() {
    const card = $('.settings-card');
    const header = card.querySelector(':scope > header');
    header.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = card.getBoundingClientRect();
      card.style.position = 'fixed';
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const move = (moveEvent) => {
        const left = Math.max(
          0,
          Math.min(window.innerWidth - card.offsetWidth, moveEvent.clientX - offsetX),
        );
        const top = Math.max(
          0,
          Math.min(window.innerHeight - card.offsetHeight, moveEvent.clientY - offsetY),
        );
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  async function handleExternalChange(change) {
    if (state.workspace) {
      clearTimeout(state.treeTimer);
      state.treeTimer = setTimeout(refreshTree, 300);
    }
    if ((state.ignoredChanges.get(change.path) || 0) > Date.now()) return;
    if (!['change', 'unlink'].includes(change.event)) return;
    const tab = state.tabs.find((item) => item.filePath === change.path);
    if (!tab) return;
    if (change.event === 'unlink') {
      showMessage(`${tab.title} 已在外部删除`, true);
      return;
    }
    if (tab.modified) {
      showMessage(`${tab.title} 已在外部修改；当前有未保存内容，未自动重载`, true);
      return;
    }
    try {
      const result = await window.fileAPI.readFile(change.path);
      tab.lineEnding = detectLineEnding(result.content);
      tab.content = tab.savedContent = result.content;
      if (tab.vditor) tab.vditor.setValue(result.content, true);
      updateActiveUI();
      showMessage(`${tab.title} 已从磁盘重新载入`);
    } catch (_) {}
  }

  function handleMenu(action, value) {
    const handlers = {
      new: newTab,
      open: chooseFiles,
      'open-folder': chooseFolder,
      save: () => saveTab(),
      'save-as': () => saveTab(activeTab(), true),
      'close-tab': () => activeTab() && closeTab(activeTab().id),
      'toggle-sidebar': toggleSidebar,
      settings: openSettings,
      'export-html': exportHTML,
      'export-pdf': exportPDF,
      about: () => {
        openSettings();
        $('.settings-nav [data-panel="advanced"]').click();
      },
      mode: () => {
        const tab = activeTab();
        if (tab && value !== tab.mode) {
          rebuildEditor(tab, value);
          state.settings.editMode = value;
          window.appAPI.saveSettings({ editMode: value });
        }
      },
      theme: async () => {
        state.settings.theme = value;
        state.settings.systemTheme = false;
        await window.appAPI.saveSettings({ theme: value, systemTheme: false });
        applyTheme(value);
      },
    };
    if (handlers[action]) handlers[action]();
  }

  function setupAppMenus() {
    $$('.app-menu-popup').forEach((popup) => popup.remove());
    if (appMenuCloseHandler) document.removeEventListener('click', appMenuCloseHandler);
    $('#appMenuBar').dataset.ready = 'true';
    const run = (action, value) => () => handleMenu(action, value);
    const edit = (command) => () => {
      document.execCommand(command);
      activeTab()?.vditor?.focus();
    };
    const menus = {
      file: [
        ['menu.new', run('new'), 'Ctrl+N'],
        ['menu.open', run('open'), 'Ctrl+O'],
        ['menu.openFolder', run('open-folder')],
        null,
        ['menu.save', run('save'), 'Ctrl+S'],
        ['menu.saveAs', run('save-as'), 'Ctrl+Shift+S'],
        null,
        ['menu.exportHtml', run('export-html')],
        ['menu.exportPdf', run('export-pdf')],
        null,
        ['menu.closeTab', run('close-tab'), 'Ctrl+W'],
      ],
      edit: [
        ['menu.undo', edit('undo'), 'Ctrl+Z'],
        ['menu.redo', edit('redo'), 'Ctrl+Y'],
        null,
        ['menu.cut', edit('cut'), 'Ctrl+X'],
        ['menu.copy', edit('copy'), 'Ctrl+C'],
        ['menu.paste', edit('paste'), 'Ctrl+V'],
        ['menu.selectAll', edit('selectAll'), 'Ctrl+A'],
      ],
      view: [
        {
          label: 'menu.layout',
          children: [
            [
              'menu.layoutToolbar',
              () => setLayoutPart('toolbar'),
              '',
              () => state.settings.toolbarVisible !== false,
            ],
            [
              'menu.layoutSidebar',
              () => toggleSidebar(),
              'Ctrl+B',
              () => state.settings.sidebarVisible,
            ],
            [
              'menu.layoutTabbar',
              () => setLayoutPart('tabbar'),
              '',
              () => !$('#app').classList.contains('tabbar-hidden'),
            ],
            [
              'menu.layoutStatusbar',
              () => setLayoutPart('statusbar'),
              '',
              () => !$('#app').classList.contains('statusbar-hidden'),
            ],
            null,
            ['menu.resetLayout', () => resetLayout()],
          ],
        },
        null,
        ['menu.settings', run('settings'), 'Ctrl+,'],
        ['menu.fullscreen', () => window.appAPI.toggleFullscreen(), 'F11'],
      ],
      help: [
        ['menu.about', run('about')],
        [
          'menu.vditorGithub',
          () => window.appAPI.openExternal('https://github.com/Vanessa219/vditor'),
        ],
      ],
    };
    const close = () => {
      $$('.app-menu-popup').forEach((popup) => popup.remove());
      $$('.app-menu-bar button').forEach((b) => b.classList.remove('active'));
    };
    const fillPopup = (popup, items) => {
      items.forEach((item) => {
        if (!item) {
          popup.appendChild(document.createElement('hr'));
          return;
        }
        const button = document.createElement('button');
        if (item.children) {
          button.className = 'has-submenu';
          button.innerHTML = `<span><i class="checkmark"></i>${escapeHTML(t(item.label))}</span>`;
          const openSubmenu = (event) => {
            event.stopPropagation();
            $$('.app-menu-popup.submenu').forEach((menu) => menu.remove());
            const submenu = document.createElement('div');
            submenu.className = 'app-menu-popup submenu';
            fillPopup(submenu, item.children);
            document.body.appendChild(submenu);
            const rect = button.getBoundingClientRect();
            submenu.style.left = `${Math.min(rect.right, window.innerWidth - submenu.offsetWidth - 4)}px`;
            submenu.style.top = `${Math.min(rect.top - 5, window.innerHeight - submenu.offsetHeight - 4)}px`;
          };
          button.onmouseenter = openSubmenu;
          button.onclick = openSubmenu;
        } else {
          button.onmouseenter = () => {
            if (!popup.classList.contains('submenu'))
              $$('.app-menu-popup.submenu').forEach((menu) => menu.remove());
          };
          const checked = item[3] ? item[3]() : null;
          button.innerHTML = `<span><i class="checkmark">${checked === null ? '' : checked ? '✓' : ''}</i>${escapeHTML(t(item[0]))}</span><small>${escapeHTML(item[2] || '')}</small>`;
          button.onclick = (event) => {
            event.stopPropagation();
            close();
            item[1]();
          };
        }
        popup.appendChild(button);
      });
    };
    const openMenu = (trigger) => {
      close();
      trigger.classList.add('active');
      const popup = document.createElement('div');
      popup.className = 'app-menu-popup';
      fillPopup(popup, menus[trigger.dataset.menu] || []);
      document.body.appendChild(popup);
      const rect = trigger.getBoundingClientRect();
      popup.style.left = `${rect.left}px`;
      popup.style.top = `${rect.bottom}px`;
    };
    $$('.app-menu-bar > button').forEach((trigger) => {
      trigger.onclick = (event) => {
        event.stopPropagation();
        if (trigger.classList.contains('active')) close();
        else openMenu(trigger);
      };
      trigger.onmouseenter = () => {
        const active = $('.app-menu-bar > button.active');
        if (active && active !== trigger) openMenu(trigger);
      };
    });
    appMenuCloseHandler = close;
    document.addEventListener('click', appMenuCloseHandler);
  }

  function setLayoutPart(part) {
    if (part === 'toolbar') {
      state.settings.toolbarVisible = state.settings.toolbarVisible === false;
      $('#app').classList.toggle('toolbar-hidden', !state.settings.toolbarVisible);
      window.appAPI.saveSettings({ toolbarVisible: state.settings.toolbarVisible });
    } else if (part === 'tabbar') $('#app').classList.toggle('tabbar-hidden');
    else if (part === 'statusbar') $('#app').classList.toggle('statusbar-hidden');
  }

  function resetLayout() {
    state.settings.toolbarVisible = true;
    state.settings.sidebarVisible = true;
    $('#app').classList.remove('toolbar-hidden', 'tabbar-hidden', 'statusbar-hidden');
    $('#sidebar').classList.remove('collapsed');
    window.appAPI.saveSettings({ toolbarVisible: true, sidebarVisible: true });
  }

  function toggleSidebar(force) {
    const visible =
      typeof force === 'boolean' ? force : $('#sidebar').classList.contains('collapsed');
    $('#sidebar').classList.toggle('collapsed', !visible);
    state.settings.sidebarVisible = visible;
    window.appAPI.saveSettings({ sidebarVisible: visible });
  }

  function setupEvents() {
    setupAppMenus();
    $('#windowMinimize').onclick = () => window.appAPI.minimize();
    $('#windowMaximize').onclick = () => window.appAPI.maximize();
    $('#windowClose').onclick = () => window.appAPI.closeWindow();
    $('#windowTitlebar').ondblclick = (event) => {
      if (!event.target.closest('button')) window.appAPI.maximize();
    };
    $('#newFile').onclick = newTab;
    $('#addTab').onclick = newTab;
    $('#openFile').onclick = chooseFiles;
    $('#saveFile').onclick = () => saveTab();
    $('#emptyNewFile').onclick = newTab;
    $('#emptyOpenFile').onclick = chooseFiles;
    $('#toggleSidebar').onclick = () => toggleSidebar();
    $('#settingsButton').onclick = openSettings;
    $('#statusSettings').onclick = openSettings;
    $('#statusThemeToggle').onchange = async (event) => {
      const theme = event.target.checked ? 'dark' : 'classic';
      state.settings.theme = theme;
      state.settings.systemTheme = false;
      await window.appAPI.saveSettings({ theme, systemTheme: false });
      await applyTheme(theme);
    };
    $('#refreshTree').onclick = refreshTree;
    $('#workspaceHeading').onclick = () => {
      if (!state.workspace) chooseFolder();
    };
    $('#openFolderEmpty').onclick = chooseFolder;
    $$('.sidebar-tabs button').forEach(
      (button) =>
        (button.onclick = () => {
          $$('.sidebar-tabs button').forEach((item) =>
            item.classList.toggle('active', item === button),
          );
          $$('.sidebar-view').forEach((view) =>
            view.classList.toggle('active', view.id === `${button.dataset.view}View`),
          );
          if (button.dataset.view === 'outline') renderOutline();
        }),
    );
    $$('.settings-nav button').forEach(
      (button) =>
        (button.onclick = () => {
          $$('.settings-nav button').forEach((item) =>
            item.classList.toggle('active', item === button),
          );
          $$('[data-settings-panel]').forEach((panel) =>
            panel.classList.toggle('active', panel.dataset.settingsPanel === button.dataset.panel),
          );
        }),
    );
    $$('[data-close]').forEach((button) => {
      button.onclick = () => {
        $(`#${button.dataset.close}`).classList.add('hidden');
        if (button.dataset.close === 'settingsModal') applyPresentationSettings();
      };
    });
    $('#saveSettings').onclick = () => saveSettings(true);
    $('#resetSettingsPage').onclick = resetCurrentSettingsPage;
    $('#settingsForm').addEventListener('change', scheduleLiveSettingsSave);
    $('#editorTextWidth').oninput = (event) => {
      const value = Math.min(100, Math.max(40, Number(event.target.value)));
      $('#editorTextWidthValue').textContent = `${value}%`;
      document.documentElement.style.setProperty('--editor-text-width', `${value}%`);
    };
    $('#resetSettings').onclick = async () => {
      if (await window.appAPI.confirm({ message: t('confirm.resetSettings') })) {
        state.settings = await window.appAPI.resetSettings();
        applyLocale(state.settings.locale);
        openSettings();
      }
    };
    setupSettingsDrag();
    $('#openSettingsFolder').onclick = async () =>
      window.appAPI.showItemInFolder(await window.appAPI.getSettingsPath());
    document.addEventListener('click', () => $('#contextMenu').classList.add('hidden'));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Alt' && $('#app').classList.contains('fullscreen')) {
        event.preventDefault();
        $('#app').classList.add('fullscreen-menu-visible');
        return;
      }
      if (event.key === 'Escape') $('#app').classList.remove('fullscreen-menu-visible');
      if (event.key === 'F11') {
        event.preventDefault();
        window.appAPI.toggleFullscreen();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        saveTab(activeTab(), event.shiftKey);
      } else if (key === 'o') {
        event.preventDefault();
        chooseFiles();
      } else if (key === 'n') {
        event.preventDefault();
        newTab();
      } else if (key === 'b') {
        event.preventDefault();
        toggleSidebar();
      } else if (key === ',') {
        event.preventDefault();
        openSettings();
      } else if (key === 'w') {
        event.preventDefault();
        const tab = activeTab();
        if (tab) closeTab(tab.id);
      }
    });
    const resize = $('#sidebarResize');
    let resizing = false;
    resize.onmousedown = () => {
      resizing = true;
      document.body.classList.add('resizing');
    };
    window.addEventListener('mousemove', (event) => {
      if (resizing) {
        const width = Math.max(180, Math.min(500, event.clientX));
        $('#sidebar').style.width = `${width}px`;
        state.settings.sidebarWidth = width;
      }
    });
    window.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        document.body.classList.remove('resizing');
        window.appAPI.saveSettings({ sidebarWidth: state.settings.sidebarWidth });
      }
    });
    window.appAPI.onMenuAction(handleMenu);
    window.appAPI.onSystemThemeChanged((theme) => {
      if (state.settings.systemTheme) applyTheme(theme);
    });
    window.appAPI.onFullscreenChanged((fullscreen) => {
      $('#app').classList.toggle('fullscreen', fullscreen);
      if (!fullscreen) $('#app').classList.remove('fullscreen-menu-visible');
      state.tabs.forEach((tab) => scheduleSplitLineNumbers(tab));
    });
    window.fileAPI.onChanged(handleExternalChange);
    window.appAPI.onRequestClose(async () => {
      const dirty = state.tabs.filter((tab) => tab.modified);
      if (!dirty.length) {
        window.appAPI.closeConfirmed();
        return;
      }
      const proceed = await window.appAPI.confirm({
        message: t('confirm.quitDirty', { count: dirty.length }),
        detail: dirty.map((tab) => tab.title).join('\n'),
      });
      if (proceed) window.appAPI.closeConfirmed();
    });
    document.body.addEventListener('dragover', (event) => event.preventDefault());
    document.body.addEventListener('drop', async (event) => {
      event.preventDefault();
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => window.fileAPI.getDroppedPath(file))
        .filter(Boolean);
      const markdown = paths.filter((filePath) =>
        /\.(md|markdown|mdown|mkd|mkdn)$/i.test(filePath),
      );
      if (markdown.length) await openPaths(markdown);
      else if (paths.length) showMessage('仅支持拖入 Markdown 文件', true);
    });
  }

  async function init() {
    if (typeof Vditor === 'undefined' || !window.fileAPI || !window.appAPI) {
      document.body.innerHTML =
        '<div class="fatal"><h1>应用资源加载失败</h1><p>请重新运行 npm run build。</p></div>';
      return;
    }
    state.settings = await window.appAPI.getSettings();
    state.defaultSettings = await window.appAPI.getDefaultSettings();
    applyLocale(state.settings.locale);
    setupEvents();
    $('#sidebar').style.width = `${state.settings.sidebarWidth}px`;
    toggleSidebar(state.settings.sidebarVisible);
    $('#app').classList.toggle('fullscreen', await window.appAPI.isFullscreen());
    applyPresentationSettings();
    await applyTheme(await resolveTheme());
    $('#settingsPath').textContent = await window.appAPI.getSettingsDisplayPath();
    const info = await window.appAPI.getInfo();
    $('#statusVersion').textContent = `v${info.app}`;
    $('#versionInfo').innerHTML =
      `Vditor Desktop ${escapeHTML(info.app)}<br>Vditor ${escapeHTML(info.vditor)} · Electron ${escapeHTML(info.electron)} · Node ${escapeHTML(info.node)}`;
    const session = state.settings.session;
    if (state.settings.restoreWorkspace && session?.workspacePath)
      await setWorkspace(session.workspacePath);
    if (state.settings.restoreTabs && session?.openFiles?.length) {
      await openPaths(session.openFiles);
      const active = state.tabs.find((tab) => tab.filePath === session.activeFilePath);
      if (active) switchTab(active.id);
    }
    if (!state.tabs.length) updateActiveUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
