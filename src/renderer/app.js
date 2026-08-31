(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const VDITOR = window.VditorDesktopAdapter;
  const state = {
    tabs: [],
    activeId: null,
    toolbarPreview: null,
    workspace: '',
    settings: null,
    defaultSettings: null,
    locale: 'en_US',
    untitledCounters: {
      file: 0,
      directory: 0,
    },
    treeTimer: null,
    workspaceRevision: 0,
    toolbarWrapHeight: 0,
  };
  const saveOperationsByIdentity = new Map();
  let resourceRootsQueue = Promise.resolve();
  let settingsSaveQueue = Promise.resolve();
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
  // Vditor 3.11.3 exposes public setters only for themes and preview mode.
  // Keep this list limited to settings that are passed to its constructor and
  // have no safe runtime setter; rebuilding clears Vditor's undo stack.
  const VDITOR_INITIALIZATION_SETTINGS = new Set([
    'iconSet',
    'locale',
    'placeholder',
    'typewriterMode',
    'tabInsertSpaces',
    'tabSize',
    'rtl',
    'toolbarItems',
    'previewDelay',
    'previewMaxWidth',
    'multiPlatformPreview',
    'mathEngine',
    'enableHighlight',
    'lineNumbers',
    'enableAutoSpace',
    'enableCallout',
    'enableFootnotes',
    'enableImageCaption',
    'enableMark',
    'enableSub',
    'enableSup',
    'paragraphBeginningSpace',
    'fixTermTypo',
    'gfmAutoLink',
    'toc',
    'listStyle',
    'sanitize',
  ]);
  let messageTimer;
  let temporaryDocumentNoticeTimer;
  let appMenuCloseHandler;
  let closeAppMenu = () => {};
  let appMenuBlurHandler;
  let settingsSaveTimer;
  let settingsCloseTimer;
  let sidebarTransitionTimer;
  let sidebarTransitionEndHandler;
  let confirmResolver;
  let treeNameFrame;
  let treeNameMeasureContext;
  let findMatches = [];
  let findIndex = -1;
  let findQuery = '';
  let findRefreshTimer;
  let draggedTabId = null;
  let tabDragPointerId = null;
  let tabDragGhost = null;
  let tabDragMoved = false;
  let hoveredDocumentLink = null;
  let hoveredSidebarTooltip = null;
  let editorSelectionActive = false;
  let pendingTableCellSelection = null;
  let contextMenuState = null;
  const THEME_MODES = ['light', 'dark', 'system'];
  const IPC_ERROR_MESSAGE_KEYS = {
    IPC_INVALID_ARGUMENT: 'message.ipcInvalidRequest',
    IPC_PERMISSION_DENIED: 'message.ipcPermissionDenied',
    IPC_ALREADY_EXISTS: 'message.ipcAlreadyExists',
    IPC_NOT_FOUND: 'message.ipcNotFound',
    IPC_INVALID_NAME: 'message.ipcInvalidName',
    IPC_SETTINGS_PERSIST_FAILED: 'message.ipcSettingsSaveFailed',
    IPC_OPERATION_FAILED: 'message.ipcOperationFailed',
  };

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

  function ipcErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = Object.keys(IPC_ERROR_MESSAGE_KEYS).find((candidate) =>
      message.includes(candidate),
    );
    return code ? t(IPC_ERROR_MESSAGE_KEYS[code]) : message;
  }

  function updateMainMenuGlow(event) {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    button.style.setProperty('--button-glow-x', `${event.clientX - rect.left}px`);
    button.style.setProperty('--button-glow-y', `${event.clientY - rect.top}px`);
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
    setConfirmDialogDraggable(false);
    $('#confirmModal').classList.add('hidden');
    $('#confirmActions').replaceChildren();
    resolve(action);
  }

  function setConfirmDialogDraggable(draggable) {
    const card = $('#confirmModal .confirm-card');
    card.classList.toggle('confirm-card-draggable', draggable);
    card.style.removeProperty('position');
    card.style.removeProperty('left');
    card.style.removeProperty('top');
  }

  function showConfirmDialog({ title, message, detail = '', actions, draggable = false } = {}) {
    if (confirmResolver) closeConfirmDialog('cancel');
    const modal = $('#confirmModal');
    setConfirmDialogDraggable(draggable);
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
      draggable: true,
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
    $$('[data-i18n-tooltip]').forEach((node) => {
      const value = t(node.dataset.i18nTooltip);
      node.dataset.tooltip = value;
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
      $('#workspaceHeading').dataset.tooltip = state.workspace;
    }
    if ($('#appMenuBar')?.dataset.ready === 'true') setupAppMenus();
    renderTabs();
    updateActiveUI();
    renderOutline();
  }

  function uid() {
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }
  function recoveryId() {
    return globalThis.crypto?.randomUUID?.() || uid();
  }
  function activeTab() {
    return state.tabs.find((tab) => tab.id === state.activeId) || null;
  }

  function syncToolbarAvailability() {
    const app = $('#app');
    const mount = $('#vditorToolbarMount');
    if (!app || !mount) return;
    const owner = activeTab() || state.toolbarPreview;
    const available = Boolean(
      owner?.ready && owner.toolbar && owner.toolbar.parentElement === mount,
    );
    // Vditor inserts its toolbar into the editor host before invoking after().
    // Keep a non-interactive Desktop skeleton in the shared row until Desktop
    // owns that node, so the editor geometry never jumps during the hand-off.
    app.classList.toggle('toolbar-unavailable', !available);
    mount.dataset.toolbarPending = String(!available);
    mount.setAttribute('aria-busy', String(!available));
    syncToolbarWrapHeight();
  }

  function destroyToolbarPreview() {
    const preview = state.toolbarPreview;
    if (!preview) return;
    restoreEditorToolbar(preview);
    try {
      preview.vditor?.destroy();
    } catch (_) {}
    preview.host.remove();
    state.toolbarPreview = null;
    syncToolbarAvailability();
  }

  function createToolbarPreview() {
    if (state.tabs.length || state.toolbarPreview) return;
    const host = document.createElement('section');
    host.className = 'editor-host toolbar-preview';
    const preview = {
      id: 'toolbar-preview',
      filePath: null,
      title: '',
      content: '',
      savedContent: '',
      encoding: 'utf-8',
      lineEnding: 'LF',
      baseDir: '',
      modified: false,
      expectedSavedContent: '',
      mode: state.settings.editMode,
      vditor: null,
      ready: false,
      toolbar: null,
      toolbarPreview: true,
      host,
    };
    state.toolbarPreview = preview;
    $('#editorArea').appendChild(host);
    ensureEditor(preview);
  }

  function disableToolbarPreview(preview) {
    preview.vditor?.disabled();
    preview.toolbar?.querySelectorAll('button, input').forEach((control) => {
      control.disabled = true;
      control.tabIndex = -1;
    });
  }

  function selectEditorContextOrAll(event) {
    if (event.altKey || event.key.toLowerCase() !== 'a') return false;
    const tab = activeTab();
    const mode = tab?.vditor?.getCurrentMode();
    const editorTarget = VDITOR.isEditableTarget(tab?.host, mode, event.target)
      ? event.target
      : document.activeElement;
    if (
      !editorSelectionActive ||
      !tab?.ready ||
      !mode ||
      !VDITOR.isEditableTarget(tab.host, mode, editorTarget)
    )
      return false;
    const selection = VDITOR.selectCurrentContextOrAll(tab.host, mode);
    if (!selection) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  function selectedTableCellForBackspace(event) {
    if (
      event.key !== 'Backspace' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return false;
    const tab = activeTab();
    const mode = tab?.vditor?.getCurrentMode();
    if (!tab?.ready || !mode || !VDITOR.isEditableTarget(tab.host, mode, event.target))
      return false;
    return VDITOR.selectedTableCell(tab.host, mode);
  }

  function updateEditorSelectionActivity(target, preserveEditorHost = false) {
    const tab = activeTab();
    const mode = tab?.vditor?.getCurrentMode();
    if (tab?.ready && mode && VDITOR.isEditableTarget(tab.host, mode, target)) {
      editorSelectionActive = true;
      return;
    }
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    if (preserveEditorHost && element && tab?.host.contains(element)) return;
    editorSelectionActive = false;
  }

  function keepsNativeSelectAll(target) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    if (!element) return false;
    const tab = activeTab();
    const mode = tab?.vditor?.getCurrentMode();
    if (tab?.ready && mode && VDITOR.isEditableTarget(tab.host, mode, element)) return false;
    return Boolean(element.closest('input,textarea,select') || element.isContentEditable);
  }

  function escapeHTML(value) {
    const node = document.createElement('div');
    node.textContent = String(value);
    return node.innerHTML;
  }
  function fileName(filePath) {
    return filePath ? filePath.replace(/\\/g, '/').split('/').pop() : '';
  }
  function normalizedFilePath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return window.appAPI.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
  }
  function tabTargetPath(tab) {
    if (tab.filePath) return tab.filePath;
    return state.workspace ? `${state.workspace.replace(/[\\/]$/, '')}/${tab.title}.md` : '';
  }
  function tabFileIdentity(tab) {
    return tab?.fileIdentity || normalizedFilePath(tab?.filePath);
  }
  async function watchTabDocument(tab) {
    if (!tab?.filePath) return;
    tab.fileIdentity = await window.fileAPI.fileIdentity(tab.filePath);
    await window.fileAPI.watchDocument(tab.filePath, true);
  }
  async function releaseDocumentWatch(filePath, identity) {
    if (!filePath) return;
    const fileIdentity = identity || (await window.fileAPI.fileIdentity(filePath));
    const stillOpen = state.tabs.some((tab) => tabFileIdentity(tab) === fileIdentity);
    if (!stillOpen) await window.fileAPI.unwatchDocument(filePath, fileIdentity);
  }
  async function suspendDocumentWatches(tabs) {
    const affectedPaths = new Set(
      tabs.filter((tab) => tab.filePath).map((tab) => tabFileIdentity(tab)),
    );
    const paths = new Map();
    for (const tab of tabs) {
      if (tab.filePath) paths.set(tabFileIdentity(tab), tab.filePath);
    }
    for (const [identity, filePath] of paths) {
      const openOutsideAffected = state.tabs.some(
        (tab) => !tabs.includes(tab) && tabFileIdentity(tab) === identity,
      );
      if (!openOutsideAffected && affectedPaths.has(identity))
        await window.fileAPI.unwatchDocument(filePath, identity);
    }
  }
  async function rebindDocumentWatches(tabs) {
    const tabsByIdentity = new Map();
    for (const tab of tabs) {
      if (tab.filePath) tabsByIdentity.set(tabFileIdentity(tab), tab);
    }
    let pending = [...tabsByIdentity.values()];
    let failures = [];
    for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
      failures = [];
      for (const tab of pending) {
        try {
          await watchTabDocument(tab);
        } catch (error) {
          failures.push({ tab, error });
        }
      }
      pending = failures.map(({ tab }) => tab);
    }
    if (failures.length)
      throw new AggregateError(
        failures.map(({ error }) => error),
        `Unable to restore ${failures.length} document watcher(s).`,
      );
  }

  function rebuildRenamedEditors(pendingTabs) {
    const failures = [];
    for (const tab of [...pendingTabs]) {
      try {
        const failure = rebuildEditor(tab);
        if (failure) throw failure;
        pendingTabs.delete(tab);
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }
  async function rebaseOpenTabs(oldRoot, newRoot) {
    const updates = [];
    for (const tab of state.tabs) {
      if (!tab.filePath) continue;
      const nextPath = await window.fileAPI.rebasePath(oldRoot, newRoot, tab.filePath);
      if (nextPath) updates.push({ tab, nextPath });
    }
    return updates;
  }
  async function rebasePathState(oldRoot, newRoot) {
    const recentFiles = [];
    for (const item of state.settings.recentFiles || []) {
      const nextPath = await window.fileAPI.rebasePath(oldRoot, newRoot, item.path);
      recentFiles.push(nextPath ? { ...item, path: nextPath, title: fileName(nextPath) } : item);
    }
    const workspaceTreeStates = [];
    for (const item of state.settings.workspaceTreeStates || []) {
      const workspacePath = await window.fileAPI.rebasePath(oldRoot, newRoot, item.workspacePath);
      const expandedPaths = [];
      for (const expandedPath of item.expandedPaths || []) {
        const nextPath = await window.fileAPI.rebasePath(oldRoot, newRoot, expandedPath);
        expandedPaths.push(nextPath || expandedPath);
      }
      workspaceTreeStates.push({
        ...item,
        workspacePath: workspacePath || item.workspacePath,
        expandedPaths,
      });
    }
    return { recentFiles, workspaceTreeStates };
  }
  function stripExtension(name) {
    return name.replace(/\.(md|markdown)$/i, '');
  }
  function detectLineEnding(content) {
    return /\r\n/.test(content) ? 'CRLF' : 'LF';
  }
  function collectLocalResourceRoots(extraRoots = []) {
    const roots = new Set();
    if (state.workspace) roots.add(state.workspace);
    state.tabs.forEach((tab) => {
      if (tab.baseDir) roots.add(tab.baseDir);
    });
    extraRoots.forEach((root) => {
      if (root) roots.add(root);
    });
    return [...roots];
  }
  function syncLocalResourceRoots(extraRoots = []) {
    // Compute roots when the queued IPC operation runs so overlapping lifecycle events
    // cannot restore a stale tab/workspace snapshot after a newer state transition.
    const operation = resourceRootsQueue
      .catch(() => undefined)
      .then(() => window.fileAPI.setResourceRoots(collectLocalResourceRoots(extraRoots)));
    resourceRootsQueue = operation.catch((error) => {
      console.error('Unable to synchronize local resource roots.', error);
    });
    return operation;
  }
  function localResourceBase(baseDir) {
    if (!baseDir) return '';
    const nativePath = window.appAPI.platform === 'win32' ? baseDir.replace(/\\/g, '/') : baseDir;
    if (window.appAPI.platform !== 'win32' && nativePath.includes('\\')) return '';
    const encodedPath = nativePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `local-file://root/${encodedPath.endsWith('/') ? encodedPath : `${encodedPath}/`}`;
  }
  function treeIcon(entry) {
    const icon = entry.type === 'directory' ? (entry.link ? 'folder-symlink' : 'folder') : 'file';
    return `<span class="tree-entry-icon tree-entry-icon-${icon}" aria-hidden="true"></span>`;
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
      const fullName = name.dataset.fullName || '';
      name.textContent = fullName;
      if (!name.clientWidth) return;
      name.textContent = middleEllipsis(fullName, name.clientWidth, getComputedStyle(name));
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

  function showTemporaryDocumentNotice(message, error = false) {
    const notice = $('#temporaryDocumentNotice');
    $('#temporaryDocumentNoticeMessage').textContent = message;
    notice.classList.toggle('error', error);
    notice.classList.remove('hidden');
    clearTimeout(temporaryDocumentNoticeTimer);
    temporaryDocumentNoticeTimer = setTimeout(() => {
      notice.classList.add('hidden');
      notice.classList.remove('error');
    }, 5000);
  }

  function findWidgetVisible() {
    return !$('#findWidget').classList.contains('hidden');
  }

  function collectFindMatches(content, query) {
    if (!query) return [];
    const matches = [];
    const haystack = content.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let offset = 0;
    while (offset <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, offset);
      if (start < 0) break;
      matches.push({ start, end: start + query.length });
      offset = start + Math.max(query.length, 1);
    }
    return matches;
  }

  function revealFindMatch() {
    const tab = activeTab();
    const query = $('#findInput').value;
    if (!tab?.vditor || findIndex < 0 || !query) return;
    const mode = tab.vditor.getCurrentMode();
    VDITOR.revealTextMatch(tab.host, mode, query, findIndex);
    const highlightIndex = findIndex;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (
          activeTab() !== tab ||
          $('#findInput').value !== query ||
          findIndex !== highlightIndex ||
          !findWidgetVisible()
        )
          return;
        VDITOR.highlightTextMatches(
          tab.host,
          tab.vditor?.getCurrentMode() || mode,
          query,
          findIndex,
        );
      });
    });
  }

  function refreshFind({ preserveIndex = true, reveal = true, content, index } = {}) {
    const tab = activeTab();
    const query = $('#findInput').value;
    findQuery = query;
    const previousIndex = findIndex;
    findMatches = tab ? collectFindMatches(content ?? tab.content, query) : [];
    if (!findMatches.length) findIndex = -1;
    else if (typeof index === 'number') findIndex = Math.min(index, findMatches.length - 1);
    else if (preserveIndex && previousIndex >= 0)
      findIndex = Math.min(previousIndex, findMatches.length - 1);
    else findIndex = 0;
    $('#findCount').textContent = `${findIndex < 0 ? 0 : findIndex + 1} / ${findMatches.length}`;
    if (reveal) revealFindMatch();
  }

  function moveFindMatch(direction) {
    if (!findMatches.length) return;
    findIndex = (findIndex + direction + findMatches.length) % findMatches.length;
    $('#findCount').textContent = `${findIndex + 1} / ${findMatches.length}`;
    revealFindMatch();
  }

  function openFind() {
    if (!activeTab()) return;
    const selection = window.getSelection()?.toString() || '';
    const input = $('#findInput');
    $('#findWidget').classList.remove('hidden');
    if (!findWidgetVisible()) return;
    if (selection && !selection.includes('\n')) input.value = selection;
    refreshFind({ preserveIndex: false, reveal: false });
    input.focus();
    input.select();
  }

  function closeFind() {
    clearTimeout(findRefreshTimer);
    const tab = activeTab();
    const query = $('#findInput').value;
    if (tab?.vditor && findIndex >= 0 && query) {
      VDITOR.selectTextMatch(tab.host, tab.vditor.getCurrentMode(), query, findIndex);
    }
    $('#findWidget').classList.add('hidden');
    VDITOR.clearFindHighlights();
    tab?.vditor?.focus();
  }

  function toggleReplace() {
    const expanded = $('#replaceRow').classList.toggle('hidden') === false;
    $('#findToggleReplace').setAttribute('aria-expanded', String(expanded));
    if (expanded) $('#replaceInput').focus();
  }

  function applyFindContent(tab, content) {
    tab.pendingEditorContent = true;
    tab.vditor?.setValue(content);
    onEditorInput(tab, content);
  }

  function replaceFindMatch() {
    const tab = activeTab();
    const match = findMatches[findIndex];
    if (!tab || !match) return;
    const replacedIndex = findIndex;
    const content = tab.content;
    const replacement = $('#replaceInput').value;
    const nextContent = `${content.slice(0, match.start)}${replacement}${content.slice(match.end)}`;
    applyFindContent(tab, nextContent);
    refreshFind({ content: nextContent, index: replacedIndex });
  }

  function replaceAllFindMatches() {
    const tab = activeTab();
    if (!tab || !findMatches.length) return;
    const content = tab.content;
    const replacement = $('#replaceInput').value;
    let nextContent = content;
    for (let index = findMatches.length - 1; index >= 0; index -= 1) {
      const match = findMatches[index];
      nextContent = `${nextContent.slice(0, match.start)}${replacement}${nextContent.slice(match.end)}`;
    }
    applyFindContent(tab, nextContent);
    refreshFind({ preserveIndex: false, content: nextContent });
  }

  function isDarkTheme(theme) {
    return theme === 'dark' || theme === 'claude-dark' || theme === 'monokai-pro-dark';
  }

  function darkThemePreference() {
    return ['dark', 'claude-dark', 'monokai-pro-dark'].includes(state.settings.darkTheme)
      ? state.settings.darkTheme
      : 'dark';
  }

  function lightThemePreference() {
    return ['classic', 'claude-light', 'monokai-pro-light'].includes(state.settings.lightTheme)
      ? state.settings.lightTheme
      : 'classic';
  }

  function mapSystemTheme(theme) {
    return theme === 'dark' ? darkThemePreference() : lightThemePreference();
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
    syncThemeModeControl();
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
    if (Object.keys(settingsPatch).length) await queueSettingsSave(settingsPatch);
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

  function applyLiveVditorSettings(changedSettings) {
    if (!changedSettings.includes('previewMode')) return;
    state.tabs.forEach((tab) => {
      if (!tab.vditor || !tab.ready) return;
      tab.vditor.setPreviewMode(state.settings.previewMode);
    });
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
    if (tab.lineScrollSource && tab.lineScrollHandler)
      tab.lineScrollSource.removeEventListener('scroll', tab.lineScrollHandler);
    if (tab.lineNumberFrame) cancelAnimationFrame(tab.lineNumberFrame);
    if (tab.whitespaceFrame) cancelAnimationFrame(tab.whitespaceFrame);
    tab.lineObserver = null;
    tab.lineResizeObserver = null;
    tab.lineScrollSource = null;
    tab.lineScrollHandler = null;
    tab.lineNumberFrame = null;
    tab.whitespaceFrame = null;
  }

  function updateEditorBottomSpacer(tab) {
    if (!tab?.host) return;
    VDITOR.setEditorBottomSpacer(tab.host, tab.host.clientHeight / 2);
  }

  function observeEditorBottomSpacer(tab) {
    tab.bottomSpacerObserver?.disconnect();
    updateEditorBottomSpacer(tab);
    if (typeof ResizeObserver !== 'function') return;
    tab.bottomSpacerObserver = new ResizeObserver(() => updateEditorBottomSpacer(tab));
    tab.bottomSpacerObserver.observe(tab.host);
  }

  function disconnectEditorBottomSpacer(tab) {
    tab.bottomSpacerObserver?.disconnect();
    tab.bottomSpacerObserver = null;
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
          queueSettingsSave({ splitRatio: state.settings.splitRatio });
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
    }
    if (tab.lineScrollSource !== sv) {
      if (tab.lineScrollSource && tab.lineScrollHandler)
        tab.lineScrollSource.removeEventListener('scroll', tab.lineScrollHandler);
      tab.lineScrollSource = sv;
      tab.lineScrollHandler = () => {
        const currentContent = VDITOR.editorParts(tab.host).content;
        const currentGutter = currentContent?.querySelector(':scope > .sv-line-numbers');
        const lineNumberCanvas = currentGutter?.querySelector(':scope > .sv-line-number-canvas');
        if (lineNumberCanvas && !lineNumberCanvas.classList.contains('scroll-linked'))
          lineNumberCanvas.style.transform = `translateY(${-sv.scrollTop}px)`;
        const canvas = currentContent?.querySelector('.sv-whitespace-canvas');
        if (canvas) {
          const renderedScrollTop = Number(canvas.dataset.scrollTop || 0);
          canvas.style.transform = `translateY(${renderedScrollTop - sv.scrollTop}px)`;
        }
        scheduleWhitespaceMarkers(tab, sv);
      };
      sv.addEventListener('scroll', tab.lineScrollHandler);
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

    const style = getComputedStyle(sv);
    const lineHeight =
      Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    const svRect = sv.getBoundingClientRect();
    // Vditor can represent several textual source lines inside one private
    // newline marker (notably table and HTML syntax). Measure the actual
    // source text lines, otherwise positions after the final marker are only
    // guessed and spill into the editor's trailing spacer.
    const sourceLines = VDITOR.sourceLineRanges(sv);
    if (!sourceLines.length) {
      const range = document.createRange();
      range.selectNodeContents(sv);
      sourceLines.push({ range, fallbackRange: range.cloneRange() });
    }
    const positions = [];
    for (let index = 0; index < sourceLines.length; index += 1) {
      const { range, fallbackRange } = sourceLines[index];
      // Raw HTML markers and wrapped source lines can return client rects in
      // an order that ends at the newline marker. The line number belongs at
      // the visually topmost rect of the logical source line.
      const rect = Array.from(range.getClientRects())
        .filter((item) => item.height > 0)
        .reduce((topmost, item) => (!topmost || item.top < topmost.top ? item : topmost), null);
      const fallbackRect = fallbackRange.getBoundingClientRect();
      // Empty source lines have a zero-sized fallback range. It is not a
      // layout position: treating it as one places every such line at the
      // top of the gutter after the scroll-linked transform is applied.
      const measuredRect = rect || (fallbackRect.height > 0 ? fallbackRect : null);
      const measuredTop = measuredRect
        ? measuredRect.top - svRect.top + sv.scrollTop + (measuredRect.height - lineHeight) / 2
        : index === 0
          ? Number.parseFloat(style.paddingTop) || 0
          : positions[index - 1] + lineHeight;
      positions.push(measuredTop);
    }

    const canvas = document.createElement('div');
    canvas.className = 'sv-line-number-canvas';
    // Match SV's complete scroll range so source lines and gutter stay aligned.
    // Only actual Markdown lines receive spans; the trailing editor spacer is
    // therefore an empty, unnumbered part of this canvas.
    canvas.style.height = `${Math.max(sv.scrollHeight, (positions.at(-1) || 0) + lineHeight)}px`;
    const scrollRange = Math.max(0, sv.scrollHeight - sv.clientHeight);
    // Keep the gutter on the source element's compositor scroll timeline when
    // Chromium supports it. The scroll-event transform remains a fallback for
    // older engines, but it trails a compositor scroll by one visual frame.
    const scrollLinked = CSS.supports?.('animation-timeline: scroll()');
    canvas.classList.toggle('scroll-linked', Boolean(scrollLinked));
    canvas.style.setProperty('--sv-scroll-range', `${scrollRange}px`);
    if (!scrollLinked) canvas.style.transform = `translateY(${-sv.scrollTop}px)`;
    positions.forEach((top, index) => {
      const number = document.createElement('span');
      number.className = 'sv-line-number';
      number.style.top = `${top}px`;
      number.textContent = String(index + 1);
      canvas.appendChild(number);
    });
    gutter.replaceChildren(canvas);
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

  function setupTabWheelScrolling(tabBar) {
    tabBar.addEventListener(
      'wheel',
      (event) => {
        if (tabBar.scrollWidth <= tabBar.clientWidth) return;
        const rawDelta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!rawDelta) return;
        const delta =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? rawDelta * 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? rawDelta * tabBar.clientWidth
              : rawDelta;
        const maximumLeft = Math.max(0, tabBar.scrollWidth - tabBar.clientWidth);
        const nextLeft = Math.min(maximumLeft, Math.max(0, tabBar.scrollLeft + delta));
        if (nextLeft === tabBar.scrollLeft) return;
        event.preventDefault();
        tabBar.scrollLeft = nextLeft;
      },
      { passive: false },
    );
  }

  function effectiveToolbarItems(toolbarItems) {
    const configured = toolbarItems?.length ? toolbarItems : DEFAULT_TOOLBAR;
    // Vditor 3.11.3 mode transitions still address this internal toolbar item.
    return configured.includes('outline') ? configured : [...configured, 'outline'];
  }

  function editorOptions(tab) {
    const s = state.settings;
    const wasModified = tab.modified;
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
      toolbar: effectiveToolbarItems(s.toolbarItems),
      // The Vditor toolbar is mounted into the application toolbar. Its visibility
      // is controlled as one layout part from View > Layout.
      toolbarConfig: { hide: false, pin: false },
      // Desktop owns the single outline experience in the application sidebar.
      outline: { enable: false, position: 'left' },
      // Application-level capture owns modifier-click navigation. Normal clicks
      // must still reach Vditor so IR can place its caret and expand link Markdown.
      link: { isOpen: false },
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
          // Resolve Markdown-relative resources before Vditor inserts their DOM nodes.
          // Doing this in the adapter observer is too late to prevent an initial app:// request.
          linkBase: localResourceBase(tab.baseDir),
          listStyle: s.listStyle,
          sanitize: s.sanitize,
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
          tab.host.dataset.editorReady = 'false';
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
        tab.outlineObserver?.disconnect();
        tab.outlineObserver = VDITOR.observeOutlineChanges(tab.host, () => {
          if (tab.id === state.activeId) scheduleOutline();
        });
        setupDocumentAnchorNavigation(tab);
        VDITOR.scrollContainers(tab.host).forEach(setupAutoHideScrollbar);
        tab.tableCompositionScrollCleanup?.();
        tab.tableCompositionScrollCleanup = VDITOR.preserveTableScrollDuringInput(
          tab.host,
          () => tab.vditor?.getCurrentMode() || tab.mode,
        );
        const pendingEditorContent = tab.pendingEditorContent;
        const pendingSavedContent = tab.savedContent;
        const pendingModified = tab.modified;
        if (pendingEditorContent) {
          tab.vditor.setValue(tab.content, true);
          tab.pendingEditorContent = false;
        }
        const normalized = currentContent(tab);
        tab.content = normalized;
        tab.savedContent =
          wasModified || pendingEditorContent || pendingModified ? pendingSavedContent : normalized;
        tab.modified =
          wasModified || pendingModified || pendingEditorContent || normalized !== tab.savedContent;
        tab.ready = true;
        tab.toolbar = VDITOR.editorParts(tab.host).toolbar;
        VDITOR.hideNativeOutlineControl(tab.toolbar);
        VDITOR.keepSplitToolbarActionsAvailable(tab.toolbar);
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
        // Vditor initialization may finish after the user changes the application theme.
        // Read the current theme here so the late callback cannot restore stale menu filters.
        const currentAppTheme = document.documentElement.dataset.theme || state.settings.theme;
        syncCodeThemeControls(isDarkTheme(currentAppTheme), state.settings.codeTheme);
        if (tab.id === state.activeId || tab.toolbarPreview) mountEditorToolbar(tab);
        // Keep the host toolbar hidden until it has been handed to the shared
        // application toolbar. This closes the transient state where Vditor
        // has finished its DOM work but Desktop has not finished taking over.
        tab.host.dataset.editorReady = 'true';
        syncToolbarAvailability();
        if (tab.toolbarPreview) {
          disableToolbarPreview(tab);
          syncToolbarWrapHeight();
          return;
        }
        renderTabs();
        updateActiveUI();
        observeSplitLineNumbers(tab);
        observeEditorBottomSpacer(tab);
        ensureSplitResizer(tab);
        setupSplitEditorEnhancements(tab);
        scheduleSplitLineNumbers(tab);
        setTimeout(() => tab.vditor && tab.vditor.focus(), 0);
        restoreEditorScroll(tab);
        requestAnimationFrame(() => scrollToPendingAnchor(tab));
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
        setTimeout(() => {
          scheduleSplitLineNumbers(tab);
        }, 50);
      return;
    }
    if (type === 'edit-mode' && ['wysiwyg', 'ir', 'sv'].includes(button.dataset.mode)) {
      prepareVditorModeTransition(tab, button.dataset.mode);
    } else if (type === 'code-theme') {
      const codeTheme = button.textContent.trim();
      if (!codeTheme) return;
      const dark = isDarkTheme(document.documentElement.dataset.theme);
      if (button.dataset.themeTone !== (dark ? 'dark' : 'light')) return;
      const preferenceKey = dark ? 'darkCodeTheme' : 'lightCodeTheme';
      state.settings.codeTheme = codeTheme;
      state.settings[preferenceKey] = codeTheme;
      syncCodeThemeSelect(dark, codeTheme);
      queueSettingsSave({ codeTheme, [preferenceKey]: codeTheme });
    } else if (type === 'content-theme' && button.dataset.type) {
      state.settings.contentTheme = button.dataset.type;
      syncContentThemeHosts(button.dataset.type);
      queueSettingsSave({ contentTheme: button.dataset.type });
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

  function ensureEditor(tab) {
    if (tab.vditor) return true;
    tab.ready = false;
    tab.host.dataset.editorReady = 'false';
    if (tab.id === state.activeId || tab.toolbarPreview) syncToolbarAvailability();
    try {
      tab.vditor = new Vditor(tab.host, editorOptions(tab));
      return true;
    } catch (error) {
      tab.vditor = null;
      tab.host.innerHTML = `<div class="fatal"><h2>编辑器初始化失败</h2><p>${escapeHTML(error.message)}</p></div>`;
      showMessage(error.message, true);
      return false;
    }
  }

  function captureEditorScroll(tab) {
    if (!tab?.vditor) return null;
    const mode = tab.vditor.getCurrentMode();
    const scroller = VDITOR.editorScrollContainer(tab.host, mode);
    if (!scroller) return null;
    const maximumTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return {
      mode,
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
      progress: maximumTop ? scroller.scrollTop / maximumTop : 0,
    };
  }

  function restoreEditorScroll(tab) {
    const saved = tab.pendingScroll;
    if (!saved) return;
    const restore = () => {
      const mode = tab.vditor?.getCurrentMode() || tab.mode;
      const scroller = VDITOR.editorScrollContainer(tab.host, mode);
      if (!scroller) return false;
      const maximumTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const maximumLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const top =
        mode === saved.mode
          ? Math.min(maximumTop, Math.max(0, saved.scrollTop))
          : maximumTop * Math.min(1, Math.max(0, saved.progress));
      scroller.scrollTop = top;
      scroller.scrollLeft = Math.min(maximumLeft, Math.max(0, saved.scrollLeft));
      scheduleSplitLineNumbers(tab);
      return maximumTop > 0 || saved.scrollTop === 0;
    };
    // Vditor may finish a mode render after `after` has already run. Restore
    // before the first paint, then repeat across the next frames and once
    // after its short asynchronous render work so that it cannot reset the
    // reconstructed editor back to the document start.
    const restoreUntilStable = (frame = 0) => {
      if (tab.pendingScroll !== saved) return;
      restore();
      if (frame < 3) {
        requestAnimationFrame(() => restoreUntilStable(frame + 1));
        return;
      }
      setTimeout(() => {
        if (tab.pendingScroll !== saved) return;
        restore();
        tab.pendingScroll = null;
      }, 80);
    };
    restoreUntilStable();
  }

  function synchronizeVditorMode(tab) {
    if (!tab?.vditor) return;
    tab.mode = tab.vditor.getCurrentMode();
    if (tab.id === state.activeId) updateActiveUI();
    scheduleSplitLineNumbers(tab);
  }

  function prepareVditorModeTransition(tab, targetMode) {
    if (!tab?.vditor || !tab.ready || targetMode === tab.vditor.getCurrentMode()) return false;
    closeContextMenu();
    tab.pendingScroll = captureEditorScroll(tab);
    // Vditor changes its internal mode synchronously for toolbar clicks and
    // Ctrl/Cmd+Alt+7/8/9. Run after that handler, before the next paint.
    requestAnimationFrame(() => {
      if (!tab.vditor) return;
      synchronizeVditorMode(tab);
      restoreEditorScroll(tab);
    });
    setTimeout(() => synchronizeVditorMode(tab), 50);
    return true;
  }

  function handleVditorModeShortcut(tab, event) {
    const targetMode = VDITOR.editModeShortcut(event);
    if (!targetMode || !tab?.vditor || !tab.ready) return;
    const currentMode = tab.vditor.getCurrentMode();
    if (!VDITOR.isEditableTarget(tab.host, currentMode, event.target)) return;
    prepareVditorModeTransition(tab, targetMode);
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
    let rebuildError = null;
    tab.ready = false;
    tab.host.dataset.editorReady = 'false';
    if (tab.id === state.activeId || tab.toolbarPreview) syncToolbarAvailability();
    if (contextMenuState?.tab === tab) closeContextMenu();
    tab.pendingScroll = captureEditorScroll(tab);
    disconnectSplitLineNumbers(tab);
    disconnectEditorBottomSpacer(tab);
    tab.resourceObserver?.disconnect();
    tab.resourceObserver = null;
    tab.outlineObserver?.disconnect();
    tab.outlineObserver = null;
    if (tab.vditor) {
      restoreEditorToolbar(tab);
      try {
        tab.content = VDITOR.withOriginalImageSources(tab.host, () => tab.vditor.getValue());
        tab.vditor.destroy();
      } catch (error) {
        rebuildError = error;
      }
      tab.vditor = null;
      tab.toolbar = null;
    }
    tab.host.innerHTML = '';
    if (mode) tab.mode = mode;
    if (tab.id === state.activeId && !ensureEditor(tab) && !rebuildError)
      rebuildError = new Error('The editor could not be initialized after the document changed.');
    return rebuildError;
  }

  function createTab({
    filePath = null,
    content = '',
    savedContent = content,
    encoding = 'utf-8',
    baseDir = '',
    activate = true,
    untitledNumber = null,
    pendingAnchor = '',
    title: providedTitle = '',
    mode = state.settings.editMode,
    recoverySnapshotId = null,
    recoveryState = null,
    expectedSavedContent = savedContent,
    fileIdentity = null,
  } = {}) {
    destroyToolbarPreview();
    if (state.tabs.length >= 20) {
      showMessage(t('message.maxTabs'), true);
      return null;
    }
    const title =
      providedTitle ||
      (filePath
        ? fileName(filePath)
        : t('tab.untitled', { number: untitledNumber ?? ++state.untitledCounters.file }));
    const tab = {
      id: uid(),
      filePath,
      title,
      content,
      savedContent,
      encoding,
      lineEnding: detectLineEnding(content),
      baseDir,
      modified: content !== savedContent,
      expectedSavedContent,
      fileIdentity,
      contentRevision: 0,
      pendingEditorContent: false,
      saveOperation: null,
      mode,
      vditor: null,
      ready: false,
      saveTimer: null,
      toolbar: null,
      lineObserver: null,
      lineResizeObserver: null,
      lineNumberFrame: null,
      whitespaceFrame: null,
      bottomSpacerObserver: null,
      outlineCollapsed: new Set(),
      outlineObserver: null,
      resourceObserver: null,
      modeShortcutCleanup: null,
      splitResizer: null,
      externalConflict: null,
      externalChangeIgnored: false,
      externalFileState: null,
      recoverySnapshotId,
      recoveryState,
      recoveryTimer: null,
      recoveryRevision: 0,
      recoveryOperation: Promise.resolve(),
      pendingAnchor,
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
          synchronizeVditorMode(tab);
        }, 50);
      },
      true,
    );
    const onModeShortcut = (event) => handleVditorModeShortcut(tab, event);
    tab.host.addEventListener('keydown', onModeShortcut, true);
    tab.modeShortcutCleanup = () => tab.host.removeEventListener('keydown', onModeShortcut, true);
    tab.host.addEventListener('contextmenu', (event) => showEditorContextMenu(tab, event), true);
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

  function scrollToPendingAnchor(tab) {
    if (!tab.pendingAnchor || tab.id !== state.activeId || !tab.ready) return;
    const href = `#${tab.pendingAnchor}`;
    tab.pendingAnchor = '';
    const headingIndex = VDITOR.headingIndexForAnchor(tab.host, href);
    if (headingIndex >= 0) scrollToHeading(tab, headingIndex);
  }

  async function openPath(filePath, activate = true, pendingAnchor = '') {
    try {
      const fileIdentity = await window.fileAPI.fileIdentity(filePath);
      const normalizedPath = normalizedFilePath(filePath);
      const existing = state.tabs.find(
        (tab) =>
          tab.fileIdentity === fileIdentity ||
          normalizedFilePath(tabTargetPath(tab)) === normalizedPath,
      );
      if (existing) {
        if (!existing.filePath) {
          clearTimeout(existing.saveTimer);
          existing.externalConflict = {
            kind: 'modified',
            path: filePath,
            identity: fileIdentity,
            detectedAt: Date.now(),
            version: (existing.externalConflict?.version || 0) + 1,
          };
          existing.externalChangeIgnored = false;
          renderTabs();
        }
        if (activate) switchTab(existing.id);
        if (pendingAnchor) {
          existing.pendingAnchor = pendingAnchor;
          requestAnimationFrame(() => scrollToPendingAnchor(existing));
        }
        return existing;
      }
      const result = await window.fileAPI.readFile(filePath);
      const baseDir = await window.fileAPI.dirname(filePath);
      await syncLocalResourceRoots([baseDir]);
      const tab = createTab({
        filePath,
        content: result.content,
        encoding: result.encoding,
        baseDir,
        activate,
        pendingAnchor,
        fileIdentity,
      });
      if (!tab) {
        await syncLocalResourceRoots();
        return null;
      }
      await watchTabDocument(tab);
      rememberRecent(filePath);
      return tab;
    } catch (error) {
      showMessage(t('message.openFailed', { error: ipcErrorMessage(error) }), true);
      return null;
    }
  }

  function untitledCollisionKey(name) {
    return name.replace(/\.(?:md|markdown|mdown|mkd|mkdn)$/i, '').toLocaleLowerCase();
  }

  function untitledItemName(number, type) {
    const title = t('tab.untitled', { number });
    return type === 'file' ? `${title}.md` : title;
  }

  async function nextUntitledNumber(parent, type) {
    let entries = [];
    if (parent) {
      try {
        entries = await window.fileAPI.listDir(parent, state.workspace || undefined);
      } catch (_) {}
    }
    const occupiedNames = new Set();
    entries.forEach((entry) => {
      if (entry?.type === type && entry.name) occupiedNames.add(untitledCollisionKey(entry.name));
    });
    if (type === 'file') {
      state.tabs.forEach((tab) => {
        if (tab.title) occupiedNames.add(untitledCollisionKey(tab.title));
        if (tab.filePath) occupiedNames.add(untitledCollisionKey(fileName(tab.filePath)));
      });
    }
    let number = state.untitledCounters[type] + 1;
    while (occupiedNames.has(untitledCollisionKey(untitledItemName(number, type)))) number++;
    state.untitledCounters[type] = number;
    return number;
  }

  async function newTab() {
    const number = await nextUntitledNumber(state.workspace, 'file');
    createTab({ untitledNumber: number });
  }

  function switchTab(id) {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    closeContextMenu();
    restoreEditorToolbar(activeTab());
    state.activeId = id;
    syncToolbarAvailability();
    state.tabs.forEach((item) => item.host.classList.toggle('active', item.id === id));
    ensureEditor(tab);
    requestAnimationFrame(() => updateEditorBottomSpacer(tab));
    requestAnimationFrame(() => scrollToPendingAnchor(tab));
    if (tab.toolbar) mountEditorToolbar(tab);
    scheduleSplitLineNumbers(tab);
    renderTabs();
    updateActiveUI();
    renderOutline();
    if (findWidgetVisible()) refreshFind({ preserveIndex: false });
    persistSession();
  }

  async function closeTab(id, { discard = false } = {}) {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    if (contextMenuState?.tab === tab) closeContextMenu();
    if (tab.externalFileState && !tab.modified && !discard) {
      const action = await showConfirmDialog({
        title: t('external.closeTitle'),
        message: t('external.closeMessage', { name: tab.title }),
        detail: t('external.closeDetail'),
        actions: [
          { id: 'cancel', label: t('dialog.cancel') },
          { id: 'confirm', label: t('external.close'), primary: true, danger: true },
        ],
        draggable: true,
      });
      if (action !== 'confirm') return;
    } else if (tab.modified && !discard) {
      const action = await showUnsavedDialog(
        t('confirm.closeDirty', { title: tab.title }),
        t('confirm.closeDirtyDetail'),
      );
      if (action === 'cancel' || (action === 'save' && !(await saveTab(tab)))) return;
    }
    clearTimeout(tab.saveTimer);
    await discardRecoverySnapshot(tab);
    disconnectSplitLineNumbers(tab);
    disconnectEditorBottomSpacer(tab);
    tab.resourceObserver?.disconnect();
    tab.resourceObserver = null;
    tab.outlineObserver?.disconnect();
    tab.outlineObserver = null;
    tab.tableCompositionScrollCleanup?.();
    tab.tableCompositionScrollCleanup = null;
    tab.modeShortcutCleanup?.();
    tab.modeShortcutCleanup = null;
    restoreEditorToolbar(tab);
    if (tab.vditor) {
      try {
        tab.vditor.destroy();
      } catch (_) {}
    }
    tab.host.remove();
    const index = state.tabs.indexOf(tab);
    state.tabs.splice(index, 1);
    syncToolbarAvailability();
    await releaseDocumentWatch(tab.filePath, tab.fileIdentity);
    await syncLocalResourceRoots();
    if (!state.tabs.length) {
      state.activeId = null;
      $('#vditorToolbarMount').innerHTML = '';
      createToolbarPreview();
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
      button.innerHTML = `<span>${escapeHTML(tab.title)}</span>${tab.externalConflict || tab.externalFileState ? `<i class="conflict" title="${escapeHTML(t('external.needsAttention', { name: tab.title }))}">!</i>` : ''}<i class="dirty">${tab.modified ? '●' : ''}</i><b title="${escapeHTML(t('tab.close'))}">×</b>`;
      button.addEventListener('click', (event) => {
        if (tabDragMoved) return;
        if (event.target.tagName === 'B') closeTab(tab.id);
        else switchTab(tab.id);
      });
      button.addEventListener('auxclick', (event) => {
        if (event.button === 1) closeTab(tab.id);
      });
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('b')) return;
        draggedTabId = tab.id;
        tabDragPointerId = event.pointerId;
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointermove', (event) => {
        if (!draggedTabId || event.pointerId !== tabDragPointerId) return;
        if (!tabDragMoved && Math.abs(event.movementX) + Math.abs(event.movementY) > 3) {
          tabDragMoved = true;
          button.classList.add('dragging');
          tabDragGhost = button.cloneNode(true);
          tabDragGhost.className = 'document-tab tab-drag-ghost';
          document.body.append(tabDragGhost);
        }
        if (tabDragGhost) {
          tabDragGhost.style.left = `${event.clientX}px`;
          tabDragGhost.style.top = `${event.clientY}px`;
        }
        const target = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('.document-tab');
        $$('.document-tab.drag-over', $('#tabBar')).forEach((node) =>
          node.classList.remove('drag-over'),
        );
        if (target && target.dataset.id !== draggedTabId) {
          const bounds = target.getBoundingClientRect();
          target.dataset.dropSide =
            event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
          target.classList.add('drag-over');
        }
      });
      button.addEventListener('pointerup', (event) => {
        if (!draggedTabId || event.pointerId !== tabDragPointerId) return;
        const target = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('.document-tab');
        const from = state.tabs.findIndex((item) => item.id === draggedTabId);
        const to = state.tabs.findIndex((item) => item.id === target?.dataset.id);
        if (from >= 0 && to >= 0 && from !== to) {
          const [moved] = state.tabs.splice(from, 1);
          const targetIndex = target?.dataset.dropSide === 'after' ? to + 1 : to;
          state.tabs.splice(targetIndex > from ? targetIndex - 1 : targetIndex, 0, moved);
          renderTabs();
          persistSession();
        }
        draggedTabId = null;
        tabDragPointerId = null;
        if (tabDragGhost) tabDragGhost.remove();
        tabDragGhost = null;
        $$('.document-tab.dragging, .document-tab.drag-over', $('#tabBar')).forEach((node) =>
          node.classList.remove('dragging', 'drag-over'),
        );
        setTimeout(() => {
          tabDragMoved = false;
        }, 0);
      });
      $('#tabBar').insertBefore(button, add);
    });
    requestAnimationFrame(() =>
      $('#tabBar .document-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
  }

  function onEditorInput(tab, value) {
    if (value !== tab.content) {
      tab.pendingEditorContent = false;
      tab.contentRevision++;
    }
    tab.content = value;
    tab.modified = value !== tab.savedContent;
    scheduleRecoverySnapshot(tab);
    renderTabs();
    if (tab.id === state.activeId) updateActiveUI();
    scheduleSplitLineNumbers(tab);
    if (
      state.settings.autoSave &&
      tab.filePath &&
      tab.modified &&
      !tab.externalConflict &&
      !tab.externalChangeIgnored &&
      !tab.externalFileState
    ) {
      clearTimeout(tab.saveTimer);
      tab.saveTimer = setTimeout(() => saveTab(tab), state.settings.autoSaveDelay);
    }
  }

  function currentContent(tab) {
    if (!tab) return '';
    try {
      return tab.vditor && tab.ready
        ? VDITOR.withOriginalImageSources(tab.host, () => tab.vditor.getValue())
        : tab.content;
    } catch (_) {
      return tab.content;
    }
  }

  function recreateClipboardSnapshot(tab) {
    return state.settings.autoSave ? currentContent(tab) : tab.savedContent;
  }

  function saveTab(
    tab = activeTab(),
    saveAs = false,
    overwriteConflict = null,
    recreateFileState = null,
  ) {
    if (!tab) return Promise.resolve(false);
    const previous = tab.saveOperation || Promise.resolve(false);
    const operation = previous
      .catch(() => false)
      .then(() => performSaveTab(tab, saveAs, overwriteConflict, recreateFileState));
    tab.saveOperation = operation.catch(() => false);
    return operation;
  }

  function queueSaveForIdentity(identity, operation) {
    const previous = saveOperationsByIdentity.get(identity) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    saveOperationsByIdentity.set(identity, queued);
    const release = () => {
      if (saveOperationsByIdentity.get(identity) === queued)
        saveOperationsByIdentity.delete(identity);
    };
    void queued.then(release, release);
    return queued;
  }

  function queueSettingsSave(settings, { throwOnFailure = false } = {}) {
    const previous = settingsSaveQueue;
    const queued = previous.catch(() => undefined).then(() => window.appAPI.saveSettings(settings));
    settingsSaveQueue = queued.catch(() => undefined);
    if (throwOnFailure) return queued;
    return queued.catch((error) => {
      console.error('Unable to persist settings.', error);
      return state.settings;
    });
  }

  async function performSaveTab(
    tab = activeTab(),
    saveAs = false,
    overwriteConflict = null,
    recreateFileState = null,
    queuedIdentity = null,
    selectedDestination = null,
  ) {
    if (!tab) return false;
    const previousPath = tab.filePath;
    const previousIdentity = tab.fileIdentity;
    let destination = selectedDestination || tab.filePath;
    if (!destination || (saveAs && !selectedDestination))
      destination = await window.fileAPI.saveFileDialog(
        destination || `${tab.title}.md`,
        destination ? undefined : state.workspace || undefined,
      );
    if (!destination) return false;
    const destinationIdentity = await window.fileAPI.fileIdentity(destination);
    if (queuedIdentity !== destinationIdentity) {
      return queueSaveForIdentity(destinationIdentity, () =>
        performSaveTab(
          tab,
          saveAs,
          overwriteConflict,
          recreateFileState,
          destinationIdentity,
          destination,
        ),
      );
    }
    const occupiedTab = state.tabs.find(
      (item) => item !== tab && tabFileIdentity(item) === destinationIdentity,
    );
    if (occupiedTab) {
      showMessage(t('message.savePathAlreadyOpen', { title: occupiedTab.title }), true);
      return false;
    }
    const conflict = tab.externalConflict;
    const writesConflictedPath = Boolean(conflict && conflict.identity === destinationIdentity);
    const fileState = tab.externalFileState;
    const writesUnavailablePath = Boolean(fileState && fileState.identity === destinationIdentity);
    if (writesUnavailablePath && recreateFileState !== fileState.version) {
      showMessage(t('external.resolveFileStateBeforeSave'), true);
      return false;
    }
    if (writesConflictedPath && !overwriteConflict) {
      if (tab.externalChangeIgnored)
        return confirmExternalOverwrite(tab, destinationIdentity, destination);
      showMessage(t('external.resolveBeforeSave'), true);
      return false;
    }
    if (writesConflictedPath && overwriteConflict !== conflict.version) {
      showMessage(t('external.changedAgain', { name: tab.title }), true);
      return false;
    }
    if (tab.filePath && tab.fileIdentity === destinationIdentity && !fileState && !conflict) {
      const exists = await window.fileAPI.exists(destination);
      if (!exists) {
        await preserveUnavailableTab(tab, 'deleted', destination);
        renderTabs();
        if (tab.id === state.activeId) updateActiveUI();
        return false;
      }
      try {
        const diskVersion = await window.fileAPI.readFile(destination);
        if (diskVersion.content !== tab.expectedSavedContent) {
          clearTimeout(tab.saveTimer);
          tab.externalConflict = {
            kind: 'modified',
            path: destination,
            identity: destinationIdentity,
            content: diskVersion.content,
            encoding: diskVersion.encoding || tab.encoding,
            detectedAt: Date.now(),
            version: (tab.externalConflict?.version || 0) + 1,
          };
          tab.externalChangeIgnored = false;
          renderTabs();
          if (tab.id === state.activeId) updateActiveUI();
          return false;
        }
      } catch (_) {
        await preserveUnavailableTab(tab, 'unreadable', destination);
        renderTabs();
        if (tab.id === state.activeId) updateActiveUI();
        return false;
      }
    }
    const destinationChanged = Boolean(previousPath) && previousIdentity !== destinationIdentity;
    let previousWatchSuspended = false;
    if (destinationChanged) {
      await suspendDocumentWatches([tab]);
      previousWatchSuspended = true;
    }
    try {
      const content = tab.pendingEditorContent ? tab.content : currentContent(tab);
      const diskContent =
        tab.lineEnding === 'CRLF'
          ? content.replace(/\r?\n/g, '\r\n')
          : content.replace(/\r\n/g, '\n');
      const savedRevision = tab.contentRevision;
      let expectedContent;
      let expectedAbsent = false;
      if (tab.filePath && tab.fileIdentity === destinationIdentity && !fileState && !conflict) {
        expectedContent = tab.expectedSavedContent;
      } else if (writesUnavailablePath) {
        expectedAbsent = true;
      } else if (await window.fileAPI.exists(destination)) {
        expectedContent = (await window.fileAPI.readFile(destination)).content;
      } else {
        expectedAbsent = true;
      }
      const result = await window.fileAPI.writeDocument(
        destination,
        diskContent,
        expectedContent,
        expectedAbsent,
      );
      if (result.error) {
        if (result.error === 'external-change') {
          clearTimeout(tab.saveTimer);
          tab.externalConflict = {
            kind: 'modified',
            path: destination,
            identity: destinationIdentity,
            content: result.content,
            encoding: result.encoding || tab.encoding,
            detectedAt: Date.now(),
            version: (tab.externalConflict?.version || 0) + 1,
          };
          tab.externalChangeIgnored = false;
          renderTabs();
          if (tab.id === state.activeId) updateActiveUI();
          return false;
        }
        showMessage(
          t(
            result.error === 'permission-denied'
              ? 'message.savePermissionDenied'
              : 'message.saveFailedGeneric',
          ),
          true,
        );
        if (previousWatchSuspended) await rebindDocumentWatches([tab]);
        return false;
      }
      const previousBaseDir = tab.baseDir;
      tab.filePath = destination;
      tab.fileIdentity = destinationIdentity;
      tab.title = fileName(destination);
      tab.savedContent = content;
      tab.expectedSavedContent = result.expectedContent;
      tab.modified = tab.content !== tab.savedContent;
      tab.externalConflict = null;
      tab.externalChangeIgnored = false;
      tab.externalFileState = null;
      tab.encoding = 'utf-8';
      tab.baseDir = await window.fileAPI.dirname(destination);
      await releaseDocumentWatch(previousPath, previousIdentity);
      await syncLocalResourceRoots();
      await watchTabDocument(tab);
      if (tab.contentRevision === savedRevision) {
        await discardRecoverySnapshot(tab);
        tab.recoveryState = null;
      } else {
        scheduleRecoverySnapshot(tab);
      }
      if (previousBaseDir !== tab.baseDir) rebuildEditor(tab);
      rememberRecent(destination);
      if (state.workspace && (!previousPath || saveAs || previousPath !== destination)) {
        await refreshTree();
      }
      renderTabs();
      updateActiveUI();
      persistSession();
      showMessage(t('message.saved', { title: tab.title }));
      return true;
    } catch (error) {
      if (previousWatchSuspended) await rebindDocumentWatches([tab]);
      showMessage(t('message.saveFailed', { error: ipcErrorMessage(error) }), true);
      return false;
    }
  }

  function recoverySnapshotFor(tab) {
    return {
      schemaVersion: 2,
      id: tab.recoverySnapshotId || recoveryId(),
      filePath: tab.filePath,
      title: tab.title,
      content: tab.content,
      savedContent: tab.savedContent,
      expectedSavedContent: tab.expectedSavedContent,
      encoding: tab.encoding,
      lineEnding: tab.lineEnding,
      mode: tab.mode,
      updatedAt: Date.now(),
    };
  }

  function queueRecoveryOperation(tab, operation) {
    const previous = tab.recoveryOperation || Promise.resolve();
    tab.recoveryOperation = previous.catch(() => undefined).then(operation);
    return tab.recoveryOperation;
  }

  function scheduleRecoverySnapshot(tab) {
    clearTimeout(tab.recoveryTimer);
    if (!tab.modified && !tab.externalFileState) {
      void discardRecoverySnapshot(tab);
      return;
    }
    if (!tab.modified) return;
    const id = tab.recoverySnapshotId || recoveryId();
    tab.recoverySnapshotId = id;
    const revision = ++tab.recoveryRevision;
    tab.recoveryTimer = setTimeout(() => {
      tab.recoveryTimer = null;
      void queueRecoveryOperation(tab, async () => {
        if (tab.recoverySnapshotId !== id || tab.recoveryRevision !== revision || !tab.modified)
          return;
        try {
          await window.appAPI.saveRecovery(recoverySnapshotFor(tab));
        } catch (_) {
          console.error('Unable to save a recovery snapshot.');
        }
      });
    }, 500);
  }

  async function discardRecoverySnapshot(tab) {
    clearTimeout(tab.recoveryTimer);
    tab.recoveryTimer = null;
    const id = tab.recoverySnapshotId;
    tab.recoverySnapshotId = null;
    tab.recoveryRevision++;
    if (!id) return;
    await queueRecoveryOperation(tab, async () => {
      try {
        await window.appAPI.discardRecovery(id);
      } catch (_) {
        console.error('Unable to remove a recovery snapshot.');
      }
    });
  }

  async function preserveUnavailableTab(tab, kind, filePath, error) {
    const fileIdentity = tab.fileIdentity || (await window.fileAPI.fileIdentity(filePath));
    if (
      tab.externalFileState?.kind === kind &&
      tab.externalFileState.identity === fileIdentity &&
      tab.recoverySnapshotId
    )
      return;
    clearTimeout(tab.saveTimer);
    clearTimeout(tab.recoveryTimer);
    tab.recoveryTimer = null;
    const editorContent = currentContent(tab);
    if (editorContent.trim() || tab.modified || (!tab.content && !tab.savedContent))
      tab.content = editorContent;
    else if (!tab.content.trim()) tab.content = tab.savedContent;
    tab.externalConflict = null;
    tab.externalChangeIgnored = false;
    tab.externalFileState = {
      kind,
      path: filePath,
      identity: fileIdentity,
      ...(error ? { error } : {}),
      clipboardContent: tab.externalFileState?.clipboardContent ?? recreateClipboardSnapshot(tab),
      detectedAt: Date.now(),
      version: (tab.externalFileState?.version || 0) + 1,
    };
    const id = tab.recoverySnapshotId || recoveryId();
    tab.recoverySnapshotId = id;
    const revision = ++tab.recoveryRevision;
    await queueRecoveryOperation(tab, async () => {
      if (tab.recoverySnapshotId !== id || tab.recoveryRevision !== revision) return;
      try {
        await window.appAPI.saveRecovery(recoverySnapshotFor(tab));
      } catch (_) {
        console.error('Unable to preserve an unavailable document for recovery.');
      }
    });
  }

  async function restoreRecoverySnapshots() {
    let candidates;
    try {
      candidates = await window.appAPI.getRecoveryCandidates();
    } catch (_) {
      return;
    }
    for (const candidate of candidates) {
      const snapshot = await window.appAPI.restoreRecovery(candidate.id);
      if (!snapshot) continue;
      if (snapshot.diskState !== 'unchanged') {
        const baseDir = snapshot.filePath ? await window.fileAPI.dirname(snapshot.filePath) : '';
        await syncLocalResourceRoots(baseDir ? [baseDir] : []);
        const tab = createTab({
          title: t('recovery.conflictTitle', { title: snapshot.title }),
          content: snapshot.content,
          savedContent: '',
          encoding: snapshot.encoding,
          baseDir,
          mode: snapshot.mode,
          recoverySnapshotId: snapshot.id,
          recoveryState: snapshot.diskState,
        });
        if (tab) await watchTabDocument(tab);
      } else {
        const fileIdentity = snapshot.filePath
          ? await window.fileAPI.fileIdentity(snapshot.filePath)
          : null;
        const existing = fileIdentity
          ? state.tabs.find((tab) => tab.fileIdentity === fileIdentity)
          : null;
        if (existing) {
          existing.content = snapshot.content;
          existing.savedContent = snapshot.savedContent;
          existing.expectedSavedContent = snapshot.expectedSavedContent;
          existing.modified = existing.content !== existing.savedContent;
          existing.encoding = snapshot.encoding;
          existing.lineEnding = snapshot.lineEnding;
          existing.mode = snapshot.mode;
          existing.recoverySnapshotId = snapshot.id;
          existing.recoveryState = 'unchanged';
          existing.contentRevision++;
          if (existing.vditor && existing.ready) existing.vditor.setValue(snapshot.content, true);
          else existing.pendingEditorContent = true;
          continue;
        }
        const baseDir = snapshot.filePath ? await window.fileAPI.dirname(snapshot.filePath) : '';
        await syncLocalResourceRoots(baseDir ? [baseDir] : []);
        const tab = createTab({
          filePath: snapshot.filePath,
          content: snapshot.content,
          savedContent: snapshot.savedContent,
          encoding: snapshot.encoding,
          baseDir,
          mode: snapshot.mode,
          recoverySnapshotId: snapshot.id,
          recoveryState: 'unchanged',
          expectedSavedContent: snapshot.expectedSavedContent,
          fileIdentity,
        });
        if (tab) await watchTabDocument(tab);
      }
    }
  }

  function updateActiveUI() {
    updateEmptyState();
    const tab = activeTab();
    syncToolbarAvailability();
    $('#app').classList.toggle('toolbar-preview-active', !tab);
    syncTopControlsWidth();
    if (!tab) {
      updateExternalChangeBanner(null);
      updateExternalFileStateBanner(null);
      updateRecoveryBanner(null);
      $('#saveFile').disabled = true;
      document.title = 'Vditor Desktop';
      $('#windowTitle').textContent = 'Vditor Desktop';
      $('#statusPath').textContent = '';
      $('#statusMode').textContent = '—';
      $('#statusMode').setAttribute('aria-disabled', 'true');
      closeStatusModeMenu();
      $('#statusWords').textContent = t('status.words', { count: 0 });
      $('#statusChars').textContent = t('status.chars', { count: 0 });
      $('#statusLines').textContent = t('status.lines', { count: 0 });
      $('#statusEncoding').textContent = '—';
      $('#statusLineEnding').textContent = '—';
      return;
    }
    updateExternalChangeBanner(tab);
    updateExternalFileStateBanner(tab);
    updateRecoveryBanner(tab);
    $('#saveFile').disabled = false;
    const content = currentContent(tab);
    tab.content = content;
    document.title = `${tab.title} - Vditor Desktop`;
    $('#windowTitle').textContent = `${tab.title} - Vditor Desktop`;
    $('#statusPath').textContent = tab.filePath || '';
    $('#statusPath').title = tab.filePath || '';
    const currentMode = tab.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab.mode;
    tab.mode = currentMode;
    $('#statusMode').textContent = currentMode.toUpperCase();
    $('#statusMode').setAttribute('aria-disabled', 'false');
    syncStatusModeMenu(currentMode);
    const chars = content.replace(/\s/g, '').length;
    const latinWords = (content.match(/[A-Za-z0-9_]+/g) || []).length;
    const hanChars = (content.match(/[\u3400-\u9fff]/g) || []).length;
    $('#statusWords').textContent = t('status.words', { count: latinWords + hanChars });
    $('#statusChars').textContent = t('status.chars', { count: chars });
    $('#statusLines').textContent = t('status.lines', { count: content.split(/\r?\n/).length });
    $('#statusEncoding').textContent = tab.encoding.toUpperCase();
    $('#statusLineEnding').textContent = tab.lineEnding;
    updateActiveTreeSelection(tab);
  }

  function updateActiveTreeSelection(tab = activeTab()) {
    $$('.tree-file.active').forEach((node) => node.classList.remove('active'));
    if (tab?.filePath) {
      const node = $(`.tree-file[data-path="${CSS.escape(tab.filePath)}"]`);
      if (node) node.classList.add('active');
    }
  }

  function syncStatusModeMenu(mode) {
    $$('#statusModeMenu [data-status-mode]').forEach((button) => {
      const selected = button.dataset.statusMode === mode;
      button.setAttribute('aria-checked', String(selected));
      button.querySelector('.checkmark').textContent = selected ? '✓' : '';
    });
  }

  function themeModeFromSettings() {
    if (state.settings?.systemTheme) return 'system';
    return isDarkTheme(state.settings?.theme) ? 'dark' : 'light';
  }

  function syncThemeModeControl() {
    const trigger = $('#statusThemeMode');
    const icon = $('#statusThemeIcon');
    const menu = $('#statusThemeMenu');
    if (!trigger || !icon || !menu || !state.settings) return;
    const mode = themeModeFromSettings();
    const labelKey = `themeMode.${mode}`;
    const label = t(labelKey);
    icon.className = `theme-mode-icon theme-mode-icon-${mode}`;
    trigger.dataset.themeMode = mode;
    trigger.dataset.i18nTitle = labelKey;
    trigger.title = label;
    trigger.setAttribute('aria-label', label);
    $$('#statusThemeMenu [data-theme-mode]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.themeMode === mode));
    });
  }

  function closeStatusModeMenu() {
    $('#statusModeMenu').classList.add('hidden');
    $('#statusMode').setAttribute('aria-expanded', 'false');
  }

  function closeStatusThemeMenu() {
    $('#statusThemeMenu').classList.add('hidden');
    $('#statusThemeMode').setAttribute('aria-expanded', 'false');
  }

  function toggleStatusModeMenu() {
    const tab = activeTab();
    if (!tab?.vditor || !tab.ready) return;
    const menu = $('#statusModeMenu');
    const willOpen = menu.classList.contains('hidden');
    if (!willOpen) {
      closeStatusModeMenu();
      return;
    }
    closeStatusThemeMenu();
    syncStatusModeMenu(tab.vditor.getCurrentMode());
    menu.classList.remove('hidden');
    $('#statusMode').setAttribute('aria-expanded', 'true');
  }

  function selectStatusMode(mode) {
    const tab = activeTab();
    closeStatusModeMenu();
    if (!tab?.vditor || !tab.ready || mode === tab.vditor.getCurrentMode()) return;
    VDITOR.selectEditMode(tab.toolbar, mode);
  }

  function toggleStatusThemeMenu() {
    const menu = $('#statusThemeMenu');
    const willOpen = menu.classList.contains('hidden');
    if (!willOpen) {
      closeStatusThemeMenu();
      return;
    }
    closeStatusModeMenu();
    syncThemeModeControl();
    menu.classList.remove('hidden');
    $('#statusThemeMode').setAttribute('aria-expanded', 'true');
  }

  async function selectStatusThemeMode(mode) {
    closeStatusThemeMenu();
    if (!THEME_MODES.includes(mode) || mode === themeModeFromSettings()) return;
    const patch =
      mode === 'system'
        ? { systemTheme: true }
        : {
            systemTheme: false,
            theme: mode === 'dark' ? darkThemePreference() : lightThemePreference(),
          };
    state.settings = await queueSettingsSave(patch);
    await applyTheme(await resolveTheme());
  }

  function updateEmptyState() {
    const empty = $('#noTabs');
    const hasTabs = state.tabs.length > 0;
    if (empty) empty.classList.toggle('hidden', hasTabs);
    $('#tabBar').classList.toggle('empty', !hasTabs);
  }

  function updateExternalChangeBanner(tab) {
    const banner = $('#externalChangeBanner');
    const conflict = tab?.externalConflict;
    banner.classList.toggle('hidden', !conflict || tab.externalChangeIgnored);
    if (!conflict || tab.externalChangeIgnored) return;
    $('#externalChangeMessage').textContent = t('external.changed', {
      name: fileName(conflict.path),
    });
  }

  function updateExternalFileStateBanner(tab) {
    const banner = $('#externalFileStateBanner');
    const fileState = tab?.externalFileState;
    banner.classList.toggle('hidden', !fileState);
    if (!fileState) return;
    const name = fileName(fileState.path);
    const messageKey =
      fileState.kind === 'deleted'
        ? 'external.deleted'
        : fileState.kind === 'reappeared'
          ? 'external.reappeared'
          : 'external.unreadable';
    const detailKey =
      fileState.kind === 'deleted'
        ? 'external.deletedDetail'
        : fileState.kind === 'reappeared'
          ? 'external.reappearedDetail'
          : 'external.unreadableDetail';
    $('#externalFileStateMessage').textContent = t(messageKey, { name });
    $('#externalFileStateDetail').textContent = t(detailKey);
    $('#externalFileReload').classList.toggle('hidden', fileState.kind !== 'reappeared');
    $('#externalFileRecreate').classList.toggle('hidden', fileState.kind === 'unreadable');
  }

  function updateRecoveryBanner(tab) {
    const banner = $('#recoveryBanner');
    const recoveryState = tab?.recoveryState;
    banner.classList.toggle('hidden', !recoveryState);
    if (!recoveryState) return;

    const changed = recoveryState === 'changed';
    const unavailable = recoveryState === 'unavailable';
    $('#recoveryMessage').textContent = t(
      changed ? 'recovery.changed' : unavailable ? 'recovery.unavailable' : 'recovery.restored',
    );
    $('#recoveryDetail').textContent = t(
      changed
        ? 'recovery.changedDetail'
        : unavailable
          ? 'recovery.unavailableDetail'
          : 'recovery.restoredDetail',
    );
    $('#recoverySave').classList.toggle('hidden', recoveryState !== 'unchanged');
  }

  async function saveRecoveredVersion(tab) {
    if (!tab?.recoveryState) return;
    await saveTab(tab);
  }

  async function saveRecoveredAs(tab) {
    if (!tab?.recoveryState) return;
    await saveTab(tab, true);
  }

  async function discardRecoveredVersion(tab) {
    if (!tab?.recoveryState) return;
    await closeTab(tab.id, { discard: true });
  }

  async function reloadExternalChange(tab) {
    const conflict = tab?.externalConflict;
    if (!conflict || typeof conflict.content !== 'string') return;
    const conflictIdentity = conflict.identity || tabFileIdentity(tab);
    const relatedTabs = state.tabs.filter(
      (item) => item === tab || (conflictIdentity && tabFileIdentity(item) === conflictIdentity),
    );
    for (const item of relatedTabs) {
      clearTimeout(item.saveTimer);
      item.content = conflict.content;
      item.savedContent = conflict.content;
      item.expectedSavedContent = conflict.content;
      item.modified = false;
      item.encoding = conflict.encoding || item.encoding;
      item.lineEnding = detectLineEnding(conflict.content);
      item.externalConflict = null;
      item.externalChangeIgnored = false;
      if (item.vditor) item.vditor.setValue(conflict.content, true);
    }
    renderTabs();
    updateActiveUI();
    renderOutline();
    persistSession();
    showMessage(t('external.reloaded', { name: tab.title }));
  }

  async function confirmExternalOverwrite(tab, queuedIdentity = null, selectedDestination = null) {
    const conflict = tab?.externalConflict;
    if (!conflict) return false;
    const action = await showConfirmDialog({
      title: t('external.overwriteTitle'),
      message: t('external.overwriteMessage', { name: tab.title }),
      detail: t('external.overwriteDetail'),
      actions: [
        { id: 'cancel', label: t('dialog.cancel') },
        { id: 'confirm', label: t('external.overwrite'), primary: true, danger: true },
      ],
      draggable: true,
    });
    if (action !== 'confirm') return false;
    if (tab.externalConflict?.version !== conflict.version) {
      showMessage(t('external.changedAgain', { name: tab.title }), true);
      return false;
    }
    return performSaveTab(tab, false, conflict.version, null, queuedIdentity, selectedDestination);
  }

  async function reloadReappearedFile(tab) {
    const fileState = tab?.externalFileState;
    if (fileState?.kind !== 'reappeared' || typeof fileState.content !== 'string') return;
    const fileStateIdentity = fileState.identity || tabFileIdentity(tab);
    const relatedTabs = state.tabs.filter(
      (item) => item === tab || (fileStateIdentity && tabFileIdentity(item) === fileStateIdentity),
    );
    for (const item of relatedTabs) {
      clearTimeout(item.saveTimer);
      item.content = fileState.content;
      item.savedContent = fileState.content;
      item.expectedSavedContent = fileState.content;
      item.modified = false;
      item.encoding = fileState.encoding || item.encoding;
      item.lineEnding = detectLineEnding(fileState.content);
      item.externalConflict = null;
      item.externalChangeIgnored = false;
      item.externalFileState = null;
      if (item.vditor) item.vditor.setValue(fileState.content, true);
      await discardRecoverySnapshot(item);
    }
    renderTabs();
    updateActiveUI();
    renderOutline();
    persistSession();
    showMessage(t('external.reloaded', { name: tab.title }));
  }

  async function keepExternalFileAsUntitled(tab) {
    if (!tab?.externalFileState) return;
    const previousPath = tab.filePath;
    const previousIdentity = tab.fileIdentity;
    clearTimeout(tab.saveTimer);
    tab.filePath = null;
    tab.fileIdentity = null;
    tab.baseDir = '';
    tab.title = t('tab.untitled', { number: ++state.untitledCounters.file });
    tab.savedContent = '';
    tab.expectedSavedContent = '';
    tab.modified = tab.content !== '';
    tab.externalConflict = null;
    tab.externalChangeIgnored = false;
    tab.externalFileState = null;
    await releaseDocumentWatch(previousPath, previousIdentity);
    await syncLocalResourceRoots();
    scheduleRecoverySnapshot(tab);
    renderTabs();
    updateActiveUI();
    persistSession();
  }

  async function confirmExternalFileRecreate(tab) {
    const fileState = tab?.externalFileState;
    if (!fileState || fileState.kind === 'unreadable') return false;
    const action = await showConfirmDialog({
      title: t('external.recreateTitle'),
      message: t('external.recreateMessage', { name: fileName(fileState.path) }),
      detail: t('external.recreateDetail'),
      actions: [
        { id: 'cancel', label: t('dialog.cancel') },
        { id: 'confirm', label: t('external.recreate'), primary: true, danger: true },
      ],
      draggable: true,
    });
    if (action !== 'confirm') return false;
    if (tab.externalFileState?.version !== fileState.version) {
      showMessage(t('external.changedAgain', { name: tab.title }), true);
      return false;
    }
    const previousContent = fileState.clipboardContent || '';
    const recreated = await saveTab(tab, false, null, fileState.version);
    if (!recreated) return false;
    if (!previousContent) {
      const message = t('external.recreated');
      showMessage(message);
      showTemporaryDocumentNotice(message);
      return true;
    }
    try {
      await window.appAPI.writeClipboard(previousContent);
      const message = t('external.recreatedCopied');
      showMessage(message);
      showTemporaryDocumentNotice(message);
    } catch (_) {
      const message = t('external.recreatedClipboardFailed');
      showMessage(message, true);
      showTemporaryDocumentNotice(message, true);
    }
    return true;
  }

  async function confirmExternalFileClose(tab) {
    if (!tab?.externalFileState) return;
    const action = await showConfirmDialog({
      title: t('external.closeTitle'),
      message: t('external.closeMessage', { name: tab.title }),
      detail: t('external.closeDetail'),
      actions: [
        { id: 'cancel', label: t('dialog.cancel') },
        { id: 'confirm', label: t('external.close'), primary: true, danger: true },
      ],
      draggable: true,
    });
    if (action === 'confirm') await closeTab(tab.id, { discard: true });
  }

  function ignoreExternalChange(tab) {
    if (!tab?.externalConflict) return;
    tab.externalChangeIgnored = true;
    renderTabs();
    if (tab.id === state.activeId) updateExternalChangeBanner(tab);
    showMessage(t('external.ignored', { name: tab.title }));
  }

  async function chooseFiles() {
    const paths = await window.fileAPI.openFileDialog(state.settings.defaultOpenPath || undefined);
    await openPaths(paths);
    if (paths?.[0]) await rememberOpenDialogDirectory(paths[0]);
  }
  async function chooseFolder() {
    const folder = await window.fileAPI.openFolderDialog(
      state.settings.defaultOpenPath || undefined,
    );
    if (folder) {
      await setWorkspace(folder);
      toggleSidebar(true);
      const filesTab = $('.toolbar-sidebar-tabs [data-view="files"]');
      if (filesTab && !filesTab.classList.contains('active')) filesTab.click();
    }
  }

  // Native dialogs do not expose the directory visited before cancellation.
  // Remember the last confirmed selection instead.
  async function rememberOpenDialogDirectory(filePath) {
    const directory = await window.fileAPI.dirname(filePath);
    if (!directory || directory === state.settings.defaultOpenPath) return;
    state.settings.defaultOpenPath = directory;
    await queueSettingsSave({ defaultOpenPath: directory });
  }

  async function setWorkspace(folder) {
    const revision = ++state.workspaceRevision;
    state.workspace = folder || '';
    $('#workspaceName').textContent = folder ? fileName(folder) : t('sidebar.noWorkspace');
    $('#workspaceHeading').dataset.tooltip = folder || t('sidebar.openFolder');
    await syncLocalResourceRoots();
    await window.fileAPI.setWorkspaceWatch(folder || undefined, state.settings.workspaceReadDepth);
    if (revision !== state.workspaceRevision) return;
    await refreshTree(revision);
    if (revision !== state.workspaceRevision) return;
    if (folder) {
      const recent = [
        folder,
        ...(state.settings.recentPaths || []).filter((item) => item !== folder),
      ].slice(0, 10);
      state.settings.recentPaths = recent;
      state.settings.defaultOpenPath = folder;
      await queueSettingsSave({ recentPaths: recent, defaultOpenPath: folder });
    } else {
      state.settings.defaultOpenPath = '';
      await queueSettingsSave({ defaultOpenPath: '' });
    }
    persistSession();
  }

  async function refreshTree(revision = state.workspaceRevision) {
    const root = $('#fileTree');
    const workspace = state.workspace;
    if (!workspace) {
      const button = document.createElement('button');
      button.id = 'openFolderEmpty';
      button.className = 'empty-action';
      button.textContent = t('sidebar.openFolder');
      button.onclick = chooseFolder;
      root.replaceChildren(button);
      return;
    }
    const content = document.createDocumentFragment();
    await appendDirectory(content, workspace, 0, new Set([workspace]));
    if (state.workspace !== workspace || revision !== state.workspaceRevision) return;
    root.replaceChildren(content);
    updateActiveTreeSelection();
    scheduleTreeNameEllipses();
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
    void queueSettingsSave({ workspaceTreeStates });
  }

  async function appendDirectory(container, dirPath, depth, ancestorPaths) {
    let entries;
    try {
      entries = await window.fileAPI.listDir(dirPath, state.workspace);
    } catch (error) {
      showMessage(ipcErrorMessage(error), true);
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
      row.innerHTML = `<span class="chevron">${entry.type === 'directory' ? '›' : ''}</span><span class="file-icon">${treeIcon(entry)}</span><span class="tree-name" data-full-name="${escapeHTML(entry.name)}" data-tooltip="${escapeHTML(entry.name)}">${escapeHTML(entry.name)}</span>`;
      if (entry.link) {
        row.classList.add('tree-link');
        row.dataset.linkStatus = entry.link.status;
        row.dataset.tooltip = t('workspace.linkTitle');
      }
      container.appendChild(row);
      row.addEventListener('contextmenu', (event) => showTreeMenu(event, entry, row));
      if (entry.type === 'file') row.addEventListener('click', () => openPath(entry.path));
      else {
        const children = document.createElement('div');
        children.className = 'tree-children';
        children.dataset.parentPath = entry.path;
        container.appendChild(children);
        const targetDepth = entry.link?.workspaceDepth ?? depth + 1;
        const createsLinkCycle =
          entry.link &&
          (entry.link.targetsWorkspaceRoot || ancestorPaths.has(entry.link.targetPath));
        if (entry.link?.status === 'outside-workspace' || createsLinkCycle) {
          const message = t(
            createsLinkCycle ? 'workspace.linkCycle' : 'workspace.linkOutsideWorkspace',
          );
          row.classList.add(
            'depth-limited',
            createsLinkCycle ? 'tree-link-cycle' : 'tree-link-outside',
          );
          row.querySelector('.chevron').textContent = '·';
          const notice = document.createElement('div');
          notice.className = 'tree-depth-notice';
          notice.textContent = message;
          children.classList.add('depth-limit');
          children.appendChild(notice);
          row.addEventListener('click', () => showMessage(message));
          continue;
        }
        const atDepthLimit = targetDepth >= state.settings.workspaceReadDepth;
        if (atDepthLimit) {
          row.classList.add('depth-limited');
          row.querySelector('.chevron').textContent = '·';
          const notice = document.createElement('div');
          notice.className = 'tree-depth-notice';
          notice.textContent = t('workspace.depthLimited');
          children.classList.add('depth-limit');
          children.appendChild(notice);
          row.addEventListener('click', () => showMessage(t('workspace.depthLimited')));
          continue;
        }
        row.addEventListener('click', async () => {
          const open = row.classList.toggle('expanded');
          row.querySelector('.chevron').textContent = open ? '⌄' : '›';
          row.setAttribute('aria-expanded', String(open));
          persistDirectoryExpansion(entry.path, open);
          if (open && !children.dataset.loaded) {
            children.dataset.loaded = 'true';
            await appendDirectory(
              children,
              entry.path,
              targetDepth,
              new Set([...ancestorPaths, entry.link?.targetPath || entry.path]),
            );
          }
          scheduleTreeNameEllipses();
        });
        row.setAttribute('aria-expanded', 'false');
        if (expandedWorkspacePaths().has(entry.path)) {
          row.classList.add('expanded');
          row.setAttribute('aria-expanded', 'true');
          row.querySelector('.chevron').textContent = '⌄';
          children.dataset.loaded = 'true';
          await appendDirectory(
            children,
            entry.path,
            targetDepth,
            new Set([...ancestorPaths, entry.link?.targetPath || entry.path]),
          );
        }
      }
    }
    scheduleTreeNameEllipses();
  }

  function closeContextMenu() {
    const menu = $('#contextMenu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.replaceChildren();
    contextMenuState = null;
  }

  function showContextMenu(event, items, menuState = null) {
    const menu = $('#contextMenu');
    closeAppMenu();
    closeContextMenu();
    contextMenuState = menuState;
    items.forEach((item) => {
      if (item.separator) {
        menu.appendChild(document.createElement('hr'));
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.contextAction = item.id || '';
      button.disabled = Boolean(item.disabled);
      const label = document.createElement('span');
      label.textContent = item.label;
      button.appendChild(label);
      if (item.shortcut) {
        const shortcut = document.createElement('small');
        shortcut.textContent = item.shortcut;
        button.appendChild(shortcut);
      }
      button.addEventListener('pointerdown', (pointerEvent) => {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
      });
      button.addEventListener('mousedown', (mouseEvent) => mouseEvent.preventDefault());
      button.addEventListener('click', (clickEvent) => {
        clickEvent.stopPropagation();
        const savedState = contextMenuState;
        closeContextMenu();
        if (!button.disabled) void item.action?.(savedState);
      });
      menu.appendChild(button);
    });
    menu.style.visibility = 'hidden';
    menu.classList.remove('hidden');
    const margin = 6;
    menu.style.left = `${Math.max(margin, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - margin))}px`;
    menu.style.visibility = '';
  }

  function editorShortcut(key) {
    const modifier = window.appAPI.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    return `${modifier}+${key}`;
  }

  function hasClipboardContent(clipboard) {
    return Boolean(String(clipboard?.text || '') || String(clipboard?.html || ''));
  }

  async function runEditorContextAction(menuState, action) {
    const { tab, mode, selection, table } = menuState || {};
    if (!tab?.ready || tab !== activeTab() || tab.vditor?.getCurrentMode() !== mode) return;
    if (!VDITOR.restoreEditorSelection(selection)) return;
    if (action === 'select-context') {
      VDITOR.selectCurrentContextOrAll(tab.host, mode);
      return;
    }
    if (action.startsWith('table-')) {
      VDITOR.performTableAction(table, action.slice('table-'.length), tab.vditor);
      return;
    }
    let clipboard = null;
    if (action === 'paste' || action === 'paste-plain')
      clipboard = await window.appAPI.readClipboard();
    VDITOR.executeEditorCommand(tab.host, mode, action, clipboard);
  }

  async function showEditorContextMenu(tab, event) {
    if (tab !== activeTab() || !tab.ready) return;
    const mode = tab.vditor?.getCurrentMode();
    if (!mode || !VDITOR.isEditableTarget(tab.host, mode, event.target)) return;
    const selection = VDITOR.captureEditorSelection(
      tab.host,
      mode,
      event.target,
      event.clientX,
      event.clientY,
    );
    if (!selection) return;
    event.preventDefault();
    event.stopPropagation();
    let clipboard = null;
    try {
      clipboard = await window.appAPI.readClipboard();
    } catch {
      // Keep paste disabled when the clipboard cannot be read safely.
    }
    const table = VDITOR.tableContext(tab.host, mode, event.target);
    const hasSelection = !selection.range.collapsed;
    const menuState = { tab, mode, selection, table };
    const action = (id, label, options = {}) => ({
      id,
      label: t(label),
      shortcut: options.shortcut,
      disabled: options.disabled,
      action: (state) => runEditorContextAction(state, id),
    });
    const items = [
      action('cut', 'context.cut', { shortcut: editorShortcut('X'), disabled: !hasSelection }),
      action('copy', 'context.copy', { shortcut: editorShortcut('C'), disabled: !hasSelection }),
      action('paste', 'context.paste', {
        shortcut: editorShortcut('V'),
        disabled: !hasClipboardContent(clipboard),
      }),
      action('paste-plain', 'context.pastePlain', {
        disabled: !hasClipboardContent(clipboard),
      }),
      action('delete', 'context.delete', { disabled: !hasSelection }),
      action('select-context', 'context.selectContext', { shortcut: editorShortcut('A') }),
    ];
    if (table) {
      items.push(
        { separator: true },
        action('table-insert-row', 'context.insertRow'),
        action('table-delete-row', 'context.deleteRow', { disabled: table.cell.tagName === 'TH' }),
        action('table-insert-column', 'context.insertColumn'),
        action('table-delete-column', 'context.deleteColumn'),
      );
    }
    showContextMenu(event, items, menuState);
  }

  function showTreeMenu(event, entry, row) {
    event.preventDefault();
    showContextMenu(event, [
      { label: t('context.rename'), action: () => renameExplorerItem(entry, row) },
      { label: t('context.trash'), action: () => deleteExplorerItem(entry) },
      { label: t('context.reveal'), action: () => window.appAPI.showItemInFolder(entry.path) },
    ]);
  }

  function treeContextParent(target) {
    const element = target instanceof Element ? target : null;
    return element?.closest('.tree-children')?.dataset.parentPath || state.workspace;
  }

  function showWorkspaceTreeMenu(event, parent = state.workspace) {
    event.preventDefault();
    const actions = [
      { label: t('context.changeWorkspace'), action: chooseFolder },
      {
        label: t('context.newFile'),
        action: () => createExplorerItem(parent, 'file'),
        disabled: !parent,
      },
      {
        label: t('context.newFolder'),
        action: () => createExplorerItem(parent, 'directory'),
        disabled: !parent,
      },
      {
        label: t('context.openWorkspace'),
        action: () => window.appAPI.openDirectory(state.workspace),
        disabled: !state.workspace,
      },
    ];
    showContextMenu(event, actions);
  }

  async function createExplorerItem(parent, type) {
    if (!parent) return;
    const number = await nextUntitledNumber(parent, type);
    const name = untitledItemName(number, type);
    try {
      const created = await window.fileAPI.createItem(parent, name, type);
      await refreshTree();
      if (type === 'file') await openPath(created);
    } catch (error) {
      showMessage(ipcErrorMessage(error), true);
    }
  }
  function renameExplorerItem(entry, row) {
    const label = row.querySelector('.tree-name');
    if (!label) return;
    const input = document.createElement('input');
    input.className = 'tree-rename-input';
    input.value = entry.name;
    label.replaceWith(input);
    let settled = false;
    let submitting = false;
    let affectedTabs = [];
    const finish = async (commit) => {
      if (settled || submitting) return;
      let name = input.value.trim();
      const extensionStart = entry.type === 'file' ? entry.name.lastIndexOf('.') : -1;
      if (extensionStart > 0) {
        const extension = entry.name.slice(extensionStart);
        const keepsExtension = name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase());
        const proposedExtensionStart = name.lastIndexOf('.');
        const stem = keepsExtension
          ? name.slice(0, -extension.length)
          : proposedExtensionStart > 0
            ? name.slice(0, proposedExtensionStart)
            : name;
        if (!stem) name = '';
        else name = `${stem}${extension}`;
      }
      if (!commit || !name || name === entry.name) {
        settled = true;
        if (input.isConnected) input.replaceWith(label);
        return;
      }
      submitting = true;
      settled = true;
      let fileSystemCommitted = false;
      const editorRebuilds = new Set();
      let settingsPlan = null;
      let settingsPersisted = false;
      try {
        const updates = await rebaseOpenTabs(entry.path, entry.path);
        affectedTabs = updates.map(({ tab }) => tab);
        const plannedDestination = await window.fileAPI.prepareRename(entry.path, name);
        const tabPlans = await Promise.all(
          updates.map(async ({ tab }) => {
            const nextPath = await window.fileAPI.rebasePath(
              entry.path,
              plannedDestination,
              tab.filePath,
            );
            if (!nextPath) throw new Error('Unable to rebase an open document during rename.');
            return {
              tab,
              nextPath,
              fileIdentity: await window.fileAPI.fileIdentity(nextPath),
              baseDir: await window.fileAPI.dirname(nextPath),
            };
          }),
        );
        settingsPlan = await rebasePathState(entry.path, plannedDestination);
        await suspendDocumentWatches(affectedTabs);
        const destination = await window.fileAPI.renameItem(entry.path, name);
        fileSystemCommitted = true;
        if (destination !== plannedDestination)
          throw new Error('The rename destination changed before the operation completed.');
        for (const { tab, nextPath, fileIdentity, baseDir } of tabPlans) {
          const previousBaseDir = tab.baseDir;
          tab.filePath = nextPath;
          tab.fileIdentity = fileIdentity;
          tab.title = fileName(nextPath);
          tab.baseDir = baseDir;
          if (previousBaseDir !== tab.baseDir) editorRebuilds.add(tab);
        }
        state.settings.recentFiles = settingsPlan.recentFiles;
        state.settings.workspaceTreeStates = settingsPlan.workspaceTreeStates;
        await syncLocalResourceRoots();
        await queueSettingsSave(settingsPlan, { throwOnFailure: true });
        settingsPersisted = true;
        await rebindDocumentWatches(affectedTabs);
        const rebuildFailures = rebuildRenamedEditors(editorRebuilds);
        if (rebuildFailures.length)
          throw new AggregateError(rebuildFailures, 'Unable to rebuild every renamed document.');
        renderTabs();
        await refreshTree();
        persistSession();
      } catch (error) {
        const failures = [error];
        try {
          await rebindDocumentWatches(affectedTabs);
        } catch (rebindError) {
          failures.push(rebindError);
        }
        if (fileSystemCommitted) {
          try {
            await syncLocalResourceRoots();
          } catch (resourceError) {
            failures.push(resourceError);
          }
          failures.push(...rebuildRenamedEditors(editorRebuilds));
          if (!settingsPersisted && settingsPlan) {
            try {
              await queueSettingsSave(settingsPlan, { throwOnFailure: true });
              settingsPersisted = true;
            } catch (settingsError) {
              failures.push(settingsError);
            }
          }
          renderTabs();
          try {
            await refreshTree();
          } catch (refreshError) {
            failures.push(refreshError);
          }
          try {
            await persistSession(true);
          } catch (sessionError) {
            failures.push(sessionError);
          }
        } else {
          try {
            await refreshTree();
          } catch (refreshError) {
            failures.push(refreshError);
          }
        }
        if (input.isConnected) input.replaceWith(label);
        showMessage(
          failures
            .map((failure) => ipcErrorMessage(failure))
            .filter(Boolean)
            .join(' '),
          true,
        );
      }
    };
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        void finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => void finish(true));
    input.focus();
    const extensionStart = entry.type === 'file' ? entry.name.lastIndexOf('.') : -1;
    input.setSelectionRange(0, extensionStart > 0 ? extensionStart : entry.name.length);
  }
  async function deleteExplorerItem(entry) {
    const proceed = await confirmDialog({
      message: t('workspace.delete', { name: entry.name }),
      draggable: true,
    });
    if (!proceed) return;
    let affectedTabs = [];
    try {
      for (const tab of state.tabs) {
        if (tab.filePath && (await window.fileAPI.rebasePath(entry.path, entry.path, tab.filePath)))
          affectedTabs.push(tab);
      }
      await suspendDocumentWatches(affectedTabs);
      await window.fileAPI.deleteItem(entry.path);
      for (const tab of affectedTabs) await preserveUnavailableTab(tab, 'deleted', tab.filePath);
      await rebindDocumentWatches(affectedTabs);
      renderTabs();
      updateActiveUI();
      persistSession();
      await refreshTree();
    } catch (error) {
      await rebindDocumentWatches(affectedTabs);
      showMessage(ipcErrorMessage(error), true);
    }
  }

  function scheduleOutline() {
    if (!$('#outlineView').classList.contains('active')) return;
    clearTimeout(state.outlineTimer);
    state.outlineTimer = setTimeout(renderOutline, 300);
  }
  function renderOutline() {
    if (!$('#outlineView').classList.contains('active')) return;
    const tab = activeTab();
    const target = $('#outlineTree');
    target.innerHTML = '';
    if (!tab) {
      target.innerHTML = `<div class="empty">${escapeHTML(t('sidebar.noDocument'))}</div>`;
      return;
    }
    const headings = VDITOR.outlineSnapshot(tab.host, tab.mode);
    if (!headings.length) {
      target.innerHTML = `<div class="empty">${escapeHTML(t('sidebar.noHeadings'))}</div>`;
      return;
    }
    const roots = [];
    const stack = [];
    headings.forEach((heading, index) => {
      const node = {
        ...heading,
        outlineIndex: index,
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
        const tooltip = t(
          tab.outlineCollapsed.has(node.key) ? 'outline.expand' : 'outline.collapse',
        );
        toggle.dataset.tooltip = tooltip;
        toggle.setAttribute('aria-label', tooltip);
        toggle.textContent = tab.outlineCollapsed.has(node.key) ? '›' : '⌄';
        toggle.onclick = () => {
          const collapsed = wrapper.classList.toggle('collapsed');
          if (collapsed) tab.outlineCollapsed.add(node.key);
          else tab.outlineCollapsed.delete(node.key);
          toggle.setAttribute('aria-expanded', String(!collapsed));
          const tooltip = t(collapsed ? 'outline.expand' : 'outline.collapse');
          toggle.dataset.tooltip = tooltip;
          toggle.setAttribute('aria-label', tooltip);
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
      button.onclick = () => scrollToOutlineHeading(tab, node.outlineIndex);
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
    scrollHeadingIntoContainer(scroller, heading);
  }
  function scrollHeadingIntoContainer(scroller, heading) {
    if (!scroller || !heading || !scroller.getClientRects().length) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const top = scroller.scrollTop + headingRect.top - scrollerRect.top - scroller.clientHeight / 6;
    VDITOR.animateDocumentNavigationScroll(scroller, top);
  }
  function scrollToHeading(tab, headingIndex) {
    VDITOR.headingTargets(tab.host, headingIndex).forEach(({ editor, heading }) => {
      scrollHeadingIntoEditor(editor, heading);
    });
  }
  function scrollToOutlineHeading(tab, headingIndex) {
    VDITOR.outlineHeadingTargets(tab.host, tab.mode, headingIndex).forEach(
      ({ scroller, heading }) => scrollHeadingIntoContainer(scroller, heading),
    );
  }

  function documentNavigationTooltip() {
    return t('link.followWithModifier', {
      modifier: window.appAPI.platform === 'darwin' ? 'Cmd' : 'Ctrl',
    });
  }

  function hasDocumentNavigationModifier(event) {
    return window.appAPI.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  }

  function isSupportedExternalLink(href) {
    try {
      return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol);
    } catch (_) {
      return false;
    }
  }

  function isPotentialRelativeMarkdownLink(href) {
    const rawPath = href.split('#', 1)[0].trim();
    if (!rawPath || rawPath.startsWith('/') || rawPath.startsWith('\\')) return false;
    if (/^[a-z][a-z\d+.-]*:/i.test(rawPath)) return false;
    try {
      return /\.(?:md|markdown|mdown|mkd|mkdn)$/i.test(decodeURIComponent(rawPath));
    } catch (_) {
      return false;
    }
  }

  function documentLinkTarget(tab, target) {
    const link = VDITOR.documentLink(target, tab.host);
    if (!link) return null;
    if (link.href.startsWith('#')) {
      const headingIndex = VDITOR.headingIndexForAnchor(tab.host, link.href);
      return headingIndex < 0 ? null : { link, headingIndex };
    }
    if (isSupportedExternalLink(link.href)) return { link, headingIndex: null, external: true };
    return isPotentialRelativeMarkdownLink(link.href)
      ? { link, headingIndex: null, external: false }
      : null;
  }

  function blockUnsupportedDocumentLinkNavigation(tab, event) {
    const link = VDITOR.documentLink(event.target, tab.host);
    if (!link || link.kind !== 'link') return false;
    // The main process protects normal navigations, but javascript: and other
    // active schemes can execute in the renderer without a will-navigate event.
    event.preventDefault();
    event.stopPropagation();
    VDITOR.expandInstantLinkForEditing(link);
    return true;
  }

  async function openRelativeMarkdownLink(tab, href) {
    if (!tab.filePath) {
      showMessage(t('message.linkSaveFirst'), true);
      return;
    }
    let resolution;
    try {
      resolution = await window.fileAPI.resolveMarkdownLink(tab.filePath, href);
    } catch (_) {
      showMessage(t('message.linkTargetMissing'), true);
      return;
    }
    if (resolution.kind !== 'resolved') {
      const key =
        resolution.code === 'not-found' ? 'message.linkTargetMissing' : 'message.linkUnsupported';
      showMessage(t(key), true);
      return;
    }
    await openPath(resolution.filePath, true, resolution.fragment);
  }

  function setHoveredDocumentLink(target, event) {
    if (hoveredDocumentLink?.link.element !== target.link.element) {
      clearHoveredDocumentLink();
      hoveredDocumentLink = target;
    }
    VDITOR.setDocumentLinkHint(
      target.link,
      documentNavigationTooltip(),
      hasDocumentNavigationModifier(event) ? 'pointer' : 'text',
    );
    showDocumentLinkTooltip(event);
  }

  function clearHoveredDocumentLink() {
    if (!hoveredDocumentLink) return;
    VDITOR.clearDocumentLinkHint(hoveredDocumentLink.link);
    hoveredDocumentLink = null;
    hideAppTooltip();
  }

  function updateHoveredDocumentLinkCursor(event) {
    if (!hoveredDocumentLink) return;
    VDITOR.setDocumentLinkHint(
      hoveredDocumentLink.link,
      documentNavigationTooltip(),
      hasDocumentNavigationModifier(event) ? 'pointer' : 'text',
    );
  }

  function showDocumentLinkTooltip(event) {
    showAppTooltip(documentNavigationTooltip(), event);
  }

  function hideAppTooltip() {
    $('#appTooltip').hidden = true;
  }

  function showAppTooltip(text, event) {
    const tooltip = $('#appTooltip');
    tooltip.textContent = text;
    tooltip.hidden = false;
    const left = Math.min(window.innerWidth - tooltip.offsetWidth - 8, event.clientX + 12);
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - tooltip.offsetHeight - 8, event.clientY + 18)}px`;
  }

  function setHoveredSidebarTooltip(target, event) {
    const text = target.dataset.tooltip;
    if (!text) return;
    hoveredSidebarTooltip = target;
    showAppTooltip(text, event);
  }

  function clearHoveredSidebarTooltip() {
    if (!hoveredSidebarTooltip) return;
    hoveredSidebarTooltip = null;
    hideAppTooltip();
  }

  function setupSidebarTooltips() {
    const sidebar = $('#sidebar');
    sidebar.addEventListener('mouseover', (event) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest('[data-tooltip]');
      if (!target || !sidebar.contains(target) || target.contains(event.relatedTarget)) return;
      setHoveredSidebarTooltip(target, event);
    });
    sidebar.addEventListener('mousemove', (event) => {
      if (hoveredSidebarTooltip) setHoveredSidebarTooltip(hoveredSidebarTooltip, event);
    });
    sidebar.addEventListener('mouseout', (event) => {
      if (!hoveredSidebarTooltip || hoveredSidebarTooltip.contains(event.relatedTarget)) return;
      clearHoveredSidebarTooltip();
    });
  }

  function setupDocumentAnchorNavigation(tab) {
    if (tab.host.dataset.anchorNavigation === 'true') return;
    tab.host.dataset.anchorNavigation = 'true';
    tab.host.addEventListener(
      'mouseover',
      (event) => {
        const target = documentLinkTarget(tab, event.target);
        if (target) setHoveredDocumentLink(target, event);
      },
      true,
    );
    tab.host.addEventListener(
      'mouseout',
      (event) => {
        if (!hoveredDocumentLink || hoveredDocumentLink.link.element.contains(event.relatedTarget))
          return;
        clearHoveredDocumentLink();
      },
      true,
    );
    tab.host.addEventListener(
      'mousemove',
      (event) => {
        if (hoveredDocumentLink) showDocumentLinkTooltip(event);
      },
      true,
    );
    tab.host.addEventListener(
      'click',
      (event) => {
        const target = documentLinkTarget(tab, event.target);
        if (!target) {
          blockUnsupportedDocumentLinkNavigation(tab, event);
          return;
        }
        setHoveredDocumentLink(target, event);
        if (hasDocumentNavigationModifier(event) || target.link.kind === 'toc') {
          event.preventDefault();
          event.stopPropagation();
        }
        if (hasDocumentNavigationModifier(event)) {
          if (target.headingIndex !== null) scrollToHeading(tab, target.headingIndex);
          else if (target.external) void window.appAPI.openExternal(target.link.href);
          else void openRelativeMarkdownLink(tab, target.link.href);
          return;
        }
        if (VDITOR.expandInstantLinkForEditing(target.link)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (target.link.kind === 'toc') VDITOR.focusDocumentLink(target.link);
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
      const message = ipcErrorMessage(error);
      showMessage(`图片保存失败：${message}`, true);
      return message;
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

  function exportBodySnapshot(tab) {
    return tab.vditor
      ? VDITOR.withOriginalImageSources(tab.host, () => tab.vditor.getHTML())
      : `<pre>${escapeHTML(tab.content)}</pre>`;
  }

  function portableExportSource(source, sourceBaseUrl, targetBaseUrl) {
    if (!source || source.startsWith('#')) return source;
    let resolved;
    try {
      resolved = new URL(source, sourceBaseUrl || 'https://vditor-export.invalid/');
    } catch (_) {
      return source;
    }
    if (resolved.protocol === 'app:') return null;
    if (resolved.protocol !== 'local-file:') return source;
    if (!targetBaseUrl) return null;
    return VDITOR.relativeSourceFromLocalUrl(resolved.href, targetBaseUrl) || null;
  }

  function normalizeExportBody(body, tab, outputDirectory = tab.baseDir) {
    const template = document.createElement('template');
    template.innerHTML = body;
    const sourceBaseUrl = localResourceBase(tab.baseDir);
    const targetBaseUrl = localResourceBase(outputDirectory);
    template.content.querySelectorAll('img[src], a[href]').forEach((element) => {
      const attribute = element.tagName === 'IMG' ? 'src' : 'href';
      const source = element.getAttribute(attribute) || '';
      const portableSource = portableExportSource(source, sourceBaseUrl, targetBaseUrl);
      if (portableSource === null) element.removeAttribute(attribute);
      else if (portableSource !== source) element.setAttribute(attribute, portableSource);
    });
    return template.innerHTML;
  }

  function imageMimeType(source) {
    const extension = source.split(/[?#]/, 1)[0].toLowerCase().split('.').pop();
    return (
      {
        apng: 'image/apng',
        avif: 'image/avif',
        gif: 'image/gif',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        png: 'image/png',
        svg: 'image/svg+xml',
        webp: 'image/webp',
      }[extension] || 'application/octet-stream'
    );
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    return btoa(binary);
  }

  async function embedExportImages(body, tab) {
    const baseUrl = localResourceBase(tab.baseDir);
    if (!baseUrl) return body;
    const template = document.createElement('template');
    template.innerHTML = body;
    const images = Array.from(template.content.querySelectorAll('img[src]'));
    await Promise.all(
      images.map(async (image) => {
        const source = image.getAttribute('src') || '';
        if (!source || source.startsWith('#')) return;
        let resolved;
        try {
          resolved = new URL(source, baseUrl);
        } catch (_) {
          return;
        }
        if (resolved.protocol !== 'local-file:') return;
        try {
          const response = await fetch(resolved.href);
          if (!response.ok) return;
          const blob = await response.blob();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const contentType = blob.type.startsWith('image/') ? blob.type : imageMimeType(source);
          image.setAttribute('src', `data:${contentType};base64,${bytesToBase64(bytes)}`);
        } catch (_) {
          // Keep the relative source when a local image cannot be read for PDF export.
        }
      }),
    );
    return template.innerHTML;
  }

  function makeExportHTML(tab, body = exportBodySnapshot(tab), outputDirectory = tab.baseDir) {
    const portableBody = normalizeExportBody(body, tab, outputDirectory);
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(stripExtension(tab.title))}</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#24292f}pre,code{font-family:ui-monospace,monospace}pre{padding:16px;overflow:auto;background:#f6f8fa}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:6px 12px}</style></head><body>${portableBody}</body></html>`;
  }
  async function exportHTML() {
    const tab = activeTab();
    if (!tab) return;
    const output = await window.fileAPI.exportDialog('html', `${stripExtension(tab.title)}.html`);
    if (output) {
      const outputDirectory = await window.fileAPI.dirname(output);
      await window.fileAPI.writeFile(
        output,
        makeExportHTML(tab, exportBodySnapshot(tab), outputDirectory),
      );
      showMessage(`已导出 ${output}`);
    }
  }
  async function exportPDF() {
    const tab = activeTab();
    if (!tab) return;
    const body = await embedExportImages(normalizeExportBody(exportBodySnapshot(tab), tab), tab);
    const output = await window.appAPI.exportPDF(
      makeExportHTML(tab, body),
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
    queueSettingsSave({ recentFiles: recent });
  }
  async function persistSession(throwOnFailure = false) {
    if (!state.settings) return false;
    const session = {
      workspacePath: state.settings.restoreWorkspace ? state.workspace : '',
      activeFilePath:
        state.settings.restoreTabs && !activeTab()?.externalFileState
          ? activeTab()?.filePath
          : null,
      openFiles: state.settings.restoreTabs
        ? state.tabs.map((tab) => (!tab.externalFileState ? tab.filePath : null)).filter(Boolean)
        : [],
    };
    state.settings.session = session;
    try {
      await queueSettingsSave({ session }, { throwOnFailure: true });
      return true;
    } catch (error) {
      if (throwOnFailure) throw error;
      console.error('Unable to persist the current session.', error);
      return false;
    }
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
    syncWorkspaceReadDepthValue();
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
    const numericSettingNames = new Set(['tabSize']);
    const previousSettings = state.settings;
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
          : input.type === 'number' ||
              input.type === 'range' ||
              input.name.endsWith('Zoom') ||
              numericSettingNames.has(input.name)
            ? Number(input.value)
            : input.value;
    });
    const appliedTheme = document.documentElement.dataset.theme || state.settings.theme;
    patch.systemTheme = previousSettings.systemTheme;
    patch.theme = previousSettings.systemTheme
      ? previousSettings.theme
      : isDarkTheme(appliedTheme)
        ? patch.darkTheme
        : patch.lightTheme;
    const dark = patch.systemTheme
      ? isDarkTheme(document.documentElement.dataset.theme)
      : isDarkTheme(patch.theme);
    const codePreferenceKey = dark ? 'darkCodeTheme' : 'lightCodeTheme';
    patch.lightCodeTheme = state.settings.lightCodeTheme;
    patch.darkCodeTheme = state.settings.darkCodeTheme;
    patch[codePreferenceKey] = patch.codeTheme;
    patch.toolbarConfig = state.settings.toolbarConfig;
    const previousWorkspaceReadDepth = state.settings.workspaceReadDepth;
    const previousLocale = state.locale;
    try {
      state.settings = await queueSettingsSave(patch, { throwOnFailure: true });
    } catch (error) {
      showMessage(ipcErrorMessage(error), true);
      return;
    }
    const changedSettings = Object.keys(patch).filter(
      (key) => JSON.stringify(previousSettings[key]) !== JSON.stringify(state.settings[key]),
    );
    const shouldRebuildEditors = changedSettings.some((key) =>
      VDITOR_INITIALIZATION_SETTINGS.has(key),
    );
    if (closeAfterSave) await closeSettings({ applyPresentation: false });
    applyLocale(state.settings.locale);
    if (state.workspace && previousWorkspaceReadDepth !== state.settings.workspaceReadDepth)
      await window.fileAPI.setWorkspaceWatch(state.workspace, state.settings.workspaceReadDepth);
    if (
      state.workspace &&
      (previousWorkspaceReadDepth !== state.settings.workspaceReadDepth ||
        previousLocale !== state.locale)
    )
      await refreshTree();
    applyPresentationSettings();
    await applyTheme(await resolveTheme());
    applyLiveVditorSettings(changedSettings);
    if (shouldRebuildEditors) {
      state.tabs.forEach((tab) => {
        tab.mode = openModes.get(tab.id) || tab.mode;
        rebuildEditor(tab);
      });
    }
    if (!state.tabs.length) {
      destroyToolbarPreview();
      createToolbarPreview();
    }
    showMessage(t('message.settingsSaved'));
  }

  async function resetCurrentSettingsPage() {
    const panel = $('[data-settings-panel].active');
    if (!panel || !state.defaultSettings) return;
    if (panel.dataset.settingsPanel === 'appearance') {
      state.settings.systemTheme = state.defaultSettings.systemTheme;
      state.settings.theme = state.defaultSettings.theme;
      state.settings.lightTheme = state.defaultSettings.lightTheme;
      state.settings.darkTheme = state.defaultSettings.darkTheme;
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
    if (panel.dataset.settingsPanel === 'files') syncWorkspaceReadDepthValue();
    if (panel.dataset.settingsPanel === 'appearance') {
      const appliedTheme = document.documentElement.dataset.theme || state.settings.theme;
      syncCodeThemeSelect(isDarkTheme(appliedTheme), preferredCodeTheme(isDarkTheme(appliedTheme)));
    }
    await saveSettings(false);
  }

  async function scheduleLiveSettingsSave(event) {
    const input = event.target;
    if (input.name === 'sanitize' && !input.checked && state.settings.sanitize) {
      const confirmed =
        (await showConfirmDialog({
          title: t('settings.sanitizeWarningTitle'),
          message: t('settings.sanitizeWarningMessage'),
          detail: t('settings.sanitizeWarningDetail'),
          actions: [
            { id: 'cancel', label: t('settings.keepHtmlFilter') },
            {
              id: 'confirm',
              label: t('settings.disableHtmlFilter'),
              primary: true,
              danger: true,
            },
          ],
          draggable: true,
        })) === 'confirm';
      if (!confirmed) {
        input.checked = true;
        return;
      }
    }
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

  function syncWorkspaceReadDepthValue() {
    const input = $('#settingsForm [name="workspaceReadDepth"]');
    const output = $('#workspaceReadDepthValue');
    if (input && output) output.textContent = input.value;
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
    void queueSettingsSave({ settingsDialogSize });
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
      syncTopControlsWidth();
    });
  }

  function setupConfirmDialogDrag() {
    const modal = $('#confirmModal');
    const card = $('.confirm-card', modal);
    const header = card.querySelector(':scope > header');
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const setPosition = (left, top) => {
      const maximumLeft = Math.max(0, modal.clientWidth - card.offsetWidth);
      const maximumTop = Math.max(0, modal.clientHeight - card.offsetHeight);
      card.style.left = `${Math.round(clamp(left, 0, maximumLeft))}px`;
      card.style.top = `${Math.round(clamp(top, 0, maximumTop))}px`;
    };

    header.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || !card.classList.contains('confirm-card-draggable')) return;
      event.preventDefault();
      const modalBounds = modal.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      card.style.position = 'absolute';
      setPosition(cardBounds.left - modalBounds.left, cardBounds.top - modalBounds.top);
      const offsetX = event.clientX - cardBounds.left;
      const offsetY = event.clientY - cardBounds.top;
      document.body.classList.add('confirm-card-dragging');
      const move = (moveEvent) => {
        setPosition(
          moveEvent.clientX - modalBounds.left - offsetX,
          moveEvent.clientY - modalBounds.top - offsetY,
        );
      };
      const up = () => {
        document.body.classList.remove('confirm-card-dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    window.addEventListener('resize', () => {
      if (card.style.position !== 'absolute') return;
      setPosition(Number.parseFloat(card.style.left) || 0, Number.parseFloat(card.style.top) || 0);
    });
  }

  async function handleExternalChange(change) {
    if (
      !['add', 'change', 'unlink', 'addDir', 'unlinkDir', 'unreadable', 'watch-error'].includes(
        change.event,
      )
    )
      return;
    if (change.scope === 'workspace') {
      if (change.event === 'watch-error') {
        showMessage(t('workspace.watchResourceLimit'), true);
        return;
      }
      if (change.event === 'unlink' || change.event === 'unlinkDir') {
        const affectedTabs = await rebaseOpenTabs(change.path, change.path);
        for (const { tab } of affectedTabs)
          await preserveUnavailableTab(tab, 'deleted', tab.filePath);
        if (affectedTabs.length) {
          renderTabs();
          updateActiveUI();
          persistSession();
        }
      }
      if (
        (change.event === 'unlink' || change.event === 'unlinkDir') &&
        state.workspace &&
        normalizedFilePath(change.path) === normalizedFilePath(state.workspace) &&
        !(await window.fileAPI.exists(state.workspace))
      ) {
        await setWorkspace('');
        return;
      }
      if (!state.treeTimer)
        state.treeTimer = setTimeout(() => {
          state.treeTimer = null;
          void refreshTree(state.workspaceRevision);
        }, 300);
      return;
    }
    const documentIdentity = change.identity || (await window.fileAPI.fileIdentity(change.path));
    const tabs = state.tabs.filter((tab) => tabFileIdentity(tab) === documentIdentity);
    for (const tab of tabs) {
      if (change.event === 'unlink') {
        await preserveUnavailableTab(tab, 'deleted', change.path);
        continue;
      }
      if (change.event === 'unreadable') {
        await preserveUnavailableTab(tab, 'unreadable', change.path, change.error);
        continue;
      }
      if (typeof change.content !== 'string') continue;
      if (tab.externalFileState) {
        clearTimeout(tab.saveTimer);
        tab.externalConflict = null;
        tab.externalChangeIgnored = false;
        tab.externalFileState = {
          kind: 'reappeared',
          path: change.path,
          identity: documentIdentity,
          content: change.content,
          encoding: change.encoding || tab.encoding,
          clipboardContent: tab.externalFileState.clipboardContent,
          detectedAt: Date.now(),
          version: tab.externalFileState.version + 1,
        };
        continue;
      }
      if (change.content === tab.expectedSavedContent) {
        tab.externalConflict = null;
        tab.externalChangeIgnored = false;
        continue;
      }
      if (tab.filePath && !tab.modified && !tab.externalChangeIgnored) {
        if (typeof change.content !== 'string') continue;
        tab.lineEnding = detectLineEnding(change.content);
        tab.content = tab.savedContent = tab.expectedSavedContent = change.content;
        tab.encoding = change.encoding || tab.encoding;
        tab.externalConflict = null;
        tab.externalChangeIgnored = false;
        if (tab.vditor) tab.vditor.setValue(change.content, true);
        if (tab.id === state.activeId) updateActiveUI();
        showMessage(t('external.reloaded', { name: tab.title }));
        continue;
      }
      clearTimeout(tab.saveTimer);
      tab.externalConflict = {
        kind: 'modified',
        path: change.path,
        identity: documentIdentity,
        content: change.content,
        encoding: change.encoding || tab.encoding,
        detectedAt: Date.now(),
        version: (tab.externalConflict?.version || 0) + 1,
      };
      tab.externalChangeIgnored = false;
    }
    renderTabs();
    updateExternalChangeBanner(activeTab());
    updateExternalFileStateBanner(activeTab());
    persistSession();
  }

  function handleMenu(action, value) {
    const handlers = {
      new: newTab,
      open: chooseFiles,
      'open-folder': chooseFolder,
      save: () => saveTab(),
      'save-as': () => saveTab(activeTab(), true),
      'close-tab': () => activeTab() && closeTab(activeTab().id),
      find: openFind,
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
      },
      theme: async () => {
        state.settings.theme = value;
        state.settings.systemTheme = false;
        if (isDarkTheme(value)) state.settings.darkTheme = value;
        else state.settings.lightTheme = value;
        await queueSettingsSave({
          theme: value,
          systemTheme: false,
          ...(isDarkTheme(value) ? { darkTheme: value } : {}),
          ...(!isDarkTheme(value) ? { lightTheme: value } : {}),
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
    const currentEditorMode = () => {
      const tab = activeTab();
      return tab?.vditor && tab.ready
        ? tab.vditor.getCurrentMode()
        : tab?.mode || state.settings.editMode;
    };
    const menus = {
      main: () => [
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
        {
          label: 'menu.editMode',
          disabled: () => !activeTab(),
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
              'menu.layoutStatusbar',
              () => $('#app').classList.toggle('statusbar-hidden'),
              '',
              () => !$('#app').classList.contains('statusbar-hidden'),
            ],
          ],
        },
        null,
        ['menu.settings', run('settings'), 'Ctrl+,'],
        null,
        ['menu.quit', run('quit'), 'Ctrl+Q'],
      ],
    };
    let reopenMenuOnHover = false;
    const close = () => {
      $$('.app-menu-popup').forEach((popup) => popup.remove());
      $$('.app-menu-bar button').forEach((b) => b.classList.remove('active'));
      $('#windowTitlebar').classList.remove('app-menu-open');
      reopenMenuOnHover = false;
    };
    closeAppMenu = close;
    const fillPopup = (popup, items) => {
      items.forEach((item) => {
        if (!item) {
          popup.appendChild(document.createElement('hr'));
          return;
        }
        const button = document.createElement('button');
        if (item.children) {
          button.className = 'has-submenu';
          button.disabled = item.disabled ? item.disabled() : false;
          button.innerHTML = `<span><i class="checkmark"></i>${escapeHTML(t(item.label))}</span>`;
          const openSubmenu = (event) => {
            if (button.disabled) return;
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
          const disabled = item[4] ? item[4]() : false;
          const checked = disabled ? null : item[3] ? item[3]() : null;
          button.disabled = disabled;
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
    if (part !== 'toolbar') return;
    state.settings.toolbarVisible = state.settings.toolbarVisible === false;
    $('#app').classList.toggle('toolbar-hidden', !state.settings.toolbarVisible);
    queueSettingsSave({ toolbarVisible: state.settings.toolbarVisible });
  }

  function syncTopControlsWidth() {
    const app = $('#app');
    const sidebar = $('#sidebar');
    const menu = $('#appMenuBar');
    const actions = $('.titlebar-file-actions');
    if (
      !app ||
      !sidebar ||
      !menu ||
      !actions ||
      sidebar.classList.contains('collapsed') ||
      app.classList.contains('sidebar-transitioning')
    )
      return;
    const appLeft = app.getBoundingClientRect().left;
    const sidebarWidth = sidebar.getBoundingClientRect().right - appLeft;
    applyTopControlsWidth(sidebarWidth, menu.getBoundingClientRect().width);
  }

  function syncToolbarWrapHeight() {
    const app = $('#app');
    const mount = $('#vditorToolbarMount');
    const toolbar = activeTab()?.toolbar || state.toolbarPreview?.toolbar;
    const hidden = app.classList.contains('toolbar-hidden');
    // Vditor menus are absolutely positioned but contribute to scrollHeight.
    // Only the toolbar's rendered box represents wrapped control rows.
    const toolbarHeight =
      !hidden && toolbar?.parentElement === mount ? toolbar.getBoundingClientRect().height : 0;
    if (toolbarHeight) state.toolbarWrapHeight = Math.max(0, Math.ceil(toolbarHeight - 38));
    const extraHeight = app.classList.contains('toolbar-unavailable')
      ? state.toolbarWrapHeight
      : hidden
        ? 0
        : Math.max(0, Math.ceil(toolbarHeight - 38));
    app.classList.toggle('toolbar-wrapped', extraHeight > 0);
    app.style.setProperty('--toolbar-wrap-height', `${extraHeight}px`);
  }

  function applyTopControlsWidth(sidebarWidth, menuWidth) {
    const app = $('#app');
    const actions = $('.titlebar-file-actions');
    app.style.setProperty('--top-controls-width', `${sidebarWidth}px`);
    app.style.setProperty('--sidebar-current', `${sidebarWidth}px`);
    actions.style.flexBasis = `${Math.max(0, sidebarWidth - menuWidth)}px`;
  }

  function sidebarMinimumWidth() {
    const appLeft = $('#app').getBoundingClientRect().left;
    const saveRight = $('#saveFile').getBoundingClientRect().right;
    const actionStyle = getComputedStyle($('.titlebar-file-actions'));
    return Math.ceil(
      saveRight -
        appLeft +
        parseFloat(actionStyle.paddingRight) +
        parseFloat(actionStyle.borderRightWidth),
    );
  }

  function finishSidebarTransition() {
    const sidebar = $('#sidebar');
    clearTimeout(sidebarTransitionTimer);
    sidebarTransitionTimer = undefined;
    if (sidebarTransitionEndHandler) {
      sidebar.removeEventListener('transitionend', sidebarTransitionEndHandler);
      sidebarTransitionEndHandler = undefined;
    }
    $('#app').classList.remove('sidebar-transitioning');
    syncTopControlsWidth();
  }

  function toggleSidebar(force) {
    const visible =
      typeof force === 'boolean' ? force : $('#sidebar').classList.contains('collapsed');
    const app = $('#app');
    const sidebar = $('#sidebar');
    const wasVisible = !sidebar.classList.contains('collapsed');
    if (wasVisible === visible) {
      state.settings.sidebarVisible = visible;
      $('#toggleSidebar')?.setAttribute('aria-pressed', String(visible));
      syncTopControlsWidth();
      return;
    }
    finishSidebarTransition();
    app.classList.add('sidebar-transitioning');
    if (visible) {
      const menuWidth = $('#appMenuBar').getBoundingClientRect().width;
      applyTopControlsWidth(state.settings.sidebarWidth, menuWidth);
    } else {
      $('.titlebar-file-actions').style.flexBasis = 'auto';
    }
    sidebar.classList.toggle('collapsed', !visible);
    app.classList.toggle('sidebar-collapsed', !visible);
    state.settings.sidebarVisible = visible;
    $('#toggleSidebar')?.setAttribute('aria-pressed', String(visible));
    queueSettingsSave({ sidebarVisible: visible });
    sidebarTransitionEndHandler = (event) => {
      if (event.target !== sidebar || event.propertyName !== 'width') return;
      finishSidebarTransition();
    };
    sidebar.addEventListener('transitionend', sidebarTransitionEndHandler);
    sidebarTransitionTimer = setTimeout(finishSidebarTransition, 220);
  }

  function setupEvents() {
    setupAppMenus();
    window.appAPI.onOpenFiles((paths) => void openPaths(paths));
    $('#windowMinimize').onclick = () => window.appAPI.minimize();
    $('#windowMaximize').onclick = () => window.appAPI.maximize();
    $('#windowClose').onclick = () => window.appAPI.closeWindow();
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
    $('#findToggleReplace').onclick = toggleReplace;
    $('#findPrevious').onclick = () => moveFindMatch(-1);
    $('#findNext').onclick = () => moveFindMatch(1);
    $('#findClose').onclick = closeFind;
    $('#externalReload').onclick = () => void reloadExternalChange(activeTab());
    $('#externalSaveAs').onclick = () => void saveTab(activeTab(), true);
    $('#externalOverwrite').onclick = () => void confirmExternalOverwrite(activeTab());
    $('#externalIgnore').onclick = () => ignoreExternalChange(activeTab());
    $('#externalFileReload').onclick = () => void reloadReappearedFile(activeTab());
    $('#externalFileSaveAs').onclick = () => void saveTab(activeTab(), true);
    $('#externalFileKeepUntitled').onclick = () => void keepExternalFileAsUntitled(activeTab());
    $('#externalFileRecreate').onclick = () => void confirmExternalFileRecreate(activeTab());
    $('#externalFileClose').onclick = () => void confirmExternalFileClose(activeTab());
    $('#recoverySave').onclick = () => void saveRecoveredVersion(activeTab());
    $('#recoverySaveAs').onclick = () => void saveRecoveredAs(activeTab());
    $('#recoveryDiscard').onclick = () => void discardRecoveredVersion(activeTab());
    $('#replaceOne').onclick = replaceFindMatch;
    $('#replaceAll').onclick = replaceAllFindMatches;
    $('#findInput').addEventListener('input', () => {
      const queryChanged = $('#findInput').value !== findQuery;
      refreshFind({ preserveIndex: !queryChanged, reveal: false });
      clearTimeout(findRefreshTimer);
      findRefreshTimer = setTimeout(() => {
        if (findWidgetVisible() && $('#findInput').value === findQuery) revealFindMatch();
      }, 120);
    });
    $('#findWidget').addEventListener('focusout', () => {
      requestAnimationFrame(() => {
        if (findWidgetVisible() && !$('#findWidget').contains(document.activeElement)) {
          $('#findInput').focus({ preventScroll: true });
        }
      });
    });
    window.addEventListener(
      'keydown',
      (event) => {
        if (!findWidgetVisible() || !$('#findWidget').contains(event.target)) return;
        event.stopImmediatePropagation();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void saveTab();
        } else if (event.key === 'F3') {
          event.preventDefault();
          moveFindMatch(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Enter' && event.target === $('#findInput')) {
          event.preventDefault();
          moveFindMatch(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Enter' && event.target === $('#replaceInput')) {
          event.preventDefault();
          replaceFindMatch();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeFind();
        }
      },
      true,
    );
    $('#emptyNewFile').onclick = newTab;
    $('#emptyOpenFile').onclick = chooseFiles;
    $('#toggleSidebar').onclick = () => toggleSidebar();
    $('#statusMode').onclick = (event) => {
      event.stopPropagation();
      toggleStatusModeMenu();
    };
    $('#statusMode').onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleStatusModeMenu();
    };
    $('#statusModeMenu').onclick = (event) => {
      const button = event.target.closest('[data-status-mode]');
      if (!button) return;
      event.stopPropagation();
      selectStatusMode(button.dataset.statusMode);
    };
    $('#statusSettings').onclick = openSettings;
    $('#statusThemeMode').onclick = (event) => {
      event.stopPropagation();
      toggleStatusThemeMenu();
    };
    $('#statusThemeMenu').onclick = (event) => {
      const button = event.target.closest('[data-theme-mode]');
      if (!button) return;
      event.stopPropagation();
      void selectStatusThemeMode(button.dataset.themeMode);
    };
    $('#refreshTree').onclick = refreshTree;
    $('#fileTree').addEventListener('contextmenu', (event) => {
      if (event.target.closest('.tree-row, button')) return;
      showWorkspaceTreeMenu(event, treeContextParent(event.target));
    });
    $('#workspaceHeading').onclick = () => {
      if (!state.workspace) chooseFolder();
    };
    $('#openFolderEmpty').onclick = chooseFolder;
    $$('.toolbar-sidebar-tabs button').forEach(
      (button) =>
        (button.onclick = () => {
          $$('.toolbar-sidebar-tabs button').forEach((item) =>
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
    $('#settingsForm [name="workspaceReadDepth"]').oninput = syncWorkspaceReadDepthValue;
    $('#resetSettings').onclick = async () => {
      if (await confirmDialog({ message: t('confirm.resetSettings') })) {
        state.settings = await window.appAPI.resetSettings();
        applyLocale(state.settings.locale);
        openSettings();
      }
    };
    setupSettingsDrag();
    setupConfirmDialogDrag();
    $('#openSettingsFolder').onclick = async () =>
      window.appAPI.showItemInFolder(await window.appAPI.getSettingsPath());
    $$('[data-external]').forEach((button) => {
      button.onclick = () => window.appAPI.openExternal(button.dataset.external);
    });
    document.addEventListener('click', () => {
      closeStatusModeMenu();
      closeStatusThemeMenu();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('#contextMenu')) closeContextMenu();
    });
    $('.app-menu-bar > button[data-menu="main"]')?.addEventListener(
      'mousemove',
      updateMainMenuGlow,
      { passive: true },
    );
    document.addEventListener(
      'pointerdown',
      (event) => updateEditorSelectionActivity(event.target),
      true,
    );
    document.addEventListener(
      'focusin',
      (event) => updateEditorSelectionActivity(event.target, true),
      true,
    );
    document.addEventListener('keydown', updateHoveredDocumentLinkCursor, true);
    document.addEventListener('keyup', updateHoveredDocumentLinkCursor, true);
    document.addEventListener(
      'keydown',
      (event) => {
        const tableCellSelection = selectedTableCellForBackspace(event);
        pendingTableCellSelection = tableCellSelection
          ? { event, selection: tableCellSelection }
          : null;
        if ((event.ctrlKey || event.metaKey) && selectEditorContextOrAll(event)) return;
      },
      true,
    );
    window.addEventListener('blur', () => {
      editorSelectionActive = false;
      closeContextMenu();
      closeStatusModeMenu();
      closeStatusThemeMenu();
      clearHoveredDocumentLink();
    });
    document.addEventListener('keydown', (event) => {
      if (pendingTableCellSelection?.event === event) {
        const { selection } = pendingTableCellSelection;
        pendingTableCellSelection = null;
        if (!event.defaultPrevented)
          VDITOR.selectTableCellContents(selection.cell, selection.editor);
      }
      if (event.key === 'Escape' && !$('#contextMenu').classList.contains('hidden')) {
        event.preventDefault();
        closeContextMenu();
        return;
      }
      if (event.key === 'Escape' && !$('#confirmModal').classList.contains('hidden')) {
        event.preventDefault();
        closeConfirmDialog('cancel');
        return;
      }
      if (event.key === 'Escape' && !$('#statusModeMenu').classList.contains('hidden')) {
        event.preventDefault();
        closeStatusModeMenu();
        $('#statusMode').focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Escape' && !$('#statusThemeMenu').classList.contains('hidden')) {
        event.preventDefault();
        closeStatusThemeMenu();
        $('#statusThemeMode').focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Escape' && !$('#settingsModal').classList.contains('hidden')) {
        event.preventDefault();
        void closeSettings();
        return;
      }
      if (event.key === 'Alt' && $('#app').classList.contains('fullscreen')) {
        event.preventDefault();
        $('#app').classList.toggle('fullscreen-menu-visible');
        return;
      }
      if (event.key === 'Escape') $('#app').classList.remove('fullscreen-menu-visible');
      if (event.key === 'Escape' && findWidgetVisible()) {
        event.preventDefault();
        closeFind();
        return;
      }
      if (event.key === 'F3' && findWidgetVisible()) {
        event.preventDefault();
        moveFindMatch(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === 'F11') {
        event.preventDefault();
        window.appAPI.toggleFullscreen();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        if (selectEditorContextOrAll(event)) return;
        if (!keepsNativeSelectAll(event.target)) event.preventDefault();
        return;
      }
      if (key === 'i' && event.shiftKey) {
        event.preventDefault();
        window.appAPI.toggleDevTools();
      } else if (key === 's') {
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
      } else if (key === 'f') {
        event.preventDefault();
        openFind();
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
    let resizeMinimum = 0;
    let resizeMenuWidth = 0;
    let resizeAppLeft = 0;
    const startSidebarResize = () => {
      resizing = true;
      resizeMinimum = sidebarMinimumWidth();
      resizeMenuWidth = $('#appMenuBar').getBoundingClientRect().width;
      resizeAppLeft = $('#app').getBoundingClientRect().left;
      $('#app').style.setProperty('--sidebar-min-width', `${resizeMinimum}px`);
      document.body.classList.add('resizing');
    };
    resize.onmousedown = startSidebarResize;
    window.addEventListener('mousemove', (event) => {
      if (resizing) {
        const width = Math.max(resizeMinimum, Math.min(500, event.clientX - resizeAppLeft));
        $('#sidebar').style.width = `${width}px`;
        applyTopControlsWidth(width, resizeMenuWidth);
        state.settings.sidebarWidth = width;
      }
    });
    window.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        document.body.classList.remove('resizing');
        scheduleTreeNameEllipses();
        syncTopControlsWidth();
        queueSettingsSave({ sidebarWidth: state.settings.sidebarWidth });
      }
    });
    new ResizeObserver(() => {
      if (!resizing) scheduleTreeNameEllipses();
    }).observe($('#sidebar'));
    new ResizeObserver(scheduleTreeNameEllipses).observe($('#fileTree'));
    const topControlsObserver = new ResizeObserver(() => {
      if (!resizing) syncTopControlsWidth();
    });
    topControlsObserver.observe($('#sidebar'));
    topControlsObserver.observe($('#appMenuBar'));
    const toolbarMount = $('#vditorToolbarMount');
    new ResizeObserver(syncToolbarWrapHeight).observe(toolbarMount);
    new MutationObserver(() => requestAnimationFrame(syncToolbarWrapHeight)).observe(toolbarMount, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['hidden', 'style'],
    });
    syncToolbarWrapHeight();
    setupAutoHideScrollbar($('#fileTree'));
    setupAutoHideScrollbar($('#outlineTree'));
    setupSidebarTooltips();
    setupAutoHideScrollbar($('#settingsForm'));
    setupAutoHideScrollbar($('#tabBar'));
    setupTabWheelScrolling($('#tabBar'));
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
      const unresolvedFileState = state.tabs.find((tab) => tab.externalFileState);
      if (unresolvedFileState) {
        switchTab(unresolvedFileState.id);
        showMessage(t('external.resolveFileStateBeforeSave'), true);
        return;
      }
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
      } else {
        await Promise.all(dirty.map((tab) => discardRecoverySnapshot(tab)));
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
    const minimumSidebarWidth = sidebarMinimumWidth();
    state.settings.sidebarWidth = Math.max(
      minimumSidebarWidth,
      Number(state.settings.sidebarWidth) || minimumSidebarWidth,
    );
    $('#app').style.setProperty('--sidebar-min-width', `${minimumSidebarWidth}px`);
    $('#sidebar').style.width = `${state.settings.sidebarWidth}px`;
    $('#app').style.setProperty('--sidebar-current', `${state.settings.sidebarWidth}px`);
    toggleSidebar(state.settings.sidebarVisible);
    $('#app').classList.toggle('fullscreen', await window.appAPI.isFullscreen());
    updateMaximizedState(await window.appAPI.isMaximized());
    applyPresentationSettings();
    await applyTheme(await resolveTheme());
    $('#settingsPath').textContent = await window.appAPI.getSettingsDisplayPath();
    const info = await window.appAPI.getInfo();
    $('#statusVersion').textContent = `v${info.app}`;
    $('#versionInfo').textContent = `Version ${info.app} · Electron ${info.electron}`;
    const session = state.settings.session;
    if (state.settings.restoreWorkspace && session?.workspacePath) {
      if (await window.fileAPI.exists(session.workspacePath))
        await setWorkspace(session.workspacePath);
      else await setWorkspace('');
    }
    if (state.settings.restoreTabs && session?.openFiles?.length) {
      await openPaths(session.openFiles);
      const active = state.tabs.find((tab) => tab.filePath === session.activeFilePath);
      if (active) switchTab(active.id);
    }
    await restoreRecoverySnapshots();
    if (!state.tabs.length) {
      createToolbarPreview();
      updateActiveUI();
    }
    syncTopControlsWidth();
    await persistSession();
    document.body.dataset.appReady = 'true';
    window.appAPI.rendererReady();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
