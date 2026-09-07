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
  const documentWatchController = new PURE.DocumentWatchController({
    getDocuments: () => state.tabs,
    fileIdentity: (filePath) => window.fileAPI.fileIdentity(filePath),
    watch: (filePath, reconcile) => window.fileAPI.watchDocument(filePath, reconcile),
    unwatch: (filePath, identity) => window.fileAPI.unwatchDocument(filePath, identity),
    updateIdentity: (tab, fileIdentity) => updateTabDocument(tab, { fileIdentity }),
    identityOf: tabFileIdentity,
  });
  const documentTabWorkflowController = new PURE.DocumentTabWorkflowController({
    documentController,
    getDocuments: () => state.tabs,
    getDocument: (id) => state.tabs.find((tab) => tab.id === id) || null,
    getActiveDocumentId: () => state.activeId,
    createUntitledTitle: async () => {
      const number = await nextUntitledNumber(state.workspace, 'file');
      return t('tab.untitled', { number });
    },
    activate: (id) => editorRuntimeCoordinator.activate(id),
    reportOpenFailure: (error) =>
      showMessage(t('message.openFailed', { error: ipcErrorMessage(error) }), true),
    confirmClose: (tab, discard) => confirmTabClose(tab, discard),
    disposeRuntime: (tab) => disposeClosedTabRuntime(tab),
    removeDocument: (tab) => store.removeDocument(tab.id),
    finishClose: (tab, index, wasActive) => finishClosingTab(tab, index, wasActive),
  });
  const externalFileChangeController = new PURE.ExternalFileChangeController({
    fileIdentity: (filePath) => window.fileAPI.fileIdentity(filePath),
    findTabsByIdentity: (identity) => state.tabs.filter((tab) => tabFileIdentity(tab) === identity),
    classify: (input) => documentController.classifyExternalChange(input),
    handleWorkspaceChange: async (change) => {
      if (change.event === 'rename') await reconcileExternallyRenamedDocument(change);
      await workspaceController.handleWatcherEvent(change);
    },
    preserveUnavailable: (tab, kind, filePath, error) =>
      documentSaveExternalWorkflowController.preserveUnavailable(tab, kind, filePath, error),
    beginExternalChange: (tab) => editorController.beginExternalChange(tab),
    clearExternalConflict: (tab) => store.setExternalConflict(tab.id, null),
    setExternalChangeIgnored: (tab, ignored) => store.setExternalChangeIgnored(tab.id, ignored),
    setReappeared: (tab, external) => {
      store.setExternalFileState(tab.id, {
        kind: 'reappeared',
        path: external.path,
        identity: external.identity,
        content: external.content,
        encoding: external.encoding,
        clipboardContent: tab.externalFileState.clipboardContent,
        detectedAt: Date.now(),
        version: tab.externalFileState.version + 1,
      });
    },
    reloadCleanDocument: (tab, content, encoding) => {
      updateTabDocument(tab, {
        lineEnding: detectLineEnding(content),
        content,
        savedContent: content,
        expectedSavedContent: content,
        encoding,
        externalConflict: null,
        externalChangeIgnored: false,
      });
      editorController.applyExternalContent(tab, content);
    },
    createConflict: (tab, external) => {
      store.setExternalConflict(tab.id, {
        kind: 'modified',
        path: external.path,
        identity: external.identity,
        content: external.content,
        encoding: external.encoding,
        detectedAt: Date.now(),
        version: (tab.externalConflict?.version || 0) + 1,
      });
    },
    isActive: (tab) => tab.id === state.activeId,
    onReloaded: (tab) => {
      updateActiveUI();
      showMessage(t('external.reloaded', { name: tab.title }));
    },
    finish: () => {
      renderTabs();
      updateExternalChangeBanner(activeTab());
      updateExternalFileStateBanner(activeTab());
      void persistSession();
    },
  });
  const documentSaveExternalWorkflowController = new PURE.DocumentSaveExternalWorkflowController({
    getDocuments: () => state.tabs,
    getActiveDocumentId: () => state.activeId,
    fileIdentityOf: tabFileIdentity,
    saveDocument: (tab, operation) => documentController.save(tab, operation),
    saveForIdentity: (identity, operation) =>
      documentController.saveForIdentity(identity, operation),
    fileName,
    saveFileDialog: (defaultName, defaultDirectory) =>
      window.fileAPI.saveFileDialog(defaultName, defaultDirectory || state.workspace || undefined),
    fileIdentity: (filePath) => window.fileAPI.fileIdentity(filePath),
    exists: (filePath) => window.fileAPI.exists(filePath),
    readFile: (filePath) => window.fileAPI.readFile(filePath),
    writeDocument: (filePath, content, expectedContent, expectedAbsent) =>
      window.fileAPI.writeDocument(filePath, content, expectedContent, expectedAbsent),
    dirname: (filePath) => window.fileAPI.dirname(filePath),
    resolveRenamedDocument: (filePath) => window.fileAPI.resolveRenamedDocument(filePath),
    reconcileRenamedDocument: (tab, path, identity) =>
      reconcileExternallyRenamedDocument({
        event: 'rename',
        path,
        previousPath: tab.filePath,
        identity,
        scope: 'workspace',
      }),
    suspendWatches: (tabs) => suspendDocumentWatches(tabs),
    rebindWatches: (tabs) => rebindDocumentWatches(tabs),
    releaseWatch: (filePath, identity) => releaseDocumentWatch(filePath, identity),
    watchDocument: (tab) => watchTabDocument(tab),
    contentForPersistence: (tab) => editorController.contentForPersistence(tab),
    currentContent: (tab) => currentContent(tab),
    beginExternalChange: (tab) => editorController.beginExternalChange(tab),
    cancelAutoSave: (tab) => editorController.cancelAutoSave(tab),
    applyExternalContent: (tab, content) => editorController.applyExternalContent(tab, content),
    updateDocument: (tab, updates) => updateTabDocument(tab, updates),
    createConflict: (tab, external) => {
      store.setExternalConflict(tab.id, {
        kind: 'modified',
        path: external.path,
        identity: external.identity,
        content: external.content,
        encoding: external.encoding || tab.encoding,
        detectedAt: Date.now(),
        version: (tab.externalConflict?.version || 0) + 1,
      });
      store.setExternalChangeIgnored(tab.id, false);
    },
    preserveUnavailable: (tab, kind, filePath, error) =>
      preserveUnavailableTab(tab, kind, filePath, error),
    discardRecovery: (tab) => discardRecoverySnapshot(tab),
    clearRecoveryState: (tab) => store.setRecoveryState(tab.id, null),
    scheduleRecovery: (tab) => scheduleRecoverySnapshot(tab),
    syncResources: () => syncLocalResourceRoots(),
    rebuildEditor: (tab) => rebuildEditor(tab),
    rememberRecent: (filePath) => rememberRecent(filePath),
    refreshTree: () => refreshTree(),
    hasWorkspace: () => Boolean(state.workspace),
    nextUntitledTitle: () => t('tab.untitled', { number: ++state.untitledCounters.file }),
    recreateClipboardSnapshot: (tab) => recreateClipboardSnapshot(tab),
    writeClipboard: (content) => window.appAPI.writeClipboard(content),
    detectLineEnding,
    confirm: async (kind, tab, path) => {
      const recreate = kind === 'recreate';
      return (
        (await showConfirmDialog({
          title: t(recreate ? 'external.recreateTitle' : 'external.overwriteTitle'),
          message: t(recreate ? 'external.recreateMessage' : 'external.overwriteMessage', {
            name: recreate ? fileName(path) : tab.title,
          }),
          detail: t(recreate ? 'external.recreateDetail' : 'external.overwriteDetail'),
          actions: [
            { id: 'cancel', label: t('dialog.cancel') },
            {
              id: 'confirm',
              label: t(recreate ? 'external.recreate' : 'external.overwrite'),
              primary: true,
              danger: true,
            },
          ],
          draggable: true,
        })) === 'confirm'
      );
    },
    showMessage: (kind, tab, error) => {
      const keys = {
        saved: 'message.saved',
        'path-open': 'message.savePathAlreadyOpen',
        'resolve-file-state': 'external.resolveFileStateBeforeSave',
        'resolve-conflict': 'external.resolveBeforeSave',
        'changed-again': 'external.changedAgain',
        'permission-denied': 'message.savePermissionDenied',
        'save-failed': error ? 'message.saveFailed' : 'message.saveFailedGeneric',
        reloaded: 'external.reloaded',
        ignored: 'external.ignored',
        recreated: 'external.recreated',
        'recreated-copied': 'external.recreatedCopied',
        'recreated-clipboard-failed': 'external.recreatedClipboardFailed',
      };
      const errorMessage = error ? ipcErrorMessage(error) : undefined;
      showMessage(
        t(keys[kind], { title: tab.title, name: tab.title, error: errorMessage }),
        !['saved', 'reloaded', 'ignored', 'recreated', 'recreated-copied'].includes(kind),
      );
    },
    showRecreateNotice: (kind) =>
      showTemporaryDocumentNotice(
        t(
          {
            recreated: 'external.recreated',
            'recreated-copied': 'external.recreatedCopied',
            'recreated-clipboard-failed': 'external.recreatedClipboardFailed',
          }[kind],
        ),
        kind === 'recreated-clipboard-failed',
      ),
    finish: () => {
      renderTabs();
      updateActiveUI();
      renderOutline();
      persistSession();
    },
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
  const recoveryRestoreController = new PURE.RecoveryRestoreController({
    getCandidates: () => window.appAPI.getRecoveryCandidates(),
    restore: (id) => window.appAPI.restoreRecovery(id),
    parse: PURE.fromRecoveryStoreSnapshot,
    dirname: (filePath) => window.fileAPI.dirname(filePath),
    fileIdentity: (filePath) => window.fileAPI.fileIdentity(filePath),
    syncResourceRoots: (roots) => syncLocalResourceRoots(roots),
    findDocumentByIdentity: (identity) =>
      state.tabs.find((tab) => tab.fileIdentity === identity) || null,
    mergeUnchanged: (tab, snapshot) => {
      updateTabDocument(tab, {
        content: snapshot.content,
        savedContent: snapshot.savedContent,
        expectedSavedContent: snapshot.expectedSavedContent,
        modified: snapshot.content !== snapshot.savedContent,
        encoding: snapshot.encoding,
        lineEnding: snapshot.lineEnding,
        mode: snapshot.mode,
        recoverySnapshotId: snapshot.id,
        recoveryState: 'unchanged',
        contentRevision: tab.contentRevision + 1,
      });
    },
    applyMergedContent: (tab, content) => editorController.applyRecoveryContent(tab, content),
    createDocument: (input) => createTab(input),
    watchDocument: (tab) => watchTabDocument(tab),
    conflictTitle: (title) => t('recovery.conflictTitle', { title }),
  });
  const sessionRestoreController = new PURE.SessionRestoreController({
    getSettings: () => state.settings,
    getWorkspacePath: () => state.workspace,
    getActiveFilePath: () => activeTab()?.filePath || null,
    getDocuments: () => state.tabs,
    persistSnapshot: async (session) => {
      state.settings.session = session;
      await queueSettingsSave({ session }, { throwOnFailure: true });
    },
    reportPersistenceFailure: (error) =>
      console.error('Unable to persist the current session.', error),
    workspaceExists: (workspacePath) => window.fileAPI.exists(workspacePath),
    setWorkspace,
    openPaths,
    activateFile: (filePath) => {
      const tab = state.tabs.find((document) => document.filePath === filePath);
      if (tab) switchTab(tab.id);
    },
    createEmptyPreview: createToolbarPreview,
    updateActiveUI,
    syncTopControlsWidth,
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
    getMountedToolbar: () => VDITOR.mountedToolbar($('#vditorToolbarMount')),
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
            documentSaveExternalWorkflowController.preserveUnavailable(
              document,
              'deleted',
              document.filePath,
            ),
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
  const explorerFileTransactionController = new PURE.ExplorerFileTransactionController({
    fileAPI: window.fileAPI,
    getDocuments: () => state.tabs,
    nextUntitledName: async (parentPath, type) =>
      untitledItemName(await nextUntitledNumber(parentPath, type), type),
    fileName,
    openPath: (filePath) => openPath(filePath),
    confirmDelete: (entry) =>
      confirmDialog({ message: t('workspace.delete', { name: entry.name }), draggable: true }),
    getPathState: () => ({
      recentFiles: state.settings.recentFiles,
      workspaceTreeStates: state.settings.workspaceTreeStates,
    }),
    applyPathState: ({ recentFiles, workspaceTreeStates }) => {
      state.settings.recentFiles = recentFiles;
      state.settings.workspaceTreeStates = workspaceTreeStates;
    },
    persistPathState: (pathState) => queueSettingsSave(pathState, { throwOnFailure: true }),
    suspendWatches: (tabs) => suspendDocumentWatches(tabs),
    rebindWatches: (tabs) => rebindDocumentWatches(tabs),
    transitionBindings: (transition) => documentController.transitionBindings(transition),
    updateDocumentBinding: (tab, binding) =>
      updateTabDocument(tab, {
        filePath: binding.nextPath,
        fileIdentity: binding.fileIdentity,
        title: fileName(binding.nextPath),
        baseDir: binding.baseDir,
      }),
    preserveDeletedDocument: (tab) =>
      documentSaveExternalWorkflowController.preserveUnavailable(tab, 'deleted', tab.filePath),
    syncLocalResourceRoots: () => syncLocalResourceRoots(),
    rebuildEditors: (tabs) => rebuildRenamedEditors(tabs),
    renderDocuments: () => renderTabs(),
    updateActiveDocumentUI: () => updateActiveUI(),
    refreshTree: () => refreshTree(),
    persistSession: (throwOnFailure) => persistSession(throwOnFailure),
    showError: (error) => showMessage(ipcErrorMessage(error), true),
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
    renameEntry: (entry, name) => explorerFileTransactionController.rename(entry, name),
    deleteEntry: (entry) => explorerFileTransactionController.delete(entry),
    revealEntry: (filePath) => window.appAPI.showItemInFolder(filePath),
    createEntry: (parentPath, type) => explorerFileTransactionController.create(parentPath, type),
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
  const LOCALES = window.VditorDesktopLocales || {};
  const notifications = new PURE.NotificationsController(translateImpl, LOCALES, 'en_US');
  const settingsController = new PURE.SettingsController({
    store,
    save: (patch) => queueSettingsSave(patch, { throwOnFailure: true }),
  });
  const settingsPersistence = new PURE.SettingsPersistence({
    persistentKeys: PERSISTENT_STATE_KEYS,
    savePreferences: (settings) => window.appAPI.saveSettings(settings),
    savePersistentState: (settings) => window.appAPI.savePersistentState(settings),
    getCurrent: () => state.settings,
    setCurrent: (settings) => {
      state.settings = settings;
    },
    onFailure: (error) => console.error('Unable to persist settings.', error),
  });
  const settingsWindow = new PURE.SettingsWindow({
    modal: $('#settingsModal'),
    onClosed: (applyPresentation) => {
      if (applyPresentation) applyPresentationSettings();
    },
  });
  const settingsDialogLayoutController = new PURE.SettingsDialogLayoutController({
    card: $('.settings-card'),
    onPersist: (settingsDialogSize) => {
      state.settings.settingsDialogSize = settingsDialogSize;
      void queueSettingsSave({ settingsDialogSize });
    },
    onWindowResize: syncTopControlsWidth,
  });
  const settingsRuntimeController = new PURE.SettingsRuntimeController({
    form: $('#settingsForm'),
    settingsController,
    getSettings: () => state.settings,
    getDefaultSettings: () => state.defaultSettings,
    initializationSettings: PURE.VDITOR_INITIALIZATION_SETTINGS,
    getAppliedTheme: () => document.documentElement.dataset.theme || state.settings.theme,
    isDarkTheme,
    preferredCodeTheme,
    syncCodeThemeSelect,
    syncPreviewZoomVisibility: () => {
      const tab = activeTab();
      const mode = tab?.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab?.mode;
      $('#previewZoomSetting').classList.toggle('hidden', mode !== 'sv');
    },
    syncEditorTextWidthValue: () => {
      $('#editorTextWidthValue').textContent = `${$('#editorTextWidth').value}%`;
    },
    syncWorkspaceReadDepthValue,
    restoreDialogLayout: () =>
      settingsDialogLayoutController.restore(state.settings.settingsDialogSize),
    openWindow: () => settingsWindow.open(),
    closeWindow: () => closeSettings({ applyPresentation: false }),
    showConfirmDialog,
    translate: t,
    showMessage,
    errorMessage: ipcErrorMessage,
    reloadImages: () => imageRuntimeController.reload(state.tabs),
    applyLocale,
    hasWorkspace: () => Boolean(state.workspace),
    setWorkspaceWatch: (depth) => window.fileAPI.setWorkspaceWatch(state.workspace, depth),
    refreshWorkspaceTree: refreshTree,
    applyPresentation: applyPresentationSettings,
    resolveTheme,
    applyTheme,
    applyLiveEditorSettings: applyLiveVditorSettings,
    rebuildEditors: () => {
      const openModes = new Map(
        state.tabs.map((tab) => [
          tab.id,
          tab.vditor && tab.ready ? tab.vditor.getCurrentMode() : tab.mode,
        ]),
      );
      state.tabs.forEach((tab) => {
        updateTabDocument(tab, { mode: openModes.get(tab.id) || tab.mode });
        rebuildEditor(tab);
      });
    },
    refreshToolbarPreview: () => {
      if (!state.tabs.length) {
        destroyToolbarPreview();
        createToolbarPreview();
      }
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
  let closeAppMenu = () => {};
  let editorSelectionActive = false;
  let pendingTableCellSelection = null;
  let contextMenuState = null;
  const contextMenuController = new PURE.ContextMenuController($('#contextMenu'), () =>
    closeAppMenu(),
  );
  const statusMenuController = new PURE.StatusMenuController({
    document,
    modeTrigger: $('#statusMode'),
    modeMenu: $('#statusModeMenu'),
    themeTrigger: $('#statusThemeMode'),
    themeMenu: $('#statusThemeMenu'),
    getMode: () => {
      const tab = activeTab();
      return tab?.vditor && tab.ready ? tab.vditor.getCurrentMode() : null;
    },
    onBeforeThemeOpen: syncThemeModeControl,
    onSelectMode: selectStatusMode,
    onSelectThemeMode: selectStatusThemeMode,
  });
  const sidebarLayoutController = new PURE.SidebarLayoutController({
    app: $('#app'),
    sidebar: $('#sidebar'),
    toggle: $('#toggleSidebar'),
    menuBar: $('#appMenuBar'),
    titlebarActions: $('.titlebar-file-actions'),
    animatedElements: [$('#tabBar'), $('#vditorToolbarMount'), $('#editorArea')],
    chromeElements: [$('#tabBar'), $('#vditorToolbarMount')],
    getSidebarWidth: () => Number(state.settings.sidebarWidth),
    getSidebarVisible: () => state.settings.sidebarVisible,
    setSidebarVisible: (visible) => {
      state.settings.sidebarVisible = visible;
    },
    persistSidebarVisible: (visible) => void queueSettingsSave({ sidebarVisible: visible }),
    applyTopControlsWidth,
    syncTopControlsWidth,
    refreshEditorLayout: () => scheduleSplitLineNumbers(activeTab()),
    duration: sidebarTransitionDuration,
  });
  const appTooltipController = new PURE.AppTooltipController({
    tooltip: $('#appTooltip'),
    sidebar: $('#sidebar'),
    window,
  });
  const documentLinkNavigationController = new PURE.DocumentLinkNavigationController({
    adapter: VDITOR,
    platform: window.appAPI.platform,
    translate: t,
    showMessage,
    showTooltip: (text, event) => appTooltipController.show(text, event),
    hideTooltip: () => appTooltipController.hide(),
    resolveMarkdownLink: (sourcePath, href) => window.fileAPI.resolveMarkdownLink(sourcePath, href),
    openPath: (filePath, activate, fragment) => openPath(filePath, activate, fragment),
    openExternal: (href) => window.appAPI.openExternal(href),
    scrollToHeading,
  });

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
    toolbarController.syncAvailability(shouldSyncWrapHeight);
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
    toolbarController.disablePreview(preview);
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
    await documentWatchController.watchDocument(tab);
  }
  async function releaseDocumentWatch(filePath, identity) {
    await documentWatchController.release(filePath, identity);
  }
  async function suspendDocumentWatches(tabs) {
    await documentWatchController.suspend(tabs);
  }
  async function rebindDocumentWatches(tabs) {
    await documentWatchController.rebind(tabs);
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
    const onWheel = (event) => {
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
    };
    tabBar.addEventListener('wheel', onWheel, { passive: false });
    return () => tabBar.removeEventListener('wheel', onWheel);
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
    toolbarController.restore(tab);
  }

  function mountEditorToolbar(tab) {
    toolbarController.mountRuntime(tab);
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
    await documentTabWorkflowController.openPaths(paths || []);
  }

  function scrollToPendingAnchor(tab) {
    if (!tab.pendingAnchor || tab.id !== state.activeId || !tab.ready) return;
    const href = `#${tab.pendingAnchor}`;
    tab.pendingAnchor = '';
    const headingIndex = VDITOR.headingIndexForAnchor(tab.host, href);
    if (headingIndex >= 0) scrollToHeading(tab, headingIndex);
  }

  async function openPath(filePath, activate = true, pendingAnchor = '') {
    return documentTabWorkflowController.openPath(filePath, activate, pendingAnchor);
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
    await documentTabWorkflowController.createUntitled();
  }

  function switchTab(id) {
    documentTabWorkflowController.activate(id);
  }

  async function closeTab(id, { discard = false } = {}) {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    if (contextMenuState?.tab === tab) closeContextMenu();
    await documentTabWorkflowController.close(id, discard);
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
      documentSaveExternalWorkflowController.save(
        tab,
        saveAs,
        overwriteConflict,
        recreateFileState,
      ),
    );
  }

  function queueSettingsSave(settings, { throwOnFailure = false } = {}) {
    return settingsPersistence.save(settings, throwOnFailure);
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
    await recoveryRestoreController.restoreAll();
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
      statusMenuController.closeMode();
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
    statusMenuController.syncMode(currentMode);
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

  function themeModeFromSettings() {
    return resolveThemeModeImpl(state.settings);
  }

  function syncThemeModeControl() {
    const mode = themeModeFromSettings();
    const labelKey = `themeMode.${mode}`;
    statusMenuController.syncTheme({ mode, labelKey, label: t(labelKey) });
  }

  function selectStatusMode(mode) {
    const tab = activeTab();
    if (!tab?.vditor || !tab.ready || mode === tab.vditor.getCurrentMode()) return;
    VDITOR.selectEditMode(tab.toolbar, mode);
  }

  async function selectStatusThemeMode(mode) {
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
    await documentSaveExternalWorkflowController.reloadExternalChange(tab);
  }

  async function confirmExternalOverwrite(tab, queuedIdentity = null, selectedDestination = null) {
    if (!tab) return false;
    return documentSaveExternalWorkflowController.confirmExternalOverwrite(tab);
  }

  async function reloadReappearedFile(tab) {
    await documentSaveExternalWorkflowController.reloadReappearedFile(tab);
  }

  async function keepExternalFileAsUntitled(tab) {
    await documentSaveExternalWorkflowController.keepAsUntitled(tab);
  }

  async function confirmExternalFileRecreate(tab, recreate) {
    if (!tab) return false;
    return documentSaveExternalWorkflowController.recreateFile(tab);
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
    documentSaveExternalWorkflowController.ignoreExternalChange(tab);
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

  function setupDocumentAnchorNavigation(tab) {
    editorController.attachDocumentAnchorNavigation(
      tab,
      documentLinkNavigationController.handlersFor(tab),
    );
  }

  async function handleImageUpload(tab, files) {
    return imageController.upload(tab, files);
  }

  const exportHtmlBuilder = new PURE.ExportHtmlBuilder({
    adapter: VDITOR,
    createLocalResourceBase: localResourceBase,
    escapeHTML,
    stripExtension,
    fetch: window.fetch.bind(window),
  });
  const exportController = new PURE.ExportController({
    getActiveDocument: () => activeTab(),
    fileAPI: window.fileAPI,
    appAPI: window.appAPI,
    getDefaultDirectory: () => state.settings.defaultOpenPath || undefined,
    snapshotBody: (tab) => exportHtmlBuilder.snapshotBody(tab),
    normalizeBody: (body, tab, outputDirectory) =>
      exportHtmlBuilder.normalizeBody(body, tab, outputDirectory),
    embedImages: (body, tab) => exportHtmlBuilder.embedImages(body, tab),
    makeHTML: (tab, body, outputDirectory) =>
      exportHtmlBuilder.makeHTML(tab, body, outputDirectory),
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
    return sessionRestoreController.persist(throwOnFailure);
  }

  function openSettings() {
    settingsRuntimeController.open();
  }

  function closeSettings({ applyPresentation = true } = {}) {
    return settingsWindow.close(applyPresentation);
  }
  async function saveSettings(closeAfterSave = true) {
    await settingsRuntimeController.save(closeAfterSave);
  }

  async function resetCurrentSettingsPage() {
    await settingsRuntimeController.resetCurrentPage($('[data-settings-panel].active'));
  }

  async function scheduleLiveSettingsSave(event) {
    await settingsRuntimeController.scheduleLiveSave(event);
  }

  function syncWorkspaceReadDepthValue() {
    const input = $('#settingsForm [name="workspaceReadDepth"]');
    const output = $('#workspaceReadDepthValue');
    if (input && output) output.textContent = input.value;
  }

  async function handleExternalChange(change) {
    await externalFileChangeController.handle(change);
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

  function toggleSidebar(force) {
    sidebarLayoutController.toggle(force);
  }

  function setupApplicationShellResources(resources) {
    setupAppMenus();
    windowController.init();
    statusMenuController.init();
    resources.add(() => statusMenuController.dispose());
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
    $('#statusSettings').onclick = openSettings;
    $('#refreshTree').onclick = refreshTree;
    resources.listen($('#fileTree'), 'contextmenu', (event) => {
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
    resources.listen($('#settingsForm'), 'change', scheduleLiveSettingsSave);
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
    settingsDialogLayoutController.init();
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
      resources.timeout(vanessaEasterEggTimer);
      if (vanessaEasterEggClicks < 10) return;
      vanessaEasterEggClicks = 0;
      window.appAPI.openExternal('https://github.com/Vanessa219');
    };
    $$('[data-external]').forEach((element) => {
      element.onclick = () => window.appAPI.openExternal(element.dataset.external);
    });
    resources.listen(document, 'pointerdown', (event) => {
      if (!event.target.closest('#contextMenu')) closeContextMenu();
    });
    const mainMenuButton = $('.app-menu-bar > button[data-menu="main"]');
    if (mainMenuButton)
      resources.listen(mainMenuButton, 'mousemove', updateMainMenuGlow, { passive: true });
    resources.listen(
      document,
      'pointerdown',
      (event) => updateEditorSelectionActivity(event.target),
      true,
    );
    resources.listen(
      document,
      'focusin',
      (event) => updateEditorSelectionActivity(event.target, true),
      true,
    );
    resources.listen(
      document,
      'keydown',
      (event) => documentLinkNavigationController.updateHoveredCursor(event),
      true,
    );
    resources.listen(
      document,
      'keyup',
      (event) => documentLinkNavigationController.updateHoveredCursor(event),
      true,
    );
    resources.listen(
      document,
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
    resources.listen(window, 'blur', () => {
      editorSelectionActive = false;
      closeContextMenu();
      statusMenuController.closeAll();
      clearHoveredDocumentLink();
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
    resources.listen(window, 'mousemove', (event) => {
      if (resizing) {
        pendingSidebarWidth = Math.max(resizeMinimum, Math.min(500, event.clientX - resizeAppLeft));
        if (resizeFrame === null) {
          resizeFrame = requestAnimationFrame(applySidebarResize);
          resources.animationFrame(resizeFrame);
        }
      }
    });
    resources.listen(window, 'mouseup', () => {
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
        resources.animationFrame(
          requestAnimationFrame(() => scheduleSplitLineNumbers(activeTab())),
        );
        queueSettingsSave({ sidebarWidth: state.settings.sidebarWidth });
      }
    });
    const topControlsObserver = new ResizeObserver(() => {
      if (!resizing) syncTopControlsWidth();
    });
    topControlsObserver.observe($('#sidebar'));
    topControlsObserver.observe($('#appMenuBar'));
    resources.observeResize(topControlsObserver);
    const toolbarMount = $('#vditorToolbarMount');
    const toolbarResizeObserver = new ResizeObserver(syncToolbarWrapHeight);
    toolbarResizeObserver.observe(toolbarMount);
    resources.observeResize(toolbarResizeObserver);
    const toolbarMutationObserver = new MutationObserver(scheduleToolbarWrapHeight);
    toolbarMutationObserver.observe(toolbarMount, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['hidden', 'style'],
    });
    resources.observeMutations(toolbarMutationObserver);
    syncToolbarWrapHeight();
    resources.add(setupAutoHideScrollbar($('#fileTree')) || (() => {}));
    resources.add(setupAutoHideScrollbar($('#outlineTree')) || (() => {}));
    appTooltipController.init();
    resources.add(setupAutoHideScrollbar($('#settingsForm')) || (() => {}));
    resources.add(setupAutoHideScrollbar($('#tabBar')) || (() => {}));
    resources.add(setupTabWheelScrolling($('#tabBar')));
    resources.add(setupAutoHideScrollbar($('.confirm-content')) || (() => {}));
    resources.add(
      window.appAPI.onSystemThemeChanged((theme) => {
        if (state.settings.systemTheme) void applyTheme(mapSystemTheme(theme));
      }),
    );
    resources.add(window.fileAPI.onChanged(handleExternalChange));
    resources.add(
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
      }),
    );
  }

  function beforeAppShortcut(event) {
    if (pendingTableCellSelection?.event === event) {
      const { selection } = pendingTableCellSelection;
      pendingTableCellSelection = null;
      if (!event.defaultPrevented) VDITOR.selectTableCellContents(selection.cell, selection.editor);
    }
    if (event.key === 'Escape' && !$('#contextMenu').classList.contains('hidden')) {
      event.preventDefault();
      closeContextMenu();
      return true;
    }
    if (event.key === 'Escape' && !$('#confirmModal').classList.contains('hidden')) {
      event.preventDefault();
      closeConfirmDialog('cancel');
      return true;
    }
    if (event.key === 'Escape' && statusMenuController.isModeOpen()) {
      event.preventDefault();
      statusMenuController.closeMode();
      $('#statusMode').focus({ preventScroll: true });
      return true;
    }
    if (event.key === 'Escape' && statusMenuController.isThemeOpen()) {
      event.preventDefault();
      statusMenuController.closeTheme();
      $('#statusThemeMode').focus({ preventScroll: true });
      return true;
    }
    if (event.key === 'Escape' && !$('#settingsModal').classList.contains('hidden')) {
      event.preventDefault();
      void closeSettings();
      return true;
    }
    if (event.key === 'Alt' && $('#app').classList.contains('fullscreen')) {
      event.preventDefault();
      $('#app').classList.toggle('fullscreen-menu-visible');
      return true;
    }
    if (event.key === 'Escape') $('#app').classList.remove('fullscreen-menu-visible');
    if (event.key === 'F11') {
      event.preventDefault();
      window.appAPI.toggleFullscreen();
      return true;
    }
    return false;
  }

  async function loadInitialSettings() {
    document.body.dataset.platform = window.appAPI.platform;
    settingsController.load(
      await window.appAPI.getSettings(),
      await window.appAPI.getDefaultSettings(),
    );
    state.settings = {
      ...state.settings,
      ...(await window.appAPI.getPersistentState()),
    };
  }

  async function initializeAppUI() {
    applicationShellController.init();
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
  }

  async function restoreWorkspaceSession() {
    await sessionRestoreController.restoreWorkspace();
  }

  async function restoreDocumentSession() {
    await sessionRestoreController.restoreDocuments();
  }

  async function finishAppRestoration() {
    await sessionRestoreController.finishRestoration();
  }

  function disposeAppDomains() {
    applicationShellController.dispose();
    sidebarLayoutController.dispose();
    appTooltipController.dispose();
    settingsDialogLayoutController.dispose();
    settingsWindow.dispose();
    settingsRuntimeController.dispose();
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
  }

  const applicationShellController = new PURE.ApplicationShellController({
    document,
    setup: setupApplicationShellResources,
  });

  window.__vditorDesktopApplication = new PURE.AppController({
    document,
    window,
    startup: {
      loadSettings: loadInitialSettings,
      applyLocale: () => applyLocale(state.settings.locale),
      initializeUI: initializeAppUI,
      restoreWorkspace: restoreWorkspaceSession,
      restoreSession: restoreDocumentSession,
      restoreRecovery: restoreRecoverySnapshots,
      finishRestoration: finishAppRestoration,
      dispose: disposeAppDomains,
    },
    commands: {
      beforeShortcut: beforeAppShortcut,
      selectAll: (event) => {
        if (selectEditorContextOrAll(event)) return;
        if (!keepsNativeSelectAll(event.target)) event.preventDefault();
      },
      save: (saveAs) => void saveTab(activeTab(), saveAs),
      openFiles: () => void chooseFiles(),
      openFolder: () => void chooseFolder(),
      newDocument: () => void newTab(),
      toggleSidebar: () => toggleSidebar(),
      find: () => findController.open(),
      settings: openSettings,
      closeDocument: () => {
        const tab = activeTab();
        if (tab) void closeTab(tab.id);
      },
      closeWindow: () => window.appAPI.closeWindow(),
      openPaths,
      menu: handleMenu,
      rejectDrop: () => showMessage(t('message.dropMarkdownOnly'), true),
    },
    bridge: {
      onOpenFiles: (callback) => window.appAPI.onOpenFiles(callback),
      onMenuAction: (callback) => window.appAPI.onMenuAction(callback),
      getDroppedPath: (file) => window.fileAPI.getDroppedPath(file),
      rendererReady: () => window.appAPI.rendererReady(),
    },
    reportError: (error) => showMessage(ipcErrorMessage(error), true),
  });
})();
