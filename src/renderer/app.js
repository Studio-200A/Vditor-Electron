(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const VDITOR = window.VditorDesktopAdapter;
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
    'edit-mode',
    'both',
    'preview',
    'outline',
    'code-theme',
    'content-theme',
  ];
  let messageTimer;
  let appMenuCloseHandler;
  let appMenuBlurHandler;
  let settingsSaveTimer;
  let settingsCloseTimer;
  let confirmResolver;
  let treeNameFrame;
  let treeNameMeasureContext;
  const scrollAnimations = new WeakMap();

  function resolveLocale(locale) {
    if (locale && locale !== 'system' && LOCALES[locale]) return locale;
    const language = navigator.language.replace('_', '-').toLowerCase();
    if (!language.startsWith('zh')) return 'en_US';
    return /(?:^|-)hant(?:-|$)|(?:^|-)(?:tw|hk|mo)(?:-|$)/.test(language) ? 'zh_Hant' : 'zh_Hans';
  }

  function t(key, params = {}) {
    const table = LOCALES[state.locale] || LOCALES.en_US || {};
    const english = LOCALES.en_US || {};
    const fallback = Object.prototype.hasOwnProperty.call(english, key) ? english[key] : key;
    const value = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
    return String(value).replace(/\{(\w+)\}/g, (_match, name) => params[name] ?? `{${name}}`);
  }

  function updateMaximizedState(maximized) {
    document.body.classList.toggle('window-maximized', maximized);
    const button = $('#windowMaximize');
    const key = maximized ? 'window.restore' : 'window.maximize';
    button.dataset.i18nTitle = key;
    button.title = t(key);
    button.setAttribute('aria-label', t(key));
  }

  function closeConfirmDialog(action = 'cancel') {
    if (!confirmResolver) return;
    const resolve = confirmResolver;
    confirmResolver = null;
    $('#confirmModal').classList.add('hidden');
    $('#confirmActions').replaceChildren();
    resolve(action);
  }

  function showConfirmDialog({ title, message, detail = '', actions } = {}) {
    if (confirmResolver) closeConfirmDialog('cancel');
    const modal = $('#confirmModal');
    $('#confirmTitle').textContent = title || t('dialog.confirmTitle');
    $('#confirmMessage').textContent = message || '';
    $('#confirmDetail').textContent = detail;
    const availableActions = actions || [
      { id: 'cancel', label: t('dialog.cancel') },
      { id: 'confirm', label: t('dialog.continue'), primary: true },
    ];
    const actionHost = $('#confirmActions');
    availableActions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.dataset.action = action.id;
      if (action.primary) button.classList.add('primary');
      if (action.danger) button.classList.add('danger');
      button.onclick = () => closeConfirmDialog(action.id);
      actionHost.append(button);
    });
    modal.classList.remove('hidden');
    requestAnimationFrame(() =>
      (actionHost.querySelector('.primary') || actionHost.querySelector('button'))?.focus(),
    );
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  async function confirmDialog(options) {
    return (await showConfirmDialog(options)) === 'confirm';
  }

  function showUnsavedDialog(message, detail = '') {
    return showConfirmDialog({
      title: t('dialog.unsavedTitle'),
      message,
      detail,
      actions: [
        { id: 'cancel', label: t('dialog.cancel') },
        { id: 'discard', label: t('dialog.dontSave') },
        { id: 'save', label: t('dialog.save'), primary: true },
      ],
    });
  }

  function applyLocale(locale) {
    state.locale = resolveLocale(locale);
    document.documentElement.lang =
      state.locale === 'zh_Hans' ? 'zh-Hans' : state.locale === 'zh_Hant' ? 'zh-Hant' : 'en-US';
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

  function middleEllipsis(value, availableWidth, style) {
    if (!treeNameMeasureContext) {
      treeNameMeasureContext = document.createElement('canvas').getContext('2d');
    }
    if (!treeNameMeasureContext || availableWidth <= 0) return value;
    treeNameMeasureContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const measure = (text) => treeNameMeasureContext.measureText(text).width;
    if (measure(value) <= availableWidth) return value;
    const characters = Array.from(value);
    const ellipsis = '...';
    for (let kept = characters.length - 1; kept > 1; kept -= 1) {
      const leading = Math.ceil(kept / 2);
      const trailing = Math.floor(kept / 2);
      const candidate = `${characters.slice(0, leading).join('')}${ellipsis}${characters
        .slice(characters.length - trailing)
        .join('')}`;
      if (measure(candidate) <= availableWidth) return candidate;
    }
    return ellipsis;
  }

  function updateTreeNameEllipses() {
    treeNameFrame = null;
    $$('.tree-name', $('#fileTree')).forEach((name) => {
      if (!name.clientWidth) return;
      name.textContent = middleEllipsis(
        name.dataset.fullName || '',
        name.clientWidth,
        getComputedStyle(name),
      );
    });
  }

  function scheduleTreeNameEllipses() {
    if (treeNameFrame) return;
    treeNameFrame = requestAnimationFrame(updateTreeNameEllipses);
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

  function isDarkTheme(theme) {
    return theme === 'dark' || theme === 'monokai-pro-dark';
  }

  function darkThemePreference() {
    return state.settings.lastDarkTheme === 'monokai-pro-dark' ? 'monokai-pro-dark' : 'dark';
  }

  function mapSystemTheme(theme) {
    return theme === 'dark' ? darkThemePreference() : 'classic';
  }

  function preferredCodeTheme(dark) {
    return dark ? state.settings.darkCodeTheme : state.settings.lightCodeTheme;
  }

  function ensureCodeThemeOption(codeTheme, dark) {
    const select = $('#settingsForm [name="codeTheme"]');
    if (!select || !codeTheme) return;
    let option = Array.from(select.options).find((item) => item.value === codeTheme);
    if (!option) {
      option = new Option(codeTheme, codeTheme);
      option.dataset.themeTone = dark ? 'dark' : 'light';
      select.add(option);
    }
  }

  function syncCodeThemeSelect(dark, codeTheme = preferredCodeTheme(dark)) {
    const select = $('#settingsForm [name="codeTheme"]');
    if (!select) return;
    ensureCodeThemeOption(codeTheme, dark);
    const tone = dark ? 'dark' : 'light';
    Array.from(select.options).forEach((option) => {
      const allowed = option.dataset.themeTone === tone;
      option.hidden = !allowed;
      option.disabled = !allowed;
    });
    select.value = codeTheme;
  }

  function syncCodeThemeMenus(dark) {
    state.tabs.forEach((tab) => {
      VDITOR.classifyCodeThemeButtons(tab.toolbar).forEach(({ button, tone }) => {
        button.dataset.themeTone = tone;
        button.hidden = tone !== (dark ? 'dark' : 'light');
      });
    });
  }

  function syncCodeThemeControls(dark, codeTheme = preferredCodeTheme(dark)) {
    syncCodeThemeSelect(dark, codeTheme);
    syncCodeThemeMenus(dark);
  }

  function syncContentThemeHosts(contentTheme) {
    state.tabs.forEach((tab) => {
      if (tab.host) tab.host.dataset.contentTheme = contentTheme;
    });
  }

  async function resolveTheme() {
    return state.settings.systemTheme
      ? mapSystemTheme(await window.appAPI.getSystemTheme())
      : state.settings.theme;
  }

  async function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = isDarkTheme(theme);
    if ($('#statusThemeToggle')) $('#statusThemeToggle').checked = dark;
    const linkedContentTheme = ['light', 'dark'].includes(state.settings.contentTheme);
    const contentTheme = linkedContentTheme
      ? dark
        ? 'dark'
        : 'light'
      : state.settings.contentTheme;
    syncContentThemeHosts(contentTheme);
    const settingsPatch = {};
    if (linkedContentTheme && contentTheme !== state.settings.contentTheme) {
      state.settings.contentTheme = contentTheme;
      const contentThemeSelect = $('#settingsForm [name="contentTheme"]');
      if (contentThemeSelect) contentThemeSelect.value = contentTheme;
      settingsPatch.contentTheme = contentTheme;
    }
    const codeTheme = preferredCodeTheme(dark);
    if (codeTheme !== state.settings.codeTheme) {
      state.settings.codeTheme = codeTheme;
      settingsPatch.codeTheme = codeTheme;
    }
    syncCodeThemeControls(dark, codeTheme);
    if (Object.keys(settingsPatch).length) await window.appAPI.saveSettings(settingsPatch);
    state.tabs.forEach((tab) => {
      if (tab.vditor) {
        try {
          tab.vditor.setTheme(
            dark ? 'dark' : 'classic',
            contentTheme,
            codeTheme,
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
    document.documentElement.dataset.scrollbarMode = s.scrollbarMode || 'auto';
    if (s.scrollbarMode !== 'auto')
      $$('.app-scrollbar.scrollbar-visible').forEach((node) =>
        node.classList.remove('scrollbar-visible'),
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

  function scheduleWhitespaceMarkers(tab, sv = VDITOR.editorParts(tab?.host).source) {
    if (!tab || !sv) return;
    if (tab.whitespaceFrame) return;
    tab.whitespaceFrame = requestAnimationFrame(() => {
      tab.whitespaceFrame = null;
      renderWhitespaceMarkers(tab, sv);
    });
  }

  function observeSplitLineNumbers(tab) {
    tab.lineObserver?.disconnect();
    tab.lineResizeObserver?.disconnect();
    const sv = VDITOR.editorParts(tab.host).source;
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
    if (tab.whitespaceFrame) cancelAnimationFrame(tab.whitespaceFrame);
    tab.lineObserver = null;
    tab.lineResizeObserver = null;
    tab.lineNumberFrame = null;
    tab.whitespaceFrame = null;
  }

  function renderWhitespaceMarkers(tab, sv) {
    const content = VDITOR.editorParts(tab.host).content;
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
    let canvas = layer.querySelector(':scope > .sv-whitespace-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'sv-whitespace-canvas';
      layer.appendChild(canvas);
    }
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, sv.clientWidth);
    const height = Math.max(1, sv.clientHeight);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.transform = 'translateY(0)';
    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(height * pixelRatio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(pixelRatio, pixelRatio);
    context.fillStyle = getComputedStyle(layer).color;
    const svRect = sv.getBoundingClientRect();
    const markerPositions = [];
    const walker = document.createTreeWalker(sv, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      for (let index = 0; index < textNode.data.length; index += 1) {
        const character = textNode.data[index];
        if (character !== ' ' && character !== '\t') continue;
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const rect = Array.from(range.getClientRects()).find(
          (item) =>
            item.width > 0 &&
            item.height > 0 &&
            item.right > svRect.left &&
            item.left < svRect.right &&
            item.bottom > svRect.top &&
            item.top < svRect.bottom,
        );
        if (!rect) continue;
        const markerCount = character === '\t' ? Number(state.settings.tabSize) || 4 : 1;
        for (let markerIndex = 0; markerIndex < markerCount; markerIndex += 1) {
          const x = rect.left - svRect.left + (rect.width * (markerIndex + 0.5)) / markerCount;
          const y = rect.top - svRect.top + rect.height / 2;
          markerPositions.push({ x, y });
          context.beginPath();
          context.arc(x, y, Math.max(1, Math.min(1.35, rect.height / 12)), 0, Math.PI * 2);
          context.fill();
        }
      }
      textNode = walker.nextNode();
    }
    canvas.dataset.markerCount = String(markerPositions.length);
    canvas.dataset.scrollTop = String(sv.scrollTop);
    canvas.whitespaceMarkerPositions = markerPositions;
  }

  function syncSplitViewLayout(tab) {
    if (!tab?.vditor || !tab.ready) return;
    const { source: sv, preview } = VDITOR.editorParts(tab.host);
    if (!sv || !preview) return;
    const splitMode = tab.vditor.getCurrentMode() === 'sv';
    const sourceVisible = splitMode && getComputedStyle(sv).display !== 'none';
    const previewVisible = splitMode && getComputedStyle(preview).display !== 'none';
    tab.host.classList.toggle('sv-editor-only', sourceVisible && !previewVisible);
    tab.host.classList.toggle('sv-preview-only', !sourceVisible && previewVisible);
    tab.host.classList.toggle('sv-both', sourceVisible && previewVisible);
  }

  function ensureSplitResizer(tab) {
    const { content, preview } = VDITOR.editorParts(tab.host);
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
    const { content, source: sv, preview } = VDITOR.editorParts(tab.host);
    if (!content || !sv || !preview) return;
    let gutter = content.querySelector(':scope > .sv-line-numbers');
    if (!gutter) {
      gutter = document.createElement('div');
      gutter.className = 'sv-line-numbers';
      content.insertBefore(gutter, content.firstChild);
      sv.addEventListener('scroll', () => {
        gutter.scrollTop = sv.scrollTop;
        const canvas = content.querySelector('.sv-whitespace-canvas');
        if (canvas) {
          const renderedScrollTop = Number(canvas.dataset.scrollTop || 0);
          canvas.style.transform = `translateY(${renderedScrollTop - sv.scrollTop}px)`;
        }
        scheduleWhitespaceMarkers(tab, sv);
      });
    }
    const isSplitView = tab.vditor.getCurrentMode() === 'sv';
    syncSplitViewLayout(tab);
    const sourceVisible = isSplitView && getComputedStyle(sv).display !== 'none';
    gutter.classList.toggle('hidden', !sourceVisible);
    if (tab.splitResizer) {
      const previewVisible = getComputedStyle(preview).display !== 'none';
      tab.splitResizer.classList.toggle('hidden', !sourceVisible || !previewVisible);
    }
    if (!sourceVisible) {
      content.querySelector(':scope > .sv-whitespace-layer')?.remove();
      return;
    }

    const count = Math.max(1, currentContent(tab).split(/\r?\n/).length);
    const style = getComputedStyle(sv);
    const lineHeight =
      Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    const svRect = sv.getBoundingClientRect();
    const newlines = VDITOR.sourceNewlines(sv);
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
      const number = document.createElement('span');
      number.className = 'sv-line-number';
      number.style.top = `${top}px`;
      number.textContent = String(index + 1);
      canvas.appendChild(number);
    });
    gutter.replaceChildren(canvas);
    gutter.scrollTop = sv.scrollTop;
    renderWhitespaceMarkers(tab, sv);
  }

  function setupSplitEditorEnhancements(tab) {
    const sv = VDITOR.editorParts(tab.host).source;
    if (!sv || sv.dataset.desktopEnhancements === 'true') return;
    sv.dataset.desktopEnhancements = 'true';
    setupAutoHideScrollbar(sv);
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

  function setupAutoHideScrollbar(element) {
    if (!element || element.dataset.autoHideScrollbar === 'true') return;
    element.dataset.autoHideScrollbar = 'true';
    element.classList.add('app-scrollbar');
    let timer;
    const reveal = () => {
      if (document.documentElement.dataset.scrollbarMode !== 'auto') {
        element.classList.remove('scrollbar-visible');
        return;
      }
      element.classList.add('scrollbar-visible');
      clearTimeout(timer);
      timer = setTimeout(() => element.classList.remove('scrollbar-visible'), 1000);
    };
    element.addEventListener('mousemove', (event) => {
      const rect = element.getBoundingClientRect();
      if (rect.right - event.clientX <= 14) reveal();
    });
    element.addEventListener('scroll', reveal, { passive: true });
  }

  function editorOptions(tab) {
    const s = state.settings;
    const wasModified = tab.modified;
    const savedBefore = tab.savedContent;
    const lang =
      state.locale === 'zh_Hans' ? 'zh_CN' : state.locale === 'zh_Hant' ? 'zh_TW' : 'en_US';
    const appTheme = document.documentElement.dataset.theme || s.theme;
    return {
      value: tab.content,
      mode: tab.mode,
      theme: isDarkTheme(appTheme) ? 'dark' : 'classic',
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
        actions: s.multiPlatformPreview
          ? ['desktop', 'tablet', 'mobile', 'mp-wechat', 'zhihu']
          : [],
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
        const contract = VDITOR.validateHost(tab.host);
        if (!contract.valid) {
          tab.ready = false;
          console.error('Unsupported Vditor DOM contract:', contract.missing);
          showMessage(`Vditor integration mismatch: ${contract.missing.join(', ')}`, true);
          return;
        }
        tab.host.dataset.localResourceBase = localResourceBase(tab.baseDir);
        tab.host.dataset.contentTheme = state.settings.contentTheme;
        tab.resourceObserver?.disconnect();
        tab.resourceObserver = VDITOR.observeRelativeImageSources(
          tab.host,
          tab.host.dataset.localResourceBase,
        );
        setupDocumentAnchorNavigation(tab);
        VDITOR.scrollContainers(tab.host).forEach(setupAutoHideScrollbar);
        const normalized = currentContent(tab);
        tab.content = normalized;
        tab.savedContent = wasModified ? savedBefore : normalized;
        tab.modified = wasModified || normalized !== tab.savedContent;
        tab.ready = true;
        tab.toolbar = VDITOR.editorParts(tab.host).toolbar;
        tab.toolbar.addEventListener(
          'click',
          (event) => handleVditorToolbarClick(tab, event),
          true,
        );
        tab.toolbar.addEventListener(
          'mousedown',
          (event) => preserveSplitToolbarSelection(tab, event),
          true,
        );
        syncSplitToolbarActions(tab);
        syncCodeThemeControls(isDarkTheme(appTheme), state.settings.codeTheme);
        if (tab.id === state.activeId) mountEditorToolbar(tab);
        renderTabs();
        updateActiveUI();
        observeSplitLineNumbers(tab);
        ensureSplitResizer(tab);
        setupSplitEditorEnhancements(tab);
        scheduleSplitLineNumbers(tab);
        setTimeout(() => tab.vditor && tab.vditor.focus(), 0);
        restoreEditorScroll(tab);
      },
      input: (value) => onEditorInput(tab, value),
      blur: (value) => {
        tab.content = value;
      },
    };
  }

  function preserveSplitToolbarSelection(tab, event) {
    const { type } = VDITOR.toolbarContext(event.target);
    if (tab.vditor?.getCurrentMode() === 'sv' && (type === 'outdent' || type === 'indent')) {
      event.preventDefault();
      const selection = window.getSelection();
      const sourceEditor = VDITOR.editorParts(tab.host).source;
      if (sourceEditor?.contains(selection?.anchorNode) && selection.rangeCount > 0) {
        tab.splitToolbarRange = selection.getRangeAt(0).cloneRange();
      }
    }
  }

  function handleVditorToolbarClick(tab, event) {
    const { button, item, trigger, type } = VDITOR.toolbarContext(event.target);
    if (!button || !trigger) return;
    if (
      button === trigger &&
      (type === 'outdent' || type === 'indent') &&
      tab.vditor?.getCurrentMode() === 'sv'
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const sourceEditor = VDITOR.editorParts(tab.host).source;
      if (sourceEditor && tab.splitToolbarRange?.startContainer?.isConnected) {
        sourceEditor.focus({ preventScroll: true });
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(tab.splitToolbarRange);
      }
      const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
      const { marker, padding } = VDITOR.listContext(range?.startContainer);
      if (sourceEditor && marker) {
        if (type === 'outdent') {
          padding?.remove();
        } else {
          const padding = document.createElement('span');
          padding.dataset.type = 'padding';
          padding.textContent = marker.textContent.replace(/\S/g, ' ');
          marker.before(padding);
        }
        sourceEditor.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: type === 'outdent' ? 'deleteContentBackward' : 'insertText',
            data: type === 'outdent' ? null : ' ',
          }),
        );
      }
      tab.splitToolbarRange = null;
      return;
    }
    const themeMenu = type === 'code-theme' || type === 'content-theme';
    if (themeMenu && button === trigger) {
      VDITOR.hoverTooltips($('#vditorToolbarMount')).forEach((node) =>
        node.classList.remove('vditor-tooltipped--hover'),
      );
      trigger.classList.add('app-submenu-open');
      setTimeout(() => {
        const panel = VDITOR.toolbarHint(item);
        if (panel?.style.display !== 'block') trigger.classList.remove('app-submenu-open');
      }, 0);
    }
    if (button === trigger) {
      if (type === 'both' || type === 'preview')
        setTimeout(() => scheduleSplitLineNumbers(tab), 50);
      return;
    }
    if (type === 'edit-mode' && ['wysiwyg', 'ir', 'sv'].includes(button.dataset.mode)) {
      setTimeout(() => {
        if (!tab.vditor) return;
        tab.mode = tab.vditor.getCurrentMode();
        state.settings.editMode = tab.mode;
        window.appAPI.saveSettings({ editMode: tab.mode });
        syncSplitToolbarActions(tab);
        updateActiveUI();
        scheduleSplitLineNumbers(tab);
      }, 50);
    } else if (type === 'code-theme') {
      const codeTheme = button.textContent.trim();
      if (!codeTheme) return;
      const dark = isDarkTheme(document.documentElement.dataset.theme);
      if (button.dataset.themeTone !== (dark ? 'dark' : 'light')) return;
      const preferenceKey = dark ? 'darkCodeTheme' : 'lightCodeTheme';
      state.settings.codeTheme = codeTheme;
      state.settings[preferenceKey] = codeTheme;
      syncCodeThemeSelect(dark, codeTheme);
      window.appAPI.saveSettings({ codeTheme, [preferenceKey]: codeTheme });
    } else if (type === 'content-theme' && button.dataset.type) {
      state.settings.contentTheme = button.dataset.type;
      syncContentThemeHosts(button.dataset.type);
      window.appAPI.saveSettings({ contentTheme: button.dataset.type });
      if (button.dataset.type === 'light' || button.dataset.type === 'dark') {
        setTimeout(
          () => applyTheme(document.documentElement.dataset.theme || state.settings.theme),
          0,
        );
      }
    }
    if (themeMenu) {
      setTimeout(() => {
        VDITOR.toolbarHints($('#vditorToolbarMount')).forEach((panel) => {
          panel.style.display = 'none';
        });
        VDITOR.openSubmenus($('#vditorToolbarMount')).forEach((node) => {
          node.classList.remove('app-submenu-open');
          node.blur();
        });
      }, 0);
    }
  }

  function syncSplitToolbarActions(tab) {
    if (!tab.toolbar || tab.vditor?.getCurrentMode() !== 'sv') return;
    ['outdent', 'indent'].forEach((type) => {
      const button = VDITOR.toolbarButton(tab.toolbar, type);
      const item = button?.closest(VDITOR.selectors.toolbarItem);
      if (item) item.style.display = 'block';
      button?.classList.remove('vditor-menu--disabled');
    });
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

  function captureEditorScroll(tab) {
    if (!tab?.vditor) return null;
    const parts = VDITOR.editorParts(tab.host);
    const mode = tab.vditor.getCurrentMode();
    const editor = parts[mode === 'sv' ? 'source' : mode === 'ir' ? 'instantRendering' : 'wysiwyg'];
    const containers = [editor, editor?.querySelector(VDITOR.selectors.reset)].filter(Boolean);
    return {
      mode,
      positions: containers.map((container) => ({
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      })),
    };
  }

  function restoreEditorScroll(tab) {
    const saved = tab.pendingScroll;
    if (!saved) return;
    tab.pendingScroll = null;
    const restore = () => {
      const parts = VDITOR.editorParts(tab.host);
      const mode = tab.vditor?.getCurrentMode() || tab.mode;
      const editor =
        parts[mode === 'sv' ? 'source' : mode === 'ir' ? 'instantRendering' : 'wysiwyg'];
      const containers = [editor, editor?.querySelector(VDITOR.selectors.reset)].filter(Boolean);
      containers.forEach((container, index) => {
        const position = saved.positions[index];
        if (!position) return;
        container.scrollTop = position.scrollTop;
        container.scrollLeft = position.scrollLeft;
      });
      scheduleSplitLineNumbers(tab);
    };
    requestAnimationFrame(() => requestAnimationFrame(restore));
  }

  function restoreEditorToolbar(tab) {
    if (tab && tab.toolbar && tab.toolbar.parentElement === $('#vditorToolbarMount')) {
      tab.host.insertBefore(tab.toolbar, tab.host.firstChild);
    }
  }

  function mountEditorToolbar(tab) {
    const mount = $('#vditorToolbarMount');
    const mounted = mount.querySelector(VDITOR.selectors.toolbar);
    if (mounted && mounted !== tab.toolbar) {
      const owner = state.tabs.find((item) => item.toolbar === mounted);
      if (owner && owner.host.isConnected) owner.host.insertBefore(mounted, owner.host.firstChild);
      else mounted.remove();
    }
    if (tab.toolbar && tab.toolbar.parentElement !== mount) mount.appendChild(tab.toolbar);
  }

  function rebuildEditor(tab, mode) {
    tab.pendingScroll = captureEditorScroll(tab);
    disconnectSplitLineNumbers(tab);
    tab.resourceObserver?.disconnect();
    tab.resourceObserver = null;
    if (tab.vditor) {
      restoreEditorToolbar(tab);
      try {
        tab.content = VDITOR.withOriginalImageSources(tab.host, () => tab.vditor.getValue());
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
      whitespaceFrame: null,
      outlineCollapsed: new Set(),
      resourceObserver: null,
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
          syncSplitToolbarActions(tab);
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
    scheduleSplitLineNumbers(tab);
    renderTabs();
    updateActiveUI();
    renderOutline();
    persistSession();
  }

  async function closeTab(id) {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    if (tab.modified) {
      const action = await showUnsavedDialog(
        t('confirm.closeDirty', { title: tab.title }),
        t('confirm.closeDirtyDetail'),
      );
      if (action === 'cancel' || (action === 'save' && !(await saveTab(tab)))) return;
    }
    clearTimeout(tab.saveTimer);
    disconnectSplitLineNumbers(tab);
    tab.resourceObserver?.disconnect();
    tab.resourceObserver = null;
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
      return tab.vditor
        ? VDITOR.withOriginalImageSources(tab.host, () => tab.vditor.getValue())
        : tab.content;
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
    document.title = `${tab.title} - Vditor Desktop`;
    $('#windowTitle').textContent = `${tab.title} - Vditor Desktop`;
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
    if (folder) {
      await setWorkspace(folder);
      toggleSidebar(true);
      const filesTab = $('.sidebar-tabs [data-view="files"]');
      if (filesTab && !filesTab.classList.contains('active')) filesTab.click();
    }
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
    await appendDirectory(root, state.workspace);
  }

  function expandedWorkspacePaths() {
    if (!state.settings.restoreWorkspace || !state.workspace) return new Set();
    const saved = (state.settings.workspaceTreeStates || []).find(
      (item) => item.workspacePath === state.workspace,
    );
    return new Set(saved?.expandedPaths || []);
  }

  function persistDirectoryExpansion(directoryPath, expanded) {
    if (!state.settings.restoreWorkspace || !state.workspace) return;
    const previous = state.settings.workspaceTreeStates || [];
    const current = previous.find((item) => item.workspacePath === state.workspace);
    const expandedPaths = new Set(current?.expandedPaths || []);
    if (expanded) expandedPaths.add(directoryPath);
    else expandedPaths.delete(directoryPath);
    const workspaceState = {
      workspacePath: state.workspace,
      expandedPaths: Array.from(expandedPaths).slice(0, 500),
    };
    const workspaceTreeStates = [
      workspaceState,
      ...previous.filter((item) => item.workspacePath !== state.workspace),
    ].slice(0, 20);
    state.settings.workspaceTreeStates = workspaceTreeStates;
    void window.appAPI.saveSettings({ workspaceTreeStates });
  }

  async function appendDirectory(container, dirPath) {
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
      row.innerHTML = `<span class="chevron">${entry.type === 'directory' ? '›' : ''}</span><span class="file-icon">${treeIcon(entry.type)}</span><span class="tree-name" data-full-name="${escapeHTML(entry.name)}" title="${escapeHTML(entry.name)}">${escapeHTML(entry.name)}</span>`;
      container.appendChild(row);
      row.addEventListener('contextmenu', (event) => showTreeMenu(event, entry));
      if (entry.type === 'file') row.addEventListener('click', () => openPath(entry.path));
      else {
        const children = document.createElement('div');
        children.className = 'tree-children';
        container.appendChild(children);
        row.addEventListener('click', async () => {
          const open = row.classList.toggle('expanded');
          row.querySelector('.chevron').textContent = open ? '⌄' : '›';
          row.setAttribute('aria-expanded', String(open));
          persistDirectoryExpansion(entry.path, open);
          if (open && !children.dataset.loaded) {
            children.dataset.loaded = 'true';
            await appendDirectory(children, entry.path);
          }
          scheduleTreeNameEllipses();
        });
        row.setAttribute('aria-expanded', 'false');
        if (expandedWorkspacePaths().has(entry.path)) {
          row.classList.add('expanded');
          row.setAttribute('aria-expanded', 'true');
          row.querySelector('.chevron').textContent = '⌄';
          children.dataset.loaded = 'true';
          await appendDirectory(children, entry.path);
        }
      }
    }
    scheduleTreeNameEllipses();
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
    const proceed = await confirmDialog({
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
    const roots = [];
    const stack = [];
    headings.forEach((heading, index) => {
      const node = {
        ...heading,
        index,
        key: `${heading.line}:${heading.level}:${heading.text}`,
        children: [],
      };
      while (stack.length && stack.at(-1).level >= node.level) stack.pop();
      if (stack.length) stack.at(-1).children.push(node);
      else roots.push(node);
      stack.push(node);
    });
    const appendNode = (node, container) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'outline-node';
      const row = document.createElement('div');
      row.className = 'outline-row';
      if (node.children.length) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'outline-toggle';
        toggle.setAttribute('aria-expanded', String(!tab.outlineCollapsed.has(node.key)));
        toggle.title = t(
          tab.outlineCollapsed.has(node.key) ? 'outline.expand' : 'outline.collapse',
        );
        toggle.textContent = tab.outlineCollapsed.has(node.key) ? '›' : '⌄';
        toggle.onclick = () => {
          const collapsed = wrapper.classList.toggle('collapsed');
          if (collapsed) tab.outlineCollapsed.add(node.key);
          else tab.outlineCollapsed.delete(node.key);
          toggle.setAttribute('aria-expanded', String(!collapsed));
          toggle.title = t(collapsed ? 'outline.expand' : 'outline.collapse');
          toggle.textContent = collapsed ? '›' : '⌄';
        };
        row.appendChild(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'outline-toggle-spacer';
        row.appendChild(spacer);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item';
      button.textContent = node.text;
      button.title = t('outline.line', { line: node.line + 1 });
      button.onclick = () => scrollToHeading(tab, node.index);
      row.appendChild(button);
      wrapper.appendChild(row);
      if (node.children.length) {
        const children = document.createElement('div');
        children.className = 'outline-children';
        node.children.forEach((child) => appendNode(child, children));
        wrapper.appendChild(children);
        wrapper.classList.toggle('collapsed', tab.outlineCollapsed.has(node.key));
      }
      container.appendChild(wrapper);
    };
    roots.forEach((node) => appendNode(node, target));
  }
  function scrollHeadingIntoEditor(editor, heading) {
    if (!editor || !heading || !editor.getClientRects().length) return;
    const innerScroller = VDITOR.innerScroller(heading);
    const scroller =
      [innerScroller, editor].find(
        (candidate) => candidate && candidate.scrollHeight > candidate.clientHeight + 1,
      ) || editor;
    const scrollerRect = scroller.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const top =
      scroller.scrollTop +
      headingRect.top -
      scrollerRect.top -
      Math.max(0, (scroller.clientHeight - headingRect.height) / 2);
    const destination = Math.max(0, top);
    const start = scroller.scrollTop;
    const distance = destination - start;
    const previousAnimation = scrollAnimations.get(scroller);
    if (previousAnimation) cancelAnimationFrame(previousAnimation);
    if (Math.abs(distance) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scroller.scrollTop = destination;
      return;
    }
    const duration = Math.min(240, Math.max(140, Math.abs(distance) * 0.16));
    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      scroller.scrollTop = start + distance * eased;
      if (progress < 1) scrollAnimations.set(scroller, requestAnimationFrame(step));
      else scrollAnimations.delete(scroller);
    };
    scrollAnimations.set(scroller, requestAnimationFrame(step));
  }
  function scrollToHeading(tab, headingIndex) {
    VDITOR.headingTargets(tab.host, headingIndex).forEach(({ editor, heading }) => {
      scrollHeadingIntoEditor(editor, heading);
    });
  }

  function setupDocumentAnchorNavigation(tab) {
    if (tab.host.dataset.anchorNavigation === 'true') return;
    tab.host.dataset.anchorNavigation = 'true';
    tab.host.addEventListener(
      'click',
      (event) => {
        const link = VDITOR.documentAnchor(event.target, tab.host);
        if (!link) return;
        const headingIndex = VDITOR.headingIndexForAnchor(tab.host, link.href);
        if (headingIndex < 0) return;
        event.preventDefault();
        event.stopPropagation();
        scrollToHeading(tab, headingIndex);
      },
      true,
    );
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
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (input.type === 'radio') input.checked = input.value === value;
      else if (value !== undefined) input.value = value;
    });
    syncCodeThemeSelect(
      isDarkTheme(document.documentElement.dataset.theme),
      state.settings.codeTheme,
    );
    const tab = activeTab();
    const currentMode = tab?.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab?.mode;
    $('#previewZoomSetting').classList.toggle('hidden', currentMode !== 'sv');
    $('#editorTextWidthValue').textContent = `${$('#editorTextWidth').value}%`;
    restoreSettingsCardSize();
    const modal = $('#settingsModal');
    clearTimeout(settingsCloseTimer);
    modal.classList.remove('hidden', 'modal-closing', 'modal-open');
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('modal-open')));
  }

  function closeSettings({ applyPresentation = true } = {}) {
    const modal = $('#settingsModal');
    if (modal.classList.contains('hidden')) return Promise.resolve();
    if (modal.classList.contains('modal-closing'))
      return new Promise((resolve) => setTimeout(resolve, 190));
    clearTimeout(settingsCloseTimer);
    modal.classList.remove('modal-open');
    modal.classList.add('modal-closing');
    const duration = parseFloat(
      getComputedStyle(modal).getPropertyValue('--settings-exit-duration'),
    );
    return new Promise((resolve) => {
      settingsCloseTimer = setTimeout(
        () => {
          modal.classList.add('hidden');
          modal.classList.remove('modal-closing');
          if (applyPresentation) applyPresentationSettings();
          resolve();
        },
        Number.isFinite(duration) ? duration + 30 : 190,
      );
    });
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
      if (input.type === 'radio' && !input.checked) return;
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
    patch.lastDarkTheme = isDarkTheme(patch.theme) ? patch.theme : darkThemePreference();
    const dark = patch.systemTheme
      ? isDarkTheme(document.documentElement.dataset.theme)
      : isDarkTheme(patch.theme);
    const codePreferenceKey = dark ? 'darkCodeTheme' : 'lightCodeTheme';
    patch.lightCodeTheme = state.settings.lightCodeTheme;
    patch.darkCodeTheme = state.settings.darkCodeTheme;
    patch[codePreferenceKey] = patch.codeTheme;
    patch.toolbarConfig = state.settings.toolbarConfig;
    state.settings = await window.appAPI.saveSettings(patch);
    if (closeAfterSave) await closeSettings({ applyPresentation: false });
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
    if (panel.dataset.settingsPanel === 'appearance') {
      state.settings.lastDarkTheme = state.defaultSettings.lastDarkTheme;
      state.settings.lightCodeTheme = state.defaultSettings.lightCodeTheme;
      state.settings.darkCodeTheme = state.defaultSettings.darkCodeTheme;
    }
    $$('[name]', panel).forEach((input) => {
      const value = state.defaultSettings[input.name];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (input.type === 'radio') input.checked = input.value === value;
      else if (value !== undefined) input.value = value;
    });
    if (panel.dataset.settingsPanel === 'editor')
      $('#editorTextWidthValue').textContent = `${$('#editorTextWidth').value}%`;
    if (panel.dataset.settingsPanel === 'appearance') {
      const theme = panel.querySelector('[name="theme"]:checked')?.value;
      syncCodeThemeSelect(isDarkTheme(theme), preferredCodeTheme(isDarkTheme(theme)));
    }
    await saveSettings(false);
  }

  function scheduleLiveSettingsSave(event) {
    const input = event.target;
    if (
      (input.type === 'number' || input.type === 'range') &&
      (!input.value || !input.validity.valid)
    )
      return;
    if (input.name === 'theme' && !$('#settingsForm [name="systemTheme"]').checked) {
      const dark = isDarkTheme(input.value);
      syncCodeThemeSelect(dark, preferredCodeTheme(dark));
    }
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(
      () => saveSettings(false),
      input.type === 'text' || input.type === 'number' ? 250 : 0,
    );
  }

  function settingsCardLimits() {
    const maxWidth = Math.max(1, Math.floor(window.innerWidth * 0.9));
    const maxHeight = Math.max(1, Math.floor(window.innerHeight * 0.9));
    return {
      minWidth: Math.min(620, maxWidth),
      minHeight: Math.min(420, maxHeight),
      maxWidth,
      maxHeight,
    };
  }

  function setSettingsCardBounds({ left, top, width, height }) {
    const card = $('.settings-card');
    const size = settingsCardLimits();
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const nextWidth = clamp(width, size.minWidth, size.maxWidth);
    const nextHeight = clamp(height, size.minHeight, size.maxHeight);
    const nextLeft = clamp(left, 0, Math.max(0, window.innerWidth - nextWidth));
    const nextTop = clamp(top, 0, Math.max(0, window.innerHeight - nextHeight));
    card.style.position = 'fixed';
    card.style.left = `${nextLeft}px`;
    card.style.top = `${nextTop}px`;
    card.style.width = `${nextWidth}px`;
    card.style.height = `${nextHeight}px`;
  }

  function settingsCardBounds() {
    const card = $('.settings-card');
    return {
      left: card.offsetLeft,
      top: card.offsetTop,
      width: card.offsetWidth,
      height: card.offsetHeight,
    };
  }

  function restoreSettingsCardSize() {
    const saved = state.settings.settingsDialogSize?.customized
      ? state.settings.settingsDialogSize
      : { width: 1080, height: 780 };
    const size = settingsCardLimits();
    const width = Math.min(size.maxWidth, Math.max(size.minWidth, Number(saved.width) || 1080));
    const height = Math.min(size.maxHeight, Math.max(size.minHeight, Number(saved.height) || 780));
    setSettingsCardBounds({
      left: Math.round((window.innerWidth - width) / 2),
      top: Math.round((window.innerHeight - height) / 2),
      width,
      height,
    });
  }

  function persistSettingsCardSize() {
    const { width, height } = settingsCardBounds();
    const settingsDialogSize = {
      width: Math.round(width),
      height: Math.round(height),
      customized: true,
    };
    state.settings.settingsDialogSize = settingsDialogSize;
    void window.appAPI.saveSettings({ settingsDialogSize });
  }

  function setupSettingsDrag() {
    const card = $('.settings-card');
    const header = card.querySelector(':scope > header');
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

    header.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const start = settingsCardBounds();
      setSettingsCardBounds(start);
      const offsetX = event.clientX - start.left;
      const offsetY = event.clientY - start.top;
      const move = (moveEvent) => {
        setSettingsCardBounds({
          left: moveEvent.clientX - offsetX,
          top: moveEvent.clientY - offsetY,
          width: start.width,
          height: start.height,
        });
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    $$('[data-settings-resize]', card).forEach((handle) => {
      handle.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const edge = handle.dataset.settingsResize;
        const start = settingsCardBounds();
        const right = start.left + start.width;
        const bottom = start.top + start.height;
        const startX = event.clientX;
        const startY = event.clientY;
        setSettingsCardBounds(start);
        document.body.classList.add('settings-card-resizing');
        const move = (moveEvent) => {
          const size = settingsCardLimits();
          const deltaX = moveEvent.clientX - startX;
          const deltaY = moveEvent.clientY - startY;
          const width = edge.includes('w')
            ? clamp(start.width - deltaX, size.minWidth, size.maxWidth)
            : edge.includes('e')
              ? clamp(start.width + deltaX, size.minWidth, size.maxWidth)
              : start.width;
          const height = edge.includes('n')
            ? clamp(start.height - deltaY, size.minHeight, size.maxHeight)
            : edge.includes('s')
              ? clamp(start.height + deltaY, size.minHeight, size.maxHeight)
              : start.height;
          setSettingsCardBounds({
            left: edge.includes('w') ? right - width : start.left,
            top: edge.includes('n') ? bottom - height : start.top,
            width,
            height,
          });
        };
        const up = () => {
          document.body.classList.remove('settings-card-resizing');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          persistSettingsCardSize();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
    });

    window.addEventListener('resize', () => {
      if (card.style.position === 'fixed') setSettingsCardBounds(settingsCardBounds());
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
      quit: () => window.appAPI.closeWindow(),
      'toggle-sidebar': toggleSidebar,
      settings: openSettings,
      'export-html': exportHTML,
      'export-pdf': exportPDF,
      about: () => {
        openSettings();
        $('.settings-nav [data-panel="about"]').click();
      },
      mode: () => {
        const tab = activeTab();
        if (tab && value !== tab.mode) {
          rebuildEditor(tab, value);
        }
        state.settings.editMode = value;
        window.appAPI.saveSettings({ editMode: value });
      },
      theme: async () => {
        state.settings.theme = value;
        state.settings.systemTheme = false;
        if (isDarkTheme(value)) state.settings.lastDarkTheme = value;
        await window.appAPI.saveSettings({
          theme: value,
          systemTheme: false,
          ...(isDarkTheme(value) ? { lastDarkTheme: value } : {}),
        });
        await applyTheme(value);
      },
    };
    if (handlers[action]) handlers[action]();
  }

  function setupAppMenus() {
    $$('.app-menu-popup').forEach((popup) => popup.remove());
    if (appMenuCloseHandler) document.removeEventListener('click', appMenuCloseHandler);
    if (appMenuBlurHandler) window.removeEventListener('blur', appMenuBlurHandler);
    $('#appMenuBar').dataset.ready = 'true';
    const run = (action, value) => () => handleMenu(action, value);
    const edit = (command) => () => {
      document.execCommand(command);
      activeTab()?.vditor?.focus();
    };
    const currentEditorMode = () => {
      const tab = activeTab();
      return tab?.vditor && tab.ready
        ? tab.vditor.getCurrentMode()
        : tab?.mode || state.settings.editMode;
    };
    const menus = {
      file: () => [
        ['menu.new', run('new'), 'Ctrl+N'],
        ['menu.open', run('open'), 'Ctrl+O'],
        ['menu.openFolder', run('open-folder')],
        null,
        ['menu.save', run('save'), 'Ctrl+S'],
        ['menu.saveAs', run('save-as'), 'Ctrl+Shift+S'],
        null,
        ['menu.exportHtml', run('export-html')],
        ['menu.exportPdf', run('export-pdf')],
        ...(state.tabs.length ? [null, ['menu.closeTab', run('close-tab'), 'Ctrl+W']] : []),
        null,
        ['menu.quit', run('quit'), 'Ctrl+Q'],
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
          label: 'menu.editMode',
          children: [
            [
              'menu.editModeWysiwyg',
              run('mode', 'wysiwyg'),
              '',
              () => currentEditorMode() === 'wysiwyg',
            ],
            ['menu.editModeIr', run('mode', 'ir'), '', () => currentEditorMode() === 'ir'],
            ['menu.editModeSv', run('mode', 'sv'), '', () => currentEditorMode() === 'sv'],
          ],
        },
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
    let reopenMenuOnHover = false;
    const close = () => {
      $$('.app-menu-popup').forEach((popup) => popup.remove());
      $$('.app-menu-bar button').forEach((b) => b.classList.remove('active'));
      $('#windowTitlebar').classList.remove('app-menu-open');
      reopenMenuOnHover = false;
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
            submenu.dataset.keepOpen = item.label === 'menu.layout' ? 'true' : 'false';
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
          button._appMenuItem = item;
          button.innerHTML = `<span><i class="checkmark">${checked === null ? '' : checked ? '✓' : ''}</i>${escapeHTML(t(item[0]))}</span><small>${escapeHTML(item[2] || '')}</small>`;
          button.onclick = (event) => {
            event.stopPropagation();
            item[1]();
            if (popup.dataset.keepOpen === 'true') {
              popup.querySelectorAll('button').forEach((menuButton) => {
                const menuItem = menuButton._appMenuItem;
                if (!menuItem?.[3]) return;
                const checkmark = menuButton.querySelector('.checkmark');
                if (checkmark) checkmark.textContent = menuItem[3]() ? '✓' : '';
              });
            } else {
              close();
            }
          };
        }
        popup.appendChild(button);
      });
      setupAutoHideScrollbar(popup);
    };
    const openMenu = (trigger) => {
      close();
      trigger.classList.add('active');
      $('#windowTitlebar').classList.add('app-menu-open');
      const popup = document.createElement('div');
      popup.className = 'app-menu-popup';
      const menu = menus[trigger.dataset.menu];
      fillPopup(popup, typeof menu === 'function' ? menu() : menu || []);
      document.body.appendChild(popup);
      const rect = trigger.getBoundingClientRect();
      popup.style.left = `${rect.left}px`;
      popup.style.top = `${rect.bottom}px`;
    };
    $$('.app-menu-bar > button[data-menu]').forEach((trigger) => {
      trigger.onclick = (event) => {
        event.stopPropagation();
        if (trigger.classList.contains('active')) close();
        else openMenu(trigger);
      };
      trigger.onmouseenter = () => {
        const active = $('.app-menu-bar > button.active');
        if (reopenMenuOnHover || (active && active !== trigger)) {
          reopenMenuOnHover = false;
          openMenu(trigger);
        }
      };
    });
    $('#toggleSidebar').onmouseenter = () => {
      if ($('.app-menu-bar > button.active')) {
        close();
        reopenMenuOnHover = true;
      }
    };
    appMenuCloseHandler = close;
    document.addEventListener('click', appMenuCloseHandler);
    appMenuBlurHandler = () => {
      if ($('.app-menu-popup')) close();
    };
    window.addEventListener('blur', appMenuBlurHandler);
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
    $('#toggleSidebar')?.setAttribute('aria-pressed', String(visible));
    window.appAPI.saveSettings({ sidebarVisible: visible });
  }

  function setupEvents() {
    setupAppMenus();
    window.appAPI.onOpenFiles((paths) => void openPaths(paths));
    $('#windowMinimize').onclick = () => window.appAPI.minimize();
    $('#windowMaximize').onclick = () => window.appAPI.maximize();
    $('#windowClose').onclick = () => window.appAPI.closeWindow();
    $('#windowTitle').onclick = () => appMenuCloseHandler?.();
    $('#confirmModal').onclick = (event) => {
      if (event.target === $('#confirmModal')) closeConfirmDialog('cancel');
    };
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
    $('#statusSettings').onclick = openSettings;
    $('#statusThemeToggle').onchange = async (event) => {
      const theme = event.target.checked ? darkThemePreference() : 'classic';
      state.settings.theme = theme;
      state.settings.systemTheme = false;
      await window.appAPI.saveSettings({
        theme,
        systemTheme: false,
        ...(isDarkTheme(theme) ? { lastDarkTheme: theme } : {}),
      });
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
          else scheduleTreeNameEllipses();
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
          $('#resetSettingsPage').classList.toggle('hidden', button.dataset.panel === 'about');
        }),
    );
    $$('[data-close]').forEach((button) => {
      button.onclick = () => {
        if (button.dataset.close === 'settingsModal') closeSettings();
        else $(`#${button.dataset.close}`).classList.add('hidden');
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
      if (await confirmDialog({ message: t('confirm.resetSettings') })) {
        state.settings = await window.appAPI.resetSettings();
        applyLocale(state.settings.locale);
        openSettings();
      }
    };
    setupSettingsDrag();
    $('#openSettingsFolder').onclick = async () =>
      window.appAPI.showItemInFolder(await window.appAPI.getSettingsPath());
    $$('[data-external]').forEach((button) => {
      button.onclick = () => window.appAPI.openExternal(button.dataset.external);
    });
    document.addEventListener('click', () => $('#contextMenu').classList.add('hidden'));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('#confirmModal').classList.contains('hidden')) {
        event.preventDefault();
        closeConfirmDialog('cancel');
        return;
      }
      if (event.key === 'Alt' && $('#app').classList.contains('fullscreen')) {
        event.preventDefault();
        $('#app').classList.toggle('fullscreen-menu-visible');
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
      } else if (key === 'q') {
        event.preventDefault();
        window.appAPI.closeWindow();
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
        scheduleTreeNameEllipses();
      }
    });
    window.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        document.body.classList.remove('resizing');
        window.appAPI.saveSettings({ sidebarWidth: state.settings.sidebarWidth });
      }
    });
    new ResizeObserver(scheduleTreeNameEllipses).observe($('#sidebar'));
    setupAutoHideScrollbar($('#fileTree'));
    setupAutoHideScrollbar($('#outlineTree'));
    setupAutoHideScrollbar($('#settingsForm'));
    setupAutoHideScrollbar($('#tabBar'));
    setupAutoHideScrollbar($('.confirm-content'));
    window.appAPI.onMenuAction(handleMenu);
    window.appAPI.onSystemThemeChanged((theme) => {
      if (state.settings.systemTheme) void applyTheme(mapSystemTheme(theme));
    });
    window.appAPI.onFullscreenChanged((fullscreen) => {
      $('#app').classList.toggle('fullscreen', fullscreen);
      if (!fullscreen) $('#app').classList.remove('fullscreen-menu-visible');
      state.tabs.forEach((tab) => scheduleSplitLineNumbers(tab));
    });
    window.appAPI.onMaximizedChanged((maximized) => {
      updateMaximizedState(maximized);
    });
    window.fileAPI.onChanged(handleExternalChange);
    window.appAPI.onRequestClose(async () => {
      const dirty = state.tabs.filter((tab) => tab.modified);
      if (!dirty.length) {
        window.appAPI.closeConfirmed();
        return;
      }
      const action = await showUnsavedDialog(
        t('confirm.quitDirty', { count: dirty.length }),
        dirty.map((tab) => `• ${tab.title}`).join('\n'),
      );
      if (action === 'cancel') return;
      if (action === 'save') {
        for (const tab of dirty) {
          if (!(await saveTab(tab))) return;
        }
      }
      window.appAPI.closeConfirmed();
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
    if (typeof Vditor === 'undefined' || !VDITOR || !window.fileAPI || !window.appAPI) {
      document.body.innerHTML =
        '<div class="fatal"><h1>应用资源加载失败</h1><p>请重新运行 npm run build。</p></div>';
      return;
    }
    document.body.dataset.platform = window.appAPI.platform;
    state.settings = await window.appAPI.getSettings();
    state.defaultSettings = await window.appAPI.getDefaultSettings();
    applyLocale(state.settings.locale);
    setupEvents();
    $('#sidebar').style.width = `${state.settings.sidebarWidth}px`;
    toggleSidebar(state.settings.sidebarVisible);
    $('#app').classList.toggle('fullscreen', await window.appAPI.isFullscreen());
    updateMaximizedState(await window.appAPI.isMaximized());
    applyPresentationSettings();
    await applyTheme(await resolveTheme());
    $('#settingsPath').textContent = await window.appAPI.getSettingsDisplayPath();
    const info = await window.appAPI.getInfo();
    $('#statusVersion').textContent = `v${info.app}`;
    $('#versionInfo').textContent = `Version ${info.app} · Electron ${info.electron}`;
    if (info.commitShort) {
      $('#commitSeparator').classList.remove('hidden');
      const commit = $('#commitInfo');
      commit.textContent = info.commitShort;
      commit.title = info.commitTag ? `${info.commitTag} · ${info.commit}` : info.commit;
      commit.dataset.external = info.commitUrl;
      commit.classList.remove('hidden');
    }
    const session = state.settings.session;
    if (state.settings.restoreWorkspace && session?.workspacePath)
      await setWorkspace(session.workspacePath);
    if (state.settings.restoreTabs && session?.openFiles?.length) {
      await openPaths(session.openFiles);
      const active = state.tabs.find((tab) => tab.filePath === session.activeFilePath);
      if (active) switchTab(active.id);
    }
    if (!state.tabs.length) updateActiveUI();
    window.appAPI.rendererReady();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
