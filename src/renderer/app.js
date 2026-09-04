(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const VDITOR = window.VditorDesktopAdapter;
  const PURE = window.__vditorDesktopPureFunctions;
  const escapeHTML = PURE.escapeHTML;
  const fileName = PURE.fileName;
  const stripExtension = PURE.stripExtension;
  const detectLineEnding = PURE.detectLineEnding;
  const isDarkTheme = PURE.isDarkTheme;
  const THEME_MODES = PURE.THEME_MODES;
  const translateImpl = PURE.translate;
  const formatIpcErrorMessageImpl = PURE.formatIpcErrorMessage;
  const resolveThemeModeImpl = PURE.resolveThemeMode;
  const validateDarkThemeImpl = PURE.validateDarkTheme;
  const validateLightThemeImpl = PURE.validateLightTheme;
  const getPreferredCodeThemeImpl = PURE.getPreferredCodeTheme;
  const AppStore = PURE.AppStore;
  const store = new AppStore();
  const PERSISTENT_STATE_KEYS = new Set([
    'defaultOpenPath',
    'recentPaths',
    'recentFiles',
    'workspaceTreeStates',
    'sidebarWidth',
    'sidebarVisible',
    'toolbarVisible',
    'windowBounds',
    'windowMaximized',
    'settingsDialogSize',
    'session',
  ]);
  const state = {
    get tabs() {
      return store.getState().documents;
    },
    get activeId() {
      return store.getState().activeDocumentId;
    },
    set activeId(id) {
      store.setActiveDocument(id);
    },
    toolbarPreview: null,
    get workspace() {
      return store.getState().workspacePath;
    },
    get settings() {
      return store.getState().settings;
    },
    set settings(settings) {
      store.updateSettings(settings);
    },
    get defaultSettings() {
      return store.getState().defaultSettings;
    },
    set defaultSettings(settings) {
      store.updateDefaultSettings(settings);
    },
    get locale() {
      return store.getState().locale;
    },
    set locale(locale) {
      store.updateLocale(locale);
    },
    untitledCounters: {
      file: 0,
      directory: 0,
    },
    get workspaceRevision() {
      return store.getState().workspaceRevision;
    },
    toolbarWrapHeight: 0,
  };
  const RUNTIME_TAB_FIELDS = [
    'vditor',
    'ready',
    'host',
    'toolbar',
    'lineObserver',
    'lineResizeObserver',
    'lineNumberFrame',
    'whitespaceFrame',
    'bottomSpacerObserver',
    'outlineCollapsed',
    'resourceObserver',
    'splitResizer',
    'pendingAnchor',
    'pendingEditorContent',
    'pendingScroll',
    'editorRuntimeGeneration',
  ];

  // Legacy collaborators still receive a tab-shaped object during the migration.
  // Keep runtime handles non-enumerable and physically separate from document data.
  function linkRuntimeTab(tab) {
    for (const field of RUNTIME_TAB_FIELDS) {
      Object.defineProperty(tab, field, {
        configurable: true,
        enumerable: false,
        get: () => tab.runtime[field],
        set: (value) => {
          tab.runtime[field] = value;
        },
      });
    }
    return tab;
  }

  function updateTabDocument(tab, updates) {
    store.updateDocument(tab.id, updates);
  }
  const tabController = new PURE.TabController({
    tabBar: $('#tabBar'),
    addTab: $('#addTab'),
    getAttentionTitle: (tab) => t('external.needsAttention', { name: tab.title }),
    getCloseTitle: () => t('tab.close'),
    callbacks: {
      activate: (id) => switchTab(id),
      close: (id) => void closeTab(id),
      move: (id, beforeId, placeAfter) => {
        store.moveDocument(id, beforeId, placeAfter);
        renderTabs();
        void persistSession();
      },
    },
  });
  const documentController = new PURE.DocumentController({
    fileBridge: {
      fileIdentity: (filePath) => window.fileAPI.fileIdentity(filePath),
      readFile: (filePath) => window.fileAPI.readFile(filePath),
      dirname: (filePath) => window.fileAPI.dirname(filePath),
    },
    findDocumentByIdentity: (fileIdentity) =>
      fileIdentity ? state.tabs.find((tab) => tab.fileIdentity === fileIdentity) || null : null,
    findDocumentByPath: (filePath) => {
      const normalizedPath = normalizedFilePath(filePath);
      return (
        state.tabs.find(
          (tab) => !tab.filePath && normalizedFilePath(tabTargetPath(tab)) === normalizedPath,
        ) || null
      );
    },
    prepareDocumentResources: (baseDir) => syncLocalResourceRoots([baseDir]),
    createDocument: ({
      filePath,
      title,
      content,
      encoding,
      baseDir,
      activate,
      pendingAnchor,
      fileIdentity,
    }) =>
      createTab({
        filePath,
        title,
        content,
        encoding,
        baseDir,
        activate,
        pendingAnchor,
        fileIdentity,
      }),
    onExistingDocument: (tab, { filePath, fileIdentity, activate, pendingAnchor }) => {
      if (!tab.filePath) {
        editorController.beginExternalChange(tab);
        store.setExternalConflict(tab.id, {
          kind: 'modified',
          path: filePath,
          identity: fileIdentity,
          detectedAt: Date.now(),
          version: (tab.externalConflict?.version || 0) + 1,
        });
        store.setExternalChangeIgnored(tab.id, false);
        renderTabs();
      }
      if (activate) switchTab(tab.id);
      if (pendingAnchor) {
        store.updateDocumentRuntime(tab.id, { pendingAnchor });
        requestAnimationFrame(() => scrollToPendingAnchor(tab));
      }
    },
    onDocumentOpened: async (tab) => {
      await watchTabDocument(tab);
      rememberRecent(tab.filePath);
    },
    onDocumentNotCreated: () => syncLocalResourceRoots(),
    readDocumentContent: (tab) => editorController.currentContent(tab),
  });
  const editorController = new PURE.EditorController({
    adapter: {
      editorScrollContainer: (host, mode) => VDITOR.editorScrollContainer(host, mode),
      setBottomSpacer: (host, height) => VDITOR.setEditorBottomSpacer(host, height),
      observeOutlineChanges: (host, callback) => VDITOR.observeOutlineChanges(host, callback),
      preserveTableScrollDuringInput: (host, getMode) =>
        VDITOR.preserveTableScrollDuringInput(host, getMode),
      scrollContainers: (host) => VDITOR.scrollContainers(host),
      installScrollEnhancement: setupAutoHideScrollbar,
    },
    createOptions: (tab, generation) => editorOptions(tab, generation),
    getActiveDocumentId: () => state.activeId,
    onAvailabilityChanged: (tab) => {
      if (tab.id === state.activeId || tab.toolbarPreview) syncToolbarAvailability();
    },
    onBeforeDestroy: (tab, _disposeTabResources) => {
      if (contextMenuState?.tab === tab) closeContextMenu();
      imageRuntimeController.detach(tab);
      splitViewController.dispose(tab);
      restoreEditorToolbar(tab);
    },
    onCreationFailure: (tab, error) => {
      const message = error instanceof Error ? error.message : String(error);
      tab.host.innerHTML = `<div class="fatal"><h2>Editor initialization failed</h2><p>${escapeHTML(message)}</p></div>`;
      showMessage(message, true);
    },
    onModeChanged: (tab) => {
      if (tab.id === state.activeId) updateActiveUI();
      scheduleSplitLineNumbers(tab);
    },
    readContent: (tab) => {
      try {
        return tab.vditor && tab.ready
          ? VDITOR.withOriginalImageSources(tab.host, () => tab.vditor.getValue())
          : tab.content;
      } catch (_) {
        return tab.content;
      }
    },
    readRuntimeContent: (tab) => {
      try {
        return VDITOR.withOriginalImageSources(
          tab.host,
          () => tab.vditor?.getValue() ?? tab.content,
        );
      } catch (_) {
        return tab.content;
      }
    },
    updateDocument: (tab, updates) => updateTabDocument(tab, updates),
  });
  const recoveryRuntimeController = new PURE.RecoveryRuntimeController({
    createSnapshotId: recoveryId,
    saveSnapshot: async (tab) => window.appAPI.saveRecovery(recoverySnapshotFor(tab)),
    discardSnapshot: async (id) => window.appAPI.discardRecovery(id),
    onFailure: (operation) => {
      console.error(
        operation === 'save'
          ? 'Unable to save a recovery snapshot.'
          : 'Unable to remove a recovery snapshot.',
      );
    },
    updateRecoveryState: (tab, updates) => updateTabDocument(tab, updates),
  });
  const recoveryBannerController = new PURE.RecoveryBannerController({
    banner: $('#recoveryBanner'),
    message: $('#recoveryMessage'),
    detail: $('#recoveryDetail'),
    saveButton: $('#recoverySave'),
    saveAsButton: $('#recoverySaveAs'),
    discardButton: $('#recoveryDiscard'),
    getActiveTab: activeTab,
    translate: t,
    onSave: (tab) => void saveTab(tab),
    onSaveAs: (tab) => void saveTab(tab, true),
    onDiscard: (tab) => void closeTab(tab.id, { discard: true }),
  });
  const outlineController = new PURE.OutlineController({
    view: $('#outlineView'),
    tree: $('#outlineTree'),
    getActiveTab: () => activeTab(),
    getSnapshot: (tab) => VDITOR.outlineSnapshot(tab.host, tab.mode),
    scrollToHeading: (tab, index) => scrollToOutlineHeading(tab, index),
    translate: (key) => t(key),
  });
  const findController = new PURE.FindController({
    widget: $('#findWidget'),
    input: $('#findInput'),
    replaceInput: $('#replaceInput'),
    replaceRow: $('#replaceRow'),
    toggleReplace: $('#findToggleReplace'),
    count: $('#findCount'),
    getActiveRuntime: () => {
      const tab = activeTab();
      if (!tab?.vditor || !tab.ready) return null;
      return {
        id: tab.id,
        content: currentContent(tab),
        host: tab.host,
        mode: tab.vditor.getCurrentMode() || tab.mode,
        focus: () => tab.vditor?.focus(),
      };
    },
    adapter: {
      revealTextMatch: (host, mode, query, occurrence) =>
        VDITOR.revealTextMatch(host, mode, query, occurrence),
      selectTextMatch: (host, mode, query, occurrence) =>
        VDITOR.selectTextMatch(host, mode, query, occurrence),
      replaceTextMatch: (host, mode, query, occurrence, replacement) =>
        VDITOR.replaceTextMatch(host, mode, query, occurrence, replacement),
      clearFindHighlights: () => VDITOR.clearFindHighlights(),
    },
    onSave: () => void saveTab(),
  });
  const imageController = new PURE.ImageController({
    fileBridge: {
      dirname: (filePath) => window.fileAPI.dirname(filePath),
      writeBinaryFile: (filePath, bytes) => window.fileAPI.writeBinaryFile(filePath, bytes),
      relative: (from, to) => window.fileAPI.relative(from, to),
    },
    getAssetsDirectory: () => state.settings.pasteImagesDir || './assets',
    getMaximumWidth: () => state.settings.imageMaxWidth,
    getQuality: () => state.settings.imageQuality,
    onError: (message) => showMessage(message, true),
    formatError: ipcErrorMessage,
    saveFirstMessage: () => t('message.imageSaveFirst'),
    uploadFailedMessage: (error) => t('message.imageSaveFailed', { error }),
  });
  const imageRuntimeController = new PURE.ImageRuntimeController({
    localResourceBase,
    adapter: {
      observeRelativeImageSources: (host, baseUrl) =>
        VDITOR.observeRelativeImageSources(host, baseUrl),
      reloadImageSources: (host) => VDITOR.reloadImageSources(host),
    },
  });
  const toolbarController = new PURE.ToolbarController({
    app: $('#app'),
    mount: $('#vditorToolbarMount'),
    mainArea: $('.main-area'),
    getActiveRuntime: () => activeTab(),
    getPreviewRuntime: () => state.toolbarPreview,
    findRuntimeByToolbar: (toolbar) => state.tabs.find((tab) => tab.toolbar === toolbar) || null,
    getMountedToolbar: () => $('#vditorToolbarMount').querySelector(VDITOR.selectors.toolbar),
  });
  const editorRuntimeCoordinator = new PURE.EditorRuntimeCoordinator({
    getTab: (id) => state.tabs.find((tab) => tab.id === id) || null,
    getTabs: () => state.tabs,
    getActiveTab: () => activeTab(),
    getActiveDocumentId: () => state.activeId,
    closeContextMenu,
    restoreToolbar: restoreEditorToolbar,
    activateDocument: (id) => {
      state.activeId = id;
    },
    syncToolbarAvailability,
    ensureEditor,
    updateBottomSpacer: (tab) => editorController.updateBottomSpacer(tab),
    scrollToPendingAnchor,
    mountToolbar: mountEditorToolbar,
    scheduleSplitLineNumbers,
    renderTabs,
    updateActiveUI,
    onOutlineRuntimeChanged: renderOutline,
    onFindRuntimeChanged: () => findController.onRuntimeChanged(),
    persistSession: () => void persistSession(),
  });
  const workspaceController = new PURE.WorkspaceController({
    store,
    fileAPI: window.fileAPI,
    getSettings: () => state.settings,
    saveSettings: async (updates) => {
      state.settings = await queueSettingsSave(updates, { throwOnFailure: true });
    },
    renderWorkspace: (workspacePath) => {
      $('#workspaceName').textContent = workspacePath
        ? fileName(workspacePath)
        : t('sidebar.noWorkspace');
      $('#workspaceHeading').dataset.tooltip = workspacePath || t('sidebar.openFolder');
    },
    syncLocalResourceRoots: () => syncLocalResourceRoots(),
    requestTreeRefresh: async (revision) => {
      await explorerController.refresh(revision);
      await reconcileRenamedOpenDocuments();
    },
    persistSession: () => void persistSession(),
    onWorkspacePathUnavailable: async (event) => {
      const affectedTabs = await rebaseOpenTabs(event.path, event.path);
      for (const { tab } of affectedTabs)
        await documentController.transitionBindings({
          prepare: async () => tab,
          commit: async (document) =>
            preserveUnavailableTab(document, 'deleted', document.filePath),
        });
      if (affectedTabs.length) {
        renderTabs();
        updateActiveUI();
        void persistSession();
      }
    },
    isWorkspaceAvailable: (workspacePath) => window.fileAPI.exists(workspacePath),
    onWorkspaceWatchError: () => showMessage(t('workspace.watchResourceLimit'), true),
  });
  const explorerController = new PURE.ExplorerController({
    store,
    fileAPI: window.fileAPI,
    fileTree: $('#fileTree'),
    getSettings: () => state.settings,
    translate: t,
    treeIcon,
    openPath: async (filePath) => {
      await openPath(filePath);
    },
    chooseWorkspace: chooseFolder,
    showMessage,
    showContextMenu: (event, items) => showContextMenu(event, items),
    renameEntry: renameExplorerItem,
    deleteEntry: deleteExplorerItem,
    revealEntry: (filePath) => window.appAPI.showItemInFolder(filePath),
    createEntry: createExplorerItem,
    openWorkspaceInFolder: (workspacePath) => window.appAPI.openDirectory(workspacePath),
    saveExpansion: (workspacePath, expandedPaths) => {
      const previous = state.settings.workspaceTreeStates || [];
      const workspaceTreeStates = [
        { workspacePath, expandedPaths },
        ...previous.filter((item) => item.workspacePath !== workspacePath),
      ].slice(0, 20);
      state.settings.workspaceTreeStates = workspaceTreeStates;
      void queueSettingsSave({ workspaceTreeStates });
    },
    updateActiveSelection: updateActiveTreeSelection,
  });
  const splitViewController = new PURE.SplitViewController({
    getContent: (tab) => VDITOR.editorParts(tab.host).content,
    getSource: (tab) => VDITOR.editorParts(tab.host).source,
    ensureResizer: (tab) => VDITOR.ensureSplitResizer(tab.host),
    getVisibility: (tab, mode) => VDITOR.splitViewVisibility(tab.host, mode),
    getRatio: () => state.settings.splitRatio,
    setRatio: (ratio) => {
      state.settings.splitRatio = ratio;
    },
    persistRatio: () => void queueSettingsSave({ splitRatio: state.settings.splitRatio }),
    onLayoutChanged: (tab) => scheduleSplitLineNumbers(tab),
    refreshLineNumbers: (tab) => updateSplitLineNumbers(tab),
    shouldDeferLineNumberResize: () => $('#app').classList.contains('sidebar-transitioning'),
    syncScroll: (tab) => VDITOR.syncSplitDecorationScroll(tab.host),
    installScrollEnhancement: (tab) => setupAutoHideScrollbar(VDITOR.editorParts(tab.host).source),
    installAutoIndent: (tab) =>
      VDITOR.installSplitAutoIndent(tab.host, () => state.settings.autoIndent),
    captureIndentSelection: (tab) => VDITOR.captureSplitIndentSelection(tab.host),
    applyIndent: (tab, type, range) => VDITOR.applySplitListIndent(tab.host, type, range),
  });
  let resourceRootsQueue = Promise.resolve();
  let settingsSaveQueue = Promise.resolve();
  const LOCALES = window.VditorDesktopLocales || {};
  const notifications = new PURE.NotificationsController(translateImpl, LOCALES, 'en_US');
  const settingsController = new PURE.SettingsController({
    store,
    save: (patch) => queueSettingsSave(patch, { throwOnFailure: true }),
  });
  const settingsWindow = new PURE.SettingsWindow({
    modal: $('#settingsModal'),
    onClosed: (applyPresentation) => {
      if (applyPresentation) applyPresentationSettings();
    },
  });
  const localizationController = new PURE.LocalizationController({
    store,
    locales: LOCALES,
    navigatorLanguage: () => navigator.language,
    onLocaleApplied: (locale) => {
      notifications.setLocale(locale);
      if (state.workspace) {
        $('#workspaceName').textContent = fileName(state.workspace);
        $('#workspaceHeading').dataset.tooltip = state.workspace;
      }
      if ($('#appMenuBar')?.dataset.ready === 'true') setupAppMenus();
      renderTabs();
      updateActiveUI();
      outlineController.onRuntimeChanged();
    },
  });
  const windowController = new PURE.WindowController({
    appAPI: window.appAPI,
    titlebar: $('#windowTitlebar'),
    minimize: $('#windowMinimize'),
    maximize: $('#windowMaximize'),
    close: $('#windowClose'),
    onFullscreenChanged: (fullscreen) => {
      $('#app').classList.toggle('fullscreen', fullscreen);
      if (!fullscreen) $('#app').classList.remove('fullscreen-menu-visible');
      state.tabs.forEach((tab) => scheduleSplitLineNumbers(tab));
    },
    onMaximizedChanged: (maximized) => updateMaximizedState(maximized),
  });
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
  const VDITOR_INITIALIZATION_SETTINGS = PURE.VDITOR_INITIALIZATION_SETTINGS;
  let appMenuCloseHandler;
  let closeAppMenu = () => {};
  let appMenuBlurHandler;
  let settingsSaveTimer;
  let sidebarTransitionTimer;
  let sidebarTransitionEndHandler;
  let sidebarLayoutAnimations = [];
  let hoveredDocumentLink = null;
  let hoveredSidebarTooltip = null;
  let editorSelectionActive = false;
  let pendingTableCellSelection = null;
  let contextMenuState = null;
  const contextMenuController = new PURE.ContextMenuController($('#contextMenu'), () =>
    closeAppMenu(),
  );

  function t(key, params = {}) {
    return translateImpl(LOCALES, state.locale, key, params);
  }

  function ipcErrorMessage(error) {
    return formatIpcErrorMessageImpl(error, LOCALES, state.locale);
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
    return notifications.closeConfirmDialog(action);
  }

  function showConfirmDialog(options) {
    return notifications.showConfirmDialog(options);
  }

  async function confirmDialog(options) {
    return notifications.confirmDialog(options);
  }

  function showUnsavedDialog(message, detail = '') {
    return notifications.showUnsavedDialog(message, detail);
  }

  function applyLocale(locale) {
    localizationController.apply(locale);
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

  function syncToolbarAvailability(shouldSyncWrapHeight = true) {
    const mount = $('#vditorToolbarMount');
    if (!mount) return;
    const owner = activeTab() || state.toolbarPreview;
    const available = Boolean(
      owner?.ready && owner.toolbar && owner.toolbar.parentElement === mount,
    );
    // Vditor inserts its toolbar into the editor host before invoking after().
    // Keep a non-interactive Desktop skeleton in the shared row until Desktop
    // owns that node, so the editor geometry never jumps during the hand-off.
    mount.dataset.toolbarPending = String(!available);
    mount.setAttribute('aria-busy', String(!available));
    if (shouldSyncWrapHeight) syncToolbarWrapHeight();
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
    const filePath = tab.filePath;
    const fileIdentity = await window.fileAPI.fileIdentity(filePath);
    if (!state.tabs.includes(tab) || tab.filePath !== filePath) return;
    updateTabDocument(tab, { fileIdentity });
    await window.fileAPI.watchDocument(filePath, true);
    if (!state.tabs.includes(tab) || tab.filePath !== filePath || tab.fileIdentity !== fileIdentity)
      await releaseDocumentWatch(filePath, fileIdentity);
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

  async function reconcileExternallyRenamedDocument(change) {
    if (!change.identity || !change.previousPath) return false;
    const tabs = state.tabs.filter((tab) => tabFileIdentity(tab) === change.identity);
    if (!tabs.length) return false;
    const plans = await Promise.all(
      tabs.map(async (tab) => ({
        tab,
        filePath: change.path,
        fileIdentity: await window.fileAPI.fileIdentity(change.path),
        baseDir: await window.fileAPI.dirname(change.path),
      })),
    );
    await suspendDocumentWatches(tabs);
    try {
      await documentController.transitionBindings({
        prepare: async () => plans,
        commit: async (bindings) => {
          bindings.forEach(({ tab, filePath, fileIdentity, baseDir }) => {
            updateTabDocument(tab, {
              filePath,
              fileIdentity,
              title: fileName(filePath),
              baseDir,
              externalFileState: null,
            });
          });
        },
      });
      const settingsPlan = await rebasePathState(change.previousPath, change.path);
      state.settings.recentFiles = settingsPlan.recentFiles;
      state.settings.workspaceTreeStates = settingsPlan.workspaceTreeStates;
      await queueSettingsSave(settingsPlan, { throwOnFailure: true });
      await syncLocalResourceRoots();
      await rebindDocumentWatches(tabs);
      const rebuildFailures = rebuildRenamedEditors(new Set(tabs));
      if (rebuildFailures.length)
        throw new AggregateError(rebuildFailures, 'Unable to rebuild renamed document editors.');
      renderTabs();
      updateActiveUI();
      persistSession();
      return true;
    } catch (error) {
      try {
        await rebindDocumentWatches(tabs);
      } catch (rebindError) {
        console.error('Unable to restore document watchers after an external rename.', rebindError);
      }
      showMessage(ipcErrorMessage(error), true);
      return false;
    }
  }

  async function reconcileRenamedOpenDocuments() {
    for (const tab of [...state.tabs]) {
      if (!tab.filePath || (await window.fileAPI.exists(tab.filePath))) continue;
      const previousPath = tab.filePath;
      const identity = tabFileIdentity(tab);
      const renamedPath = await window.fileAPI.resolveRenamedDocument(previousPath);
      if (!identity || !renamedPath) continue;
      await reconcileExternallyRenamedDocument({
        event: 'rename',
        path: renamedPath,
        previousPath,
        identity,
        scope: 'workspace',
      });
    }
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

  function showMessage(message, error = false) {
    notifications.showMessage(message, error);
  }

  function showTemporaryDocumentNotice(message, error = false) {
    notifications.showTemporaryDocumentNotice(message, error);
  }

  function darkThemePreference() {
    return validateDarkThemeImpl(state.settings.darkTheme);
  }

  function lightThemePreference() {
    return validateLightThemeImpl(state.settings.lightTheme);
  }

  function mapSystemTheme(theme) {
    return theme === 'dark' ? darkThemePreference() : lightThemePreference();
  }

  function preferredCodeTheme(dark) {
    return getPreferredCodeThemeImpl(state.settings, dark);
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
    document.querySelectorAll('link[id^="theme-"]').forEach((link) => {
      link.disabled = link.id !== `theme-${theme}`;
    });
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
    if (tab) splitViewController.scheduleLineNumbers(tab);
  }

  function observeSplitLineNumbers(tab) {
    splitViewController.observeLineNumbers(tab);
  }

  function syncSplitViewLayout(tab) {
    if (!tab?.vditor || !tab.ready) return;
    return splitViewController.syncLayout(tab, tab.vditor.getCurrentMode());
  }

  function ensureSplitResizer(tab) {
    splitViewController.attach(tab);
  }

  function updateSplitLineNumbers(tab) {
    if (!tab || !tab.vditor || !tab.ready) return;
    syncSplitViewLayout(tab);
    VDITOR.renderSplitDecorations(
      tab.host,
      tab.vditor.getCurrentMode(),
      state.settings.showWhitespace,
      state.settings.tabSize,
    );
  }

  function setupSplitEditorEnhancements(tab) {
    splitViewController.activate(tab);
  }

  function setupAutoHideScrollbar(element) {
    if (!element || element.dataset.autoHideScrollbar === 'true') return null;
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
    const onMouseMove = (event) => {
      const rect = element.getBoundingClientRect();
      if (rect.right - event.clientX <= 14) reveal();
    };
    element.addEventListener('scroll', reveal, { passive: true });
    element.addEventListener('mousemove', onMouseMove);
    return () => {
      clearTimeout(timer);
      element.removeEventListener('scroll', reveal);
      element.removeEventListener('mousemove', onMouseMove);
      element.classList.remove('scrollbar-visible', 'app-scrollbar');
      delete element.dataset.autoHideScrollbar;
    };
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

  function editorOptions(tab, runtimeGeneration) {
    const s = state.settings;
    const wasModified = tab.modified;
    // Resolve Markdown-relative resources before Vditor inserts their DOM nodes.
    // Doing this in the adapter observer is too late to prevent an initial app:// request.
    return PURE.createEditorOptions(tab, {
      settings: s,
      locale: state.locale,
      appTheme: document.documentElement.dataset.theme || s.theme,
      defaultToolbar: DEFAULT_TOOLBAR,
      placeholder: t('editor.placeholder'),
      isDarkTheme,
      localResourceBase,
      onUpload: handleImageUpload,
      callbacks: {
        after: () => {
          if (!editorController.isCurrent(tab, runtimeGeneration)) return;
          const contract = VDITOR.validateHost(tab.host);
          if (!contract.valid) {
            tab.ready = false;
            tab.host.dataset.editorReady = 'false';
            console.error('Unsupported Vditor DOM contract:', contract.missing);
            showMessage(`Vditor integration mismatch: ${contract.missing.join(', ')}`, true);
            return;
          }
          tab.host.dataset.contentTheme = state.settings.contentTheme;
          imageRuntimeController.attach(tab);
          editorController.observeOutlineChanges(tab, () => {
            if (tab.id === state.activeId) scheduleOutline();
          });
          setupDocumentAnchorNavigation(tab);
          const splitSource = VDITOR.editorParts(tab.host).source;
          editorController.installScrollEnhancements(tab, splitSource);
          editorController.preserveTableScrollDuringInput(tab);
          editorController.reconcileInitializedContent(tab, wasModified);
          tab.ready = true;
          tab.toolbar = VDITOR.editorParts(tab.host).toolbar;
          VDITOR.hideNativeOutlineControl(tab.toolbar);
          VDITOR.keepSplitToolbarActionsAvailable(tab.toolbar);
          editorController.attachToolbarHandlers(tab, tab.toolbar, {
            onClick: (event) => handleVditorToolbarClick(tab, event),
            onMouseDown: (event) => preserveSplitToolbarSelection(tab, event),
          });
          // Vditor initialization may finish after the user changes the application theme.
          // Read the current theme here so the late callback cannot restore stale menu filters.
          const currentAppTheme = document.documentElement.dataset.theme || state.settings.theme;
          syncCodeThemeControls(isDarkTheme(currentAppTheme), state.settings.codeTheme);
          if (tab.id === state.activeId || tab.toolbarPreview) mountEditorToolbar(tab);
          // Vditor may still be mutating the new document here. Its toolbar move
          // is observed below, so defer measuring it until layout settles instead
          // of forcing a full-document style calculation in this callback.
          syncToolbarAvailability(false);
          if (tab.toolbarPreview) {
            disableToolbarPreview(tab);
            syncToolbarWrapHeight();
            return;
          }
          renderTabs();
          updateActiveUI(false, false);
          observeSplitLineNumbers(tab);
          editorController.observeBottomSpacer(tab);
          ensureSplitResizer(tab);
          setupSplitEditorEnhancements(tab);
          scheduleSplitLineNumbers(tab);
          editorController.scheduleFocus(tab);
          restoreEditorScroll(tab);
          requestAnimationFrame(() => scrollToPendingAnchor(tab));
        },
        input: (value) => {
          if (editorController.isCurrent(tab, runtimeGeneration)) onEditorInput(tab, value);
        },
        blur: (value) => {
          if (editorController.isCurrent(tab, runtimeGeneration))
            updateTabDocument(tab, { content: value });
        },
      },
    });
  }

  function preserveSplitToolbarSelection(tab, event) {
    const { type } = VDITOR.toolbarContext(event.target);
    if (tab.vditor?.getCurrentMode() === 'sv' && (type === 'outdent' || type === 'indent')) {
      event.preventDefault();
      splitViewController.preserveIndentSelection(tab);
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
      splitViewController.applyToolbarIndent(tab, type);
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
    return editorController.ensure(tab);
  }

  function restoreEditorScroll(tab) {
    editorController.restoreScroll(tab, () => scheduleSplitLineNumbers(tab));
  }

  function synchronizeVditorMode(tab) {
    if (tab) editorController.synchronizeMode(tab);
  }

  function prepareVditorModeTransition(tab, targetMode) {
    if (!tab) return false;
    closeContextMenu();
    return editorController.prepareModeTransition(tab, targetMode, () =>
      scheduleSplitLineNumbers(tab),
    );
  }

  function handleVditorModeShortcut(tab, event) {
    if (handleVditorPasteShortcut(tab, event)) return;
    const targetMode = VDITOR.editModeShortcut(event);
    if (!targetMode || !tab?.vditor || !tab.ready) return;
    const currentMode = tab.vditor.getCurrentMode();
    if (!VDITOR.isEditableTarget(tab.host, currentMode, event.target)) return;
    prepareVditorModeTransition(tab, targetMode);
  }

  function handleVditorPasteShortcut(tab, event) {
    const usesPlatformModifier =
      window.appAPI.platform === 'darwin'
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
    if (
      !usesPlatformModifier ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== 'v' ||
      !tab?.vditor ||
      !tab.ready
    )
      return false;
    const mode = tab.vditor.getCurrentMode();
    if (!VDITOR.isEditableTarget(tab.host, mode, event.target)) return false;
    const selection = VDITOR.captureEditorSelection(tab.host, mode, event.target);
    if (!selection) return false;
    const vditor = tab.vditor;
    event.preventDefault();
    event.stopImmediatePropagation();
    void window.appAPI
      .readClipboard()
      .then((clipboard) => {
        if (
          tab !== activeTab() ||
          !tab.ready ||
          tab.vditor !== vditor ||
          tab.vditor.getCurrentMode() !== mode ||
          !VDITOR.restoreEditorSelection(selection)
        )
          return;
        VDITOR.executeEditorCommand(tab.host, mode, 'paste', clipboard);
      })
      .catch(() => {
        // The native shortcut must remain a no-op when the privileged clipboard
        // read fails; do not leak the IPC error into the editor surface.
      });
    return true;
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
    return editorController.rebuild(tab, mode);
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
    const tab = linkRuntimeTab({
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
      mode,
      externalConflict: null,
      externalChangeIgnored: false,
      externalFileState: null,
      recoverySnapshotId,
      recoveryState,
      recoveryRevision: 0,
      runtime: {
        vditor: null,
        ready: false,
        host: document.createElement('section'),
        toolbar: null,
        lineObserver: null,
        lineResizeObserver: null,
        lineNumberFrame: null,
        whitespaceFrame: null,
        bottomSpacerObserver: null,
        outlineCollapsed: new Set(),
        resourceObserver: null,
        splitResizer: null,
        pendingAnchor,
        pendingEditorContent: false,
      },
    });
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
    editorController.attachModeShortcut(tab, (event) => handleVditorModeShortcut(tab, event));
    editorController.attachContextMenu(tab, (event) => showEditorContextMenu(tab, event));
    $('#editorArea').appendChild(tab.host);
    store.addDocument(tab);
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
      return await documentController.openPath(filePath, activate, pendingAnchor);
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
    documentController.createUntitled(t('tab.untitled', { number }));
  }

  function switchTab(id) {
    editorRuntimeCoordinator.activate(id);
  }

  async function closeTab(id, { discard = false } = {}) {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    const wasActive = state.activeId === id;
    if (contextMenuState?.tab === tab) closeContextMenu();
    const index = state.tabs.indexOf(tab);
    await documentController.close(tab, {
      confirmClose: () => confirmTabClose(tab, discard),
      disposeRuntime: () => disposeClosedTabRuntime(tab),
      removeDocument: () => store.removeDocument(tab.id),
      afterClose: () => finishClosingTab(tab, index, wasActive),
    });
  }

  async function confirmTabClose(tab, discard) {
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
      return action === 'confirm';
    } else if (tab.modified && !discard) {
      const action = await showUnsavedDialog(
        t('confirm.closeDirty', { title: tab.title }),
        t('confirm.closeDirtyDetail'),
      );
      return action !== 'cancel' && (action !== 'save' || (await saveTab(tab)));
    }
    return true;
  }

  async function disposeClosedTabRuntime(tab) {
    await discardRecoverySnapshot(tab);
    editorController.destroy(tab);
    tab.host.remove();
  }

  async function finishClosingTab(tab, index, wasActive) {
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
    } else if (wasActive) switchTab(state.tabs[Math.max(0, index - 1)].id);
    else {
      renderTabs();
      updateEmptyState();
      persistSession();
    }
  }

  function renderTabs() {
    tabController.render(
      state.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        filePath: tab.filePath,
        modified: tab.modified,
        needsAttention: Boolean(tab.externalConflict || tab.externalFileState),
      })),
      state.activeId,
    );
  }

  function onEditorInput(tab, value) {
    editorController.applyInput(tab, value);
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
      editorController.scheduleAutoSave(tab, state.settings.autoSaveDelay, () => void saveTab(tab));
    }
  }

  function currentContent(tab) {
    return editorController.currentContent(tab);
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
    return documentController.save(tab, () =>
      performSaveTab(tab, saveAs, overwriteConflict, recreateFileState),
    );
  }

  function queueSettingsSave(settings, { throwOnFailure = false } = {}) {
    const persistentState = {};
    const preferences = {};
    Object.entries(settings).forEach(([key, value]) => {
      if (PERSISTENT_STATE_KEYS.has(key)) persistentState[key] = value;
      else preferences[key] = value;
    });
    const previous = settingsSaveQueue;
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        if (Object.keys(preferences).length) {
          const savedPreferences = await window.appAPI.saveSettings(preferences);
          // The settings bridge returns an AppSettings-shaped snapshot for compatibility, but its
          // persistent-state fields are defaults after the TOML/state.json split. Only merge the
          // preference keys that this request actually wrote so current state.json data survives.
          const confirmedPreferences = Object.fromEntries(
            Object.keys(preferences).map((key) => [key, savedPreferences[key]]),
          );
          state.settings = { ...state.settings, ...confirmedPreferences };
        }
        if (Object.keys(persistentState).length) {
          const savedState = await window.appAPI.savePersistentState(persistentState);
          state.settings = { ...state.settings, ...savedState };
        }
        return state.settings;
      });
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
    // A queued autosave can begin after close removed this document from the
    // Store. Do not let that stale transaction write its former file binding.
    if (!tab || !state.tabs.includes(tab)) return false;
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
    const fileState = tab.externalFileState;
    // Decide before entering the identity queue: the confirmation's accepted action creates a
    // fresh save transaction for this same identity, which must not wait on itself.
    if (
      saveAs &&
      fileState?.identity === destinationIdentity &&
      recreateFileState !== fileState.version
    )
      return confirmExternalFileRecreate(tab, (version) =>
        performSaveTab(tab, false, null, version, queuedIdentity, destination),
      );
    if (queuedIdentity !== destinationIdentity) {
      return documentController.saveForIdentity(destinationIdentity, () =>
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
    const writesUnavailablePath = Boolean(fileState && fileState.identity === destinationIdentity);
    if (writesUnavailablePath && recreateFileState !== fileState.version) {
      const renamedPath = tab.filePath
        ? await window.fileAPI.resolveRenamedDocument(tab.filePath)
        : null;
      if (
        renamedPath &&
        (await reconcileExternallyRenamedDocument({
          event: 'rename',
          path: renamedPath,
          previousPath: tab.filePath,
          identity: destinationIdentity,
          scope: 'workspace',
        }))
      )
        return performSaveTab(tab, saveAs, overwriteConflict, null, null, renamedPath);
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
        const renamedPath = await window.fileAPI.resolveRenamedDocument(tab.filePath);
        if (
          renamedPath &&
          (await reconcileExternallyRenamedDocument({
            event: 'rename',
            path: renamedPath,
            previousPath: tab.filePath,
            identity: destinationIdentity,
            scope: 'workspace',
          }))
        )
          return performSaveTab(tab, saveAs, overwriteConflict, null, null, renamedPath);
        await preserveUnavailableTab(tab, 'deleted', destination);
        renderTabs();
        if (tab.id === state.activeId) updateActiveUI();
        return false;
      }
      try {
        const diskVersion = await window.fileAPI.readFile(destination);
        if (diskVersion.content !== tab.expectedSavedContent) {
          editorController.beginExternalChange(tab);
          store.setExternalConflict(tab.id, {
            kind: 'modified',
            path: destination,
            identity: destinationIdentity,
            content: diskVersion.content,
            encoding: diskVersion.encoding || tab.encoding,
            detectedAt: Date.now(),
            version: (tab.externalConflict?.version || 0) + 1,
          });
          store.setExternalChangeIgnored(tab.id, false);
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
      const content = editorController.contentForPersistence(tab);
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
        // A reappeared file has a watcher-provided stable snapshot that the user
        // explicitly confirmed replacing. Keep that snapshot as the write baseline.
        if (fileState.kind === 'reappeared' && typeof fileState.content === 'string')
          expectedContent = fileState.content;
        else expectedAbsent = true;
      } else if (await window.fileAPI.exists(destination)) {
        expectedContent = (await window.fileAPI.readFile(destination)).content;
      } else {
        expectedAbsent = true;
      }
      if (
        !state.tabs.includes(tab) ||
        tab.filePath !== previousPath ||
        tab.fileIdentity !== previousIdentity
      )
        return false;
      const result = await window.fileAPI.writeDocument(
        destination,
        diskContent,
        expectedContent,
        expectedAbsent,
      );
      // A close, Save As, rename, or workspace transition can complete while the
      // safe writer is awaiting I/O. Its result must not update a replacement binding.
      if (
        !state.tabs.includes(tab) ||
        tab.filePath !== previousPath ||
        tab.fileIdentity !== previousIdentity
      )
        return false;
      if (result.error) {
        if (result.error === 'external-change') {
          editorController.beginExternalChange(tab);
          store.setExternalConflict(tab.id, {
            kind: 'modified',
            path: destination,
            identity: destinationIdentity,
            content: result.content,
            encoding: result.encoding || tab.encoding,
            detectedAt: Date.now(),
            version: (tab.externalConflict?.version || 0) + 1,
          });
          store.setExternalChangeIgnored(tab.id, false);
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
      const destinationBaseDir = await window.fileAPI.dirname(destination);
      if (
        !state.tabs.includes(tab) ||
        tab.filePath !== previousPath ||
        tab.fileIdentity !== previousIdentity
      )
        return false;
      const previousBaseDir = tab.baseDir;
      updateTabDocument(tab, {
        filePath: destination,
        fileIdentity: destinationIdentity,
        title: fileName(destination),
        content,
        savedContent: content,
        expectedSavedContent: result.expectedContent,
        // Persistence is based on the editor snapshot captured with savedRevision. Comparing
        // serialized text can differ in harmless Vditor line-ending normalization; only a newer
        // input revision should keep the tab dirty after a successful write.
        modified: tab.contentRevision !== savedRevision,
        externalConflict: null,
        externalChangeIgnored: false,
        externalFileState: null,
        encoding: 'utf-8',
        baseDir: destinationBaseDir,
      });
      await releaseDocumentWatch(previousPath, previousIdentity);
      await syncLocalResourceRoots();
      await watchTabDocument(tab);
      if (tab.contentRevision === savedRevision) {
        await discardRecoverySnapshot(tab);
        store.setRecoveryState(tab.id, null);
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
    return PURE.toRecoveryStoreSnapshot({
      recoverySnapshotId: tab.recoverySnapshotId || recoveryId(),
      filePath: tab.filePath,
      title: tab.title,
      content: tab.content,
      savedContent: tab.savedContent,
      expectedSavedContent: tab.expectedSavedContent,
      encoding: tab.encoding,
      lineEnding: tab.lineEnding,
      mode: tab.mode,
    });
  }

  function scheduleRecoverySnapshot(tab) {
    recoveryRuntimeController.schedule(tab);
  }

  async function discardRecoverySnapshot(tab) {
    await recoveryRuntimeController.discard(tab);
  }

  async function preserveUnavailableTab(tab, kind, filePath, error) {
    const fileIdentity = tab.fileIdentity || (await window.fileAPI.fileIdentity(filePath));
    if (!state.tabs.includes(tab)) return;
    if (
      tab.externalFileState?.kind === kind &&
      tab.externalFileState.identity === fileIdentity &&
      tab.recoverySnapshotId
    )
      return;
    editorController.beginExternalChange(tab);
    const editorContent = currentContent(tab);
    if (editorContent.trim() || tab.modified || (!tab.content && !tab.savedContent))
      updateTabDocument(tab, { content: editorContent });
    else if (!tab.content.trim()) updateTabDocument(tab, { content: tab.savedContent });
    store.setExternalConflict(tab.id, null);
    store.setExternalChangeIgnored(tab.id, false);
    store.setExternalFileState(tab.id, {
      kind,
      path: filePath,
      identity: fileIdentity,
      ...(error ? { error } : {}),
      clipboardContent: tab.externalFileState?.clipboardContent ?? recreateClipboardSnapshot(tab),
      detectedAt: Date.now(),
      version: (tab.externalFileState?.version || 0) + 1,
    });
    await recoveryRuntimeController.preserveUnavailable(tab);
  }

  async function restoreRecoverySnapshots() {
    let candidates;
    try {
      candidates = await window.appAPI.getRecoveryCandidates();
    } catch (_) {
      return;
    }
    for (const candidate of candidates) {
      let snapshot;
      try {
        snapshot = PURE.fromRecoveryStoreSnapshot(
          await window.appAPI.restoreRecovery(candidate.id),
        );
      } catch (_) {
        continue;
      }
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
          updateTabDocument(existing, {
            content: snapshot.content,
            savedContent: snapshot.savedContent,
            expectedSavedContent: snapshot.expectedSavedContent,
            modified: snapshot.content !== snapshot.savedContent,
            encoding: snapshot.encoding,
            lineEnding: snapshot.lineEnding,
            mode: snapshot.mode,
            recoverySnapshotId: snapshot.id,
            recoveryState: 'unchanged',
            contentRevision: existing.contentRevision + 1,
          });
          editorController.applyRecoveryContent(existing, snapshot.content);
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

  function updateActiveUI(shouldSyncToolbarAvailability = true, shouldSyncTopControlsWidth = true) {
    updateEmptyState();
    const tab = activeTab();
    if (shouldSyncToolbarAvailability) syncToolbarAvailability();
    $('#vditorToolbarMount').classList.toggle('toolbar-preview-active', !tab);
    if (shouldSyncTopControlsWidth) syncTopControlsWidth();
    if (!tab) {
      updateExternalChangeBanner(null);
      updateExternalFileStateBanner(null);
      recoveryBannerController.render(null);
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
    recoveryBannerController.render(tab);
    $('#saveFile').disabled = false;
    const content = currentContent(tab);
    updateTabDocument(tab, { content });
    document.title = `${tab.title} - Vditor Desktop`;
    $('#windowTitle').textContent = `${tab.title} - Vditor Desktop`;
    $('#statusPath').textContent = tab.filePath || '';
    $('#statusPath').title = tab.filePath || '';
    const currentMode = tab.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab.mode;
    updateTabDocument(tab, { mode: currentMode });
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
    return resolveThemeModeImpl(state.settings);
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

  async function reloadExternalChange(tab) {
    const conflict = tab?.externalConflict;
    if (!conflict || typeof conflict.content !== 'string') return;
    const conflictIdentity = conflict.identity || tabFileIdentity(tab);
    const relatedTabs = state.tabs.filter(
      (item) => item === tab || (conflictIdentity && tabFileIdentity(item) === conflictIdentity),
    );
    for (const item of relatedTabs) {
      updateTabDocument(item, {
        content: conflict.content,
        savedContent: conflict.content,
        expectedSavedContent: conflict.content,
        modified: false,
        encoding: conflict.encoding || item.encoding,
        lineEnding: detectLineEnding(conflict.content),
        externalConflict: null,
        externalChangeIgnored: false,
      });
      editorController.applyExternalContent(item, conflict.content);
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
      updateTabDocument(item, {
        content: fileState.content,
        savedContent: fileState.content,
        expectedSavedContent: fileState.content,
        modified: false,
        encoding: fileState.encoding || item.encoding,
        lineEnding: detectLineEnding(fileState.content),
        externalConflict: null,
        externalChangeIgnored: false,
        externalFileState: null,
      });
      editorController.applyExternalContent(item, fileState.content);
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
    editorController.cancelAutoSave(tab);
    updateTabDocument(tab, {
      filePath: null,
      fileIdentity: null,
      baseDir: '',
      title: t('tab.untitled', { number: ++state.untitledCounters.file }),
      savedContent: '',
      expectedSavedContent: '',
      modified: tab.content !== '',
      externalConflict: null,
      externalChangeIgnored: false,
      externalFileState: null,
    });
    await releaseDocumentWatch(previousPath, previousIdentity);
    await syncLocalResourceRoots();
    scheduleRecoverySnapshot(tab);
    renderTabs();
    updateActiveUI();
    persistSession();
  }

  async function confirmExternalFileRecreate(tab, recreate) {
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
    const recreated = await (recreate
      ? recreate(fileState.version)
      : saveTab(tab, false, null, fileState.version));
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
    store.setExternalChangeIgnored(tab.id, true);
    renderTabs();
    if (tab.id === state.activeId) updateExternalChangeBanner(tab);
    showMessage(t('external.ignored', { name: tab.title }));
  }

  async function chooseFiles() {
    const paths = await window.fileAPI.openFileDialog(state.settings.defaultOpenPath || undefined);
    await openPaths(paths);
    if (paths?.[0]) await rememberDialogDirectory(paths[0]);
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
  // Remember the last confirmed selection across open, save, and export dialogs instead.
  async function rememberDialogDirectory(filePath) {
    const directory = await window.fileAPI.dirname(filePath);
    if (!directory || directory === state.settings.defaultOpenPath) return;
    state.settings.defaultOpenPath = directory;
    await queueSettingsSave({ defaultOpenPath: directory });
  }

  async function setWorkspace(folder) {
    await workspaceController.setWorkspace(folder);
  }

  async function refreshTree() {
    await workspaceController.refreshTree();
  }

  function closeContextMenu() {
    contextMenuController.close();
    contextMenuState = null;
  }

  function showContextMenu(event, items, menuState = null) {
    contextMenuState = menuState;
    contextMenuController.show(event, items, menuState);
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

  function treeContextParent(target) {
    const element = target instanceof Element ? target : null;
    return element?.closest('.tree-children')?.dataset.parentPath || state.workspace;
  }

  function showWorkspaceTreeMenu(event, parent = state.workspace) {
    explorerController.showWorkspaceContextMenu(event, parent);
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
        await documentController.transitionBindings({
          prepare: async () => tabPlans,
          commit: async (plans) => {
            for (const { tab, nextPath, fileIdentity, baseDir } of plans) {
              const previousBaseDir = tab.baseDir;
              updateTabDocument(tab, {
                filePath: nextPath,
                fileIdentity,
                title: fileName(nextPath),
                baseDir,
              });
              if (previousBaseDir !== tab.baseDir) editorRebuilds.add(tab);
            }
          },
        });
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
      for (const tab of affectedTabs)
        await documentController.transitionBindings({
          prepare: async () => tab,
          commit: async (document) =>
            preserveUnavailableTab(document, 'deleted', document.filePath),
        });
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
    outlineController.schedule();
  }
  function renderOutline() {
    outlineController.render();
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
    editorController.attachDocumentAnchorNavigation(tab, {
      onMouseOver: (event) => {
        const target = documentLinkTarget(tab, event.target);
        if (target) setHoveredDocumentLink(target, event);
      },
      onMouseOut: (event) => {
        if (!hoveredDocumentLink || hoveredDocumentLink.link.element.contains(event.relatedTarget))
          return;
        clearHoveredDocumentLink();
      },
      onMouseMove: (event) => {
        if (hoveredDocumentLink) showDocumentLinkTooltip(event);
      },
      onClick: (event) => {
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
    });
  }

  async function handleImageUpload(tab, files) {
    return imageController.upload(tab, files);
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

  function portableExportSourceSet(sourceSet, sourceBaseUrl, targetBaseUrl) {
    return sourceSet
      .split(',')
      .map((candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return '';
        const [source, ...descriptor] = trimmed.split(/\s+/);
        const portableSource = portableExportSource(source, sourceBaseUrl, targetBaseUrl);
        return portableSource === null ? '' : [portableSource, ...descriptor].join(' ');
      })
      .filter(Boolean)
      .join(', ');
  }

  function normalizeExportBody(body, tab, outputDirectory = tab.baseDir) {
    const template = document.createElement('template');
    template.innerHTML = body;
    const sourceBaseUrl = localResourceBase(tab.baseDir);
    const targetBaseUrl = localResourceBase(outputDirectory);
    template.content.querySelectorAll('[src], [href], [poster], [srcset]').forEach((element) => {
      ['src', 'href', 'poster'].forEach((attribute) => {
        if (!element.hasAttribute(attribute)) return;
        const source = element.getAttribute(attribute) || '';
        const portableSource = portableExportSource(source, sourceBaseUrl, targetBaseUrl);
        if (portableSource === null) element.removeAttribute(attribute);
        else if (portableSource !== source) element.setAttribute(attribute, portableSource);
      });
      if (!element.hasAttribute('srcset')) return;
      const sourceSet = element.getAttribute('srcset') || '';
      const portableSourceSet = portableExportSourceSet(sourceSet, sourceBaseUrl, targetBaseUrl);
      if (portableSourceSet) element.setAttribute('srcset', portableSourceSet);
      else element.removeAttribute('srcset');
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

  function makeExportHTML(tab, body, outputDirectory = tab.baseDir) {
    const portableBody = normalizeExportBody(body, tab, outputDirectory);
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(stripExtension(tab.title))}</title><style>body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#24292f}pre,code{font-family:ui-monospace,monospace}pre{padding:16px;overflow:auto;background:#f6f8fa}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:6px 12px}</style></head><body>${portableBody}</body></html>`;
  }
  const exportController = new PURE.ExportController({
    getActiveDocument: () => activeTab(),
    fileAPI: window.fileAPI,
    appAPI: window.appAPI,
    getDefaultDirectory: () => state.settings.defaultOpenPath || undefined,
    snapshotBody: exportBodySnapshot,
    normalizeBody: normalizeExportBody,
    embedImages: embedExportImages,
    makeHTML: makeExportHTML,
    defaultFileName: (tab, type) => `${stripExtension(tab.title)}.${type}`,
    rememberConfirmedDirectory: rememberDialogDirectory,
    showExported: (output) => showMessage(t('message.exported', { output })),
  });
  async function exportHTML() {
    await exportController.exportHTML();
  }
  async function exportPDF() {
    await exportController.exportPDF();
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
    const session = PURE.toPersistedSessionSnapshot({
      restoreWorkspace: state.settings.restoreWorkspace,
      restoreTabs: state.settings.restoreTabs,
      workspacePath: state.workspace,
      activeFilePath: activeTab()?.filePath || null,
      openFiles: state.tabs.map((tab) => tab.filePath),
      unavailableFilePaths: new Set(
        state.tabs
          .filter((tab) => tab.externalFileState && tab.filePath)
          .map((tab) => tab.filePath),
      ),
    });
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
    settingsWindow.open();
  }

  function closeSettings({ applyPresentation = true } = {}) {
    return settingsWindow.close(applyPresentation);
  }
  async function saveSettings(closeAfterSave = true) {
    clearTimeout(settingsSaveTimer);
    const form = $('#settingsForm');
    const patch = {};
    const numericSettingNames = new Set(['tabSize']);
    const previousSettings = { ...state.settings };
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
      await settingsController.savePatch(patch);
    } catch (error) {
      showMessage(ipcErrorMessage(error), true);
      return;
    }
    const settingsChange = PURE.classifySettingsChange(
      previousSettings,
      state.settings,
      VDITOR_INITIALIZATION_SETTINGS,
    );
    const changedSettings = settingsChange.changedKeys;
    const shouldRebuildEditors = settingsChange.shouldRebuildEditor;
    if (changedSettings.includes('allowSvgImages')) {
      imageRuntimeController.reload(state.tabs);
    }
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
        updateTabDocument(tab, { mode: openModes.get(tab.id) || tab.mode });
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
    if (input.name === 'allowSvgImages' && input.checked && !state.settings.allowSvgImages) {
      const confirmed =
        (await showConfirmDialog({
          title: t('settings.allowSvgImagesWarningTitle'),
          message: t('settings.allowSvgImagesWarningMessage'),
          detail: t('settings.allowSvgImagesWarningDetail'),
          actions: [
            { id: 'cancel', label: t('settings.keepSvgImagesBlocked') },
            {
              id: 'confirm',
              label: t('settings.allowSvgImagesAnyway'),
              primary: true,
              danger: true,
            },
          ],
          draggable: true,
        })) === 'confirm';
      if (!confirmed) {
        input.checked = false;
        return;
      }
    }
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

  async function handleExternalChange(change) {
    if (
      !['add', 'change', 'unlink', 'addDir', 'unlinkDir', 'unreadable', 'watch-error'].includes(
        change.event,
      )
    )
      return;
    if (change.scope === 'workspace') {
      if (change.event === 'rename') await reconcileExternallyRenamedDocument(change);
      await workspaceController.handleWatcherEvent(change);
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
      const decision = documentController.classifyExternalChange({
        hasUnavailableState: Boolean(tab.externalFileState),
        expectedSavedContent: tab.expectedSavedContent,
        modified: tab.modified,
        externalChangeIgnored: tab.externalChangeIgnored,
        hasFilePath: Boolean(tab.filePath),
        content: change.content,
      });
      if (decision === 'reappeared') {
        editorController.beginExternalChange(tab);
        store.setExternalConflict(tab.id, null);
        store.setExternalChangeIgnored(tab.id, false);
        store.setExternalFileState(tab.id, {
          kind: 'reappeared',
          path: change.path,
          identity: documentIdentity,
          content: change.content,
          encoding: change.encoding || tab.encoding,
          clipboardContent: tab.externalFileState.clipboardContent,
          detectedAt: Date.now(),
          version: tab.externalFileState.version + 1,
        });
        continue;
      }
      if (decision === 'matches-baseline') {
        store.setExternalConflict(tab.id, null);
        store.setExternalChangeIgnored(tab.id, false);
        continue;
      }
      if (decision === 'reload-clean-document') {
        if (typeof change.content !== 'string') continue;
        updateTabDocument(tab, {
          lineEnding: detectLineEnding(change.content),
          content: change.content,
          savedContent: change.content,
          expectedSavedContent: change.content,
          encoding: change.encoding || tab.encoding,
          externalConflict: null,
          externalChangeIgnored: false,
        });
        editorController.applyExternalContent(tab, change.content);
        if (tab.id === state.activeId) updateActiveUI();
        showMessage(t('external.reloaded', { name: tab.title }));
        continue;
      }
      editorController.beginExternalChange(tab);
      store.setExternalConflict(tab.id, {
        kind: 'modified',
        path: change.path,
        identity: documentIdentity,
        content: change.content,
        encoding: change.encoding || tab.encoding,
        detectedAt: Date.now(),
        version: (tab.externalConflict?.version || 0) + 1,
      });
      store.setExternalChangeIgnored(tab.id, false);
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
      find: () => findController.open(),
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

  function setupLegacyAppMenus() {
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
        ['menu.open', run('open'), 'Ctrl/⌘+Alt+O'],
        ['menu.openFolder', run('open-folder'), 'Ctrl/⌘+Alt+K'],
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
              'Ctrl/⌘+Alt+B',
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

  const menuController = new PURE.MenuController({
    menuBar: $('#appMenuBar'),
    titlebar: $('#windowTitlebar'),
    toggleSidebar: $('#toggleSidebar'),
    translate: t,
    onPopupCreated: (popup) => setupAutoHideScrollbar(popup),
    getMenu: (name) => {
      if (name !== 'main') return [];
      const run = (action, value) => () => handleMenu(action, value);
      const currentEditorMode = () => {
        const tab = activeTab();
        return tab?.vditor && tab.ready
          ? tab.vditor.getCurrentMode()
          : tab?.mode || state.settings.editMode;
      };
      return [
        { label: 'menu.new', action: run('new'), shortcut: 'Ctrl+N' },
        { label: 'menu.open', action: run('open'), shortcut: 'Ctrl/⌘+Alt+O' },
        { label: 'menu.openFolder', action: run('open-folder'), shortcut: 'Ctrl/⌘+Alt+K' },
        null,
        { label: 'menu.save', action: run('save'), shortcut: 'Ctrl+S' },
        { label: 'menu.saveAs', action: run('save-as'), shortcut: 'Ctrl+Shift+S' },
        null,
        { label: 'menu.exportHtml', action: run('export-html') },
        { label: 'menu.exportPdf', action: run('export-pdf') },
        ...(state.tabs.length
          ? [{ label: 'menu.closeTab', action: run('close-tab'), shortcut: 'Ctrl+W' }]
          : []),
        null,
        {
          label: 'menu.editMode',
          disabled: () => !activeTab(),
          children: [
            {
              label: 'menu.editModeWysiwyg',
              action: run('mode', 'wysiwyg'),
              checked: () => currentEditorMode() === 'wysiwyg',
            },
            {
              label: 'menu.editModeIr',
              action: run('mode', 'ir'),
              checked: () => currentEditorMode() === 'ir',
            },
            {
              label: 'menu.editModeSv',
              action: run('mode', 'sv'),
              checked: () => currentEditorMode() === 'sv',
            },
          ],
        },
        {
          label: 'menu.layout',
          keepOpen: true,
          children: [
            {
              label: 'menu.layoutToolbar',
              action: () => setLayoutPart('toolbar'),
              checked: () => state.settings.toolbarVisible !== false,
            },
            {
              label: 'menu.layoutSidebar',
              action: () => toggleSidebar(),
              shortcut: 'Ctrl/⌘+Alt+B',
              checked: () => state.settings.sidebarVisible,
            },
            {
              label: 'menu.layoutStatusbar',
              action: () => $('#app').classList.toggle('statusbar-hidden'),
              checked: () => !$('#app').classList.contains('statusbar-hidden'),
            },
          ],
        },
        null,
        { label: 'menu.settings', action: run('settings'), shortcut: 'Ctrl+,' },
        null,
        { label: 'menu.quit', action: run('quit'), shortcut: 'Ctrl+Q' },
      ];
    },
  });

  function setupAppMenus() {
    // Retain the old renderer implementation only until batch 9 removes the legacy shell.
    void setupLegacyAppMenus;
    menuController.init();
    closeAppMenu = () => menuController.close();
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
    // Vditor menus are absolutely positioned but contribute to scrollHeight.
    // Only the toolbar's rendered box represents wrapped control rows.
    // The editor lives below .main-area. Do not put this changing value on an
    // ancestor, where CSS-variable inheritance would invalidate its full DOM tree.
    toolbarController.syncWrapHeight();
  }

  function scheduleToolbarWrapHeight() {
    // Toolbar mutations can be delivered while Vditor is still constructing a
    // long document. Let its pending style work reach a normal paint before
    // getBoundingClientRect() measures the shared toolbar.
    toolbarController.scheduleWrapHeight();
  }

  function applyTopControlsWidth(sidebarWidth, menuWidth) {
    const actions = $('.titlebar-file-actions');
    // These values change on every sidebar-drag frame. Keep them on the small
    // chrome subtrees that consume them instead of #app, so CSS-variable
    // inheritance cannot invalidate Vditor's full document tree.
    $('.toolbar-sidebar-tabs').style.setProperty('--top-controls-width', `${sidebarWidth}px`);
    ['#sidebar', '#windowTitlebar', '.titlebar', '#vditorToolbarMount'].forEach((selector) =>
      $(selector).style.setProperty('--sidebar-current', `${sidebarWidth}px`),
    );
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

  function sidebarTransitionDuration() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 160;
  }

  function sidebarLayoutPositions() {
    return ['#tabBar', '#vditorToolbarMount', '#editorArea'].flatMap((selector) => {
      const element = $(selector);
      return element ? [[element, element.getBoundingClientRect().left]] : [];
    });
  }

  function measureCollapsedSidebarChrome() {
    const app = $('#app');
    const wasAppCollapsed = app.classList.contains('sidebar-collapsed');
    app.classList.add('sidebar-collapsed');
    const positions = ['#tabBar', '#vditorToolbarMount'].flatMap((selector) => {
      const element = $(selector);
      return element ? [[element, element.getBoundingClientRect().left]] : [];
    });
    app.classList.toggle('sidebar-collapsed', wasAppCollapsed);
    return positions;
  }

  function cancelSidebarLayoutAnimations() {
    sidebarLayoutAnimations.forEach((animation) => animation.cancel());
    sidebarLayoutAnimations = [];
  }

  function animateSidebarLayout(initialPositions, visible, targetChromePositions) {
    cancelSidebarLayoutAnimations();
    const initialByElement = new Map(initialPositions);
    const targetChromeByElement = new Map(targetChromePositions);
    const duration = sidebarTransitionDuration();
    const sidebarWidth = Number(state.settings.sidebarWidth);
    sidebarLayoutAnimations = sidebarLayoutPositions().flatMap(([element, currentLeft]) => {
      const initialLeft = initialByElement.get(element);
      if (initialLeft === undefined) return [];
      const from = initialLeft - currentLeft;
      const to =
        element.id === 'editorArea'
          ? visible
            ? sidebarWidth
            : -sidebarWidth
          : visible
            ? 0
            : (targetChromeByElement.get(element) ?? currentLeft) - currentLeft;
      if (Math.abs(from - to) < 0.5) return [];
      return [
        element.animate(
          [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
          { duration, easing: 'ease', fill: 'forwards' },
        ),
      ];
    });
  }

  function finishSidebarTransition(refreshEditorLayout = false) {
    const sidebar = $('#sidebar');
    clearTimeout(sidebarTransitionTimer);
    sidebarTransitionTimer = undefined;
    if (sidebarTransitionEndHandler) {
      sidebar.removeEventListener('transitionend', sidebarTransitionEndHandler);
      sidebarTransitionEndHandler = undefined;
    }
    const wasOpening = sidebar.classList.contains('sidebar-opening');
    const app = $('#app');
    const wasHiding = app.classList.contains('sidebar-hiding');
    if (wasHiding) sidebar.classList.add('collapsed');
    sidebar.classList.remove('sidebar-entering', 'sidebar-opening', 'sidebar-closing');
    if (wasOpening) sidebar.classList.remove('collapsed');
    if (wasHiding) app.classList.add('sidebar-collapsed');
    app.classList.remove('sidebar-transitioning', 'sidebar-hiding');
    syncTopControlsWidth();
    // The layout now has its final flex geometry, so dropping the composited
    // FLIP transforms cannot visibly move the toolbar, tabs, or Vditor host.
    cancelSidebarLayoutAnimations();
    if (refreshEditorLayout) scheduleSplitLineNumbers(activeTab());
  }

  function toggleSidebar(force) {
    const app = $('#app');
    const sidebar = $('#sidebar');
    const isTransitioning = app.classList.contains('sidebar-transitioning');
    const visible =
      typeof force === 'boolean'
        ? force
        : isTransitioning
          ? !state.settings.sidebarVisible
          : sidebar.classList.contains('collapsed');
    const currentTargetVisible = isTransitioning
      ? state.settings.sidebarVisible
      : !sidebar.classList.contains('collapsed');
    if (currentTargetVisible === visible) {
      state.settings.sidebarVisible = visible;
      $('#toggleSidebar')?.setAttribute('aria-pressed', String(visible));
      if (!isTransitioning) syncTopControlsWidth();
      return;
    }
    finishSidebarTransition();
    const initialLayout = sidebarLayoutPositions();
    app.classList.add('sidebar-transitioning');
    if (visible) {
      const menuWidth = $('#appMenuBar').getBoundingClientRect().width;
      applyTopControlsWidth(state.settings.sidebarWidth, menuWidth);
      // A collapsed sidebar has zero layout width. Keep an overlay box until
      // the slide-in ends, so Vditor does not reflow during this animation.
      sidebar.classList.add('sidebar-entering');
      void sidebar.offsetWidth;
      sidebar.classList.add('sidebar-opening');
    } else {
      $('.titlebar-file-actions').style.flexBasis = 'auto';
      // Keep the sidebar's flex space until it finishes sliding out, so the
      // Vditor document resizes at the same point as on sidebar open.
      sidebar.classList.add('sidebar-closing');
    }
    if (!visible) sidebar.classList.remove('collapsed');
    if (visible) {
      app.classList.remove('sidebar-collapsed', 'sidebar-hiding');
    } else {
      app.classList.add('sidebar-hiding');
    }
    state.settings.sidebarVisible = visible;
    $('#toggleSidebar')?.setAttribute('aria-pressed', String(visible));
    queueSettingsSave({ sidebarVisible: visible });
    const targetChromeLayout = visible ? [] : measureCollapsedSidebarChrome();
    // Keep Vditor's width fixed for the slide, while the surrounding chrome
    // follows its eventual flex position on compositor-only transforms.
    animateSidebarLayout(initialLayout, visible, targetChromeLayout);
    sidebarTransitionEndHandler = (event) => {
      if (event.target !== sidebar || event.propertyName !== 'transform') return;
      finishSidebarTransition(true);
    };
    sidebar.addEventListener('transitionend', sidebarTransitionEndHandler);
    sidebarTransitionTimer = setTimeout(() => finishSidebarTransition(true), 220);
  }

  function setupEvents() {
    setupAppMenus();
    windowController.init();
    window.appAPI.onOpenFiles((paths) => void openPaths(paths));
    $('#confirmModal').onclick = (event) => {
      if (event.target === $('#confirmModal')) closeConfirmDialog('cancel');
    };
    $('#newFile').onclick = newTab;
    $('#addTab').onclick = newTab;
    $('#openFile').onclick = chooseFiles;
    $('#saveFile').onclick = () => saveTab();
    findController.init();
    $('#findPrevious').onclick = () => findController.move(-1);
    $('#findNext').onclick = () => findController.move(1);
    $('#findClose').onclick = () => findController.close();
    $('#externalReload').onclick = () => void reloadExternalChange(activeTab());
    $('#externalSaveAs').onclick = () => void saveTab(activeTab(), true);
    $('#externalOverwrite').onclick = () => void confirmExternalOverwrite(activeTab());
    $('#externalIgnore').onclick = () => ignoreExternalChange(activeTab());
    $('#externalFileReload').onclick = () => void reloadReappearedFile(activeTab());
    $('#externalFileSaveAs').onclick = () => void saveTab(activeTab(), true);
    $('#externalFileKeepUntitled').onclick = () => void keepExternalFileAsUntitled(activeTab());
    $('#externalFileRecreate').onclick = () => void confirmExternalFileRecreate(activeTab());
    $('#externalFileClose').onclick = () => void confirmExternalFileClose(activeTab());
    $('#replaceOne').onclick = () => findController.replaceOne();
    $('#replaceAll').onclick = () => findController.replaceAll();
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
    };
    $('#settingsForm [name="workspaceReadDepth"]').oninput = syncWorkspaceReadDepthValue;
    $('#resetSettings').onclick = async () => {
      if (await confirmDialog({ message: t('confirm.resetSettings') })) {
        await settingsController.reset(async () => ({
          ...(await window.appAPI.resetSettings()),
          ...(await window.appAPI.getPersistentState()),
        }));
        applyLocale(state.settings.locale);
        openSettings();
      }
    };
    setupSettingsDrag();
    notifications.init();
    $('#openSettingsFolder').onclick = async () =>
      window.appAPI.showItemInFolder(await window.appAPI.getSettingsPath());
    // Vanessa Easter Egg
    let vanessaEasterEggClicks = 0;
    let vanessaEasterEggTimer = null;
    $('.about-logo').onclick = () => {
      vanessaEasterEggClicks++;
      clearTimeout(vanessaEasterEggTimer);
      vanessaEasterEggTimer = setTimeout(() => {
        vanessaEasterEggClicks = 0;
      }, 2000);
      if (vanessaEasterEggClicks < 10) return;
      vanessaEasterEggClicks = 0;
      window.appAPI.openExternal('https://github.com/Vanessa219');
    };
    $$('[data-external]').forEach((element) => {
      element.onclick = () => window.appAPI.openExternal(element.dataset.external);
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
      if (event.key === 'F11') {
        event.preventDefault();
        window.appAPI.toggleFullscreen();
        return;
      }
      // Vditor 3.11.3 consumes its editor shortcuts before this document listener.
      // Do not run an application command for the same editor gesture.
      if (event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        if (selectEditorContextOrAll(event)) return;
        if (!keepsNativeSelectAll(event.target)) event.preventDefault();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        saveTab(activeTab(), event.shiftKey);
      } else if (key === 'o' && event.altKey && !event.shiftKey) {
        event.preventDefault();
        chooseFiles();
      } else if (key === 'k' && event.altKey && !event.shiftKey) {
        event.preventDefault();
        chooseFolder();
      } else if (key === 'n') {
        event.preventDefault();
        newTab();
      } else if (key === 'b' && event.altKey && !event.shiftKey) {
        event.preventDefault();
        toggleSidebar();
      } else if (key === 'f') {
        event.preventDefault();
        findController.open();
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
    let resizeFrame = null;
    let pendingSidebarWidth = null;
    let frozenEditorHost = null;
    let frozenEditorHostStyle = null;
    const resizeChrome = [
      $('#sidebar'),
      $('.titlebar'),
      $('.titlebar-file-actions'),
      $('.toolbar-sidebar-tabs'),
    ];
    const restoreFrozenEditorHost = () => {
      if (!frozenEditorHost || !frozenEditorHostStyle) return;
      ['inset', 'left', 'width', 'transform'].forEach((property) => {
        const saved = frozenEditorHostStyle[property];
        if (saved.value) frozenEditorHost.style.setProperty(property, saved.value, saved.priority);
        else frozenEditorHost.style.removeProperty(property);
      });
      frozenEditorHostStyle = null;
    };
    const applySidebarResize = () => {
      resizeFrame = null;
      if (!resizing || pendingSidebarWidth === null) return;
      const width = pendingSidebarWidth;
      $('#sidebar').style.width = `${width}px`;
      applyTopControlsWidth(width, resizeMenuWidth);
      state.settings.sidebarWidth = width;
    };
    const startSidebarResize = () => {
      resizing = true;
      resizeMinimum = sidebarMinimumWidth();
      resizeMenuWidth = $('#appMenuBar').getBoundingClientRect().width;
      resizeAppLeft = $('#app').getBoundingClientRect().left;
      $('#sidebar').style.setProperty('--sidebar-min-width', `${resizeMinimum}px`);
      // Keep Vditor's layout viewport stable while its parent is clipped and
      // moved by the resize. A long document therefore reflows once on mouseup
      // instead of for every pointer update.
      frozenEditorHost = activeTab()?.host || null;
      if (frozenEditorHost?.classList.contains('vditor')) {
        const editorWidth = frozenEditorHost.getBoundingClientRect().width;
        frozenEditorHostStyle = Object.fromEntries(
          ['inset', 'left', 'width', 'transform'].map((property) => [
            property,
            {
              value: frozenEditorHost.style.getPropertyValue(property),
              priority: frozenEditorHost.style.getPropertyPriority(property),
            },
          ]),
        );
        frozenEditorHost.style.setProperty('inset', '0 auto', 'important');
        frozenEditorHost.style.setProperty('left', '50%', 'important');
        frozenEditorHost.style.setProperty('width', `${editorWidth}px`, 'important');
        frozenEditorHost.style.setProperty('transform', 'translateX(-50%)');
      }
      // Keeping the editor focused avoids Vditor 3.11.3's expensive blur
      // serialization path for a long document. Limit the resize state to
      // application chrome so it cannot invalidate the editor's DOM tree.
      resizeChrome.forEach((element) => element.classList.add('sidebar-resizing'));
    };
    resize.onmousedown = (event) => {
      event.preventDefault();
      startSidebarResize();
    };
    window.addEventListener('mousemove', (event) => {
      if (resizing) {
        pendingSidebarWidth = Math.max(resizeMinimum, Math.min(500, event.clientX - resizeAppLeft));
        if (resizeFrame === null) resizeFrame = requestAnimationFrame(applySidebarResize);
      }
    });
    window.addEventListener('mouseup', () => {
      if (resizing) {
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = null;
          applySidebarResize();
        }
        resizing = false;
        pendingSidebarWidth = null;
        restoreFrozenEditorHost();
        frozenEditorHost = null;
        resizeChrome.forEach((element) => element.classList.remove('sidebar-resizing'));
        syncTopControlsWidth();
        requestAnimationFrame(() => scheduleSplitLineNumbers(activeTab()));
        queueSettingsSave({ sidebarWidth: state.settings.sidebarWidth });
      }
    });
    const topControlsObserver = new ResizeObserver(() => {
      if (!resizing) syncTopControlsWidth();
    });
    topControlsObserver.observe($('#sidebar'));
    topControlsObserver.observe($('#appMenuBar'));
    const toolbarMount = $('#vditorToolbarMount');
    new ResizeObserver(syncToolbarWrapHeight).observe(toolbarMount);
    new MutationObserver(scheduleToolbarWrapHeight).observe(toolbarMount, {
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
      else if (paths.length) showMessage(t('message.dropMarkdownOnly'), true);
    });
  }

  async function init() {
    if (typeof Vditor === 'undefined' || !VDITOR || !window.fileAPI || !window.appAPI) {
      document.body.innerHTML =
        '<div class="fatal"><h1>Application resources failed to load</h1><p>Please run npm run build again.</p></div>';
      return;
    }
    document.body.dataset.platform = window.appAPI.platform;
    settingsController.load(
      await window.appAPI.getSettings(),
      await window.appAPI.getDefaultSettings(),
    );
    state.settings = {
      ...state.settings,
      ...(await window.appAPI.getPersistentState()),
    };
    applyLocale(state.settings.locale);
    setupEvents();
    const minimumSidebarWidth = sidebarMinimumWidth();
    state.settings.sidebarWidth = Math.max(
      minimumSidebarWidth,
      Number(state.settings.sidebarWidth) || minimumSidebarWidth,
    );
    $('#sidebar').style.setProperty('--sidebar-min-width', `${minimumSidebarWidth}px`);
    $('#sidebar').style.width = `${state.settings.sidebarWidth}px`;
    applyTopControlsWidth(
      state.settings.sidebarWidth,
      $('#appMenuBar').getBoundingClientRect().width,
    );
    toggleSidebar(state.settings.sidebarVisible);
    $('#app').classList.toggle('fullscreen', await window.appAPI.isFullscreen());
    updateMaximizedState(await window.appAPI.isMaximized());
    applyPresentationSettings();
    await applyTheme(await resolveTheme());
    $('#settingsPath').textContent = await window.appAPI.getSettingsDisplayPath();
    const info = await window.appAPI.getInfo();
    $('#statusVersion').textContent = `v${info.app}`;
    $('#versionInfo').textContent = `Version ${info.app} · Electron ${info.electron}`;
    const session = PURE.fromPersistedSessionSnapshot(state.settings.session);
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

  window.__vditorDesktopLegacyBootstrap = init;
  window.__vditorDesktopLegacyDispose = () => {
    settingsWindow.dispose();
    localizationController.dispose();
    windowController.dispose();
    contextMenuController.dispose();
    menuController.dispose();
    workspaceController.dispose();
    state.tabs.forEach((tab) => editorController.destroy(tab));
    findController.dispose();
    outlineController.dispose();
    toolbarController.dispose();
    tabController.dispose();
  };
})();
