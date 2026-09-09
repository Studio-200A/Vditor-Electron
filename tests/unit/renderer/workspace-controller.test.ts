import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentController } from '../../../src/renderer/documents/document-controller';
import { AppStore } from '../../../src/renderer/state/store';
import { ExplorerController } from '../../../src/renderer/workspace/explorer-controller';
import { WorkspaceController } from '../../../src/renderer/workspace/workspace-controller';

describe('WorkspaceController', () => {
  it('updates the root, replaces the workspace watch, and persists confirmed workspace state', async () => {
    const store = new AppStore();
    const setWorkspaceWatch = vi.fn().mockResolvedValue(undefined);
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const renderWorkspace = vi.fn();
    const persistSession = vi.fn();
    const controller = new WorkspaceController({
      store,
      fileAPI: { setWorkspaceWatch },
      getSettings: () => ({ workspaceReadDepth: 7, recentPaths: ['/old'] }),
      saveSettings,
      renderWorkspace,
      syncLocalResourceRoots: vi.fn().mockResolvedValue(undefined),
      requestTreeRefresh: refresh,
      persistSession,
      onWorkspacePathUnavailable: vi.fn().mockResolvedValue(undefined),
      isWorkspaceAvailable: vi.fn().mockResolvedValue(true),
      onWorkspaceWatchError: vi.fn(),
    });

    await controller.setWorkspace('/notes');

    expect(store.getState().workspacePath).toBe('/notes');
    expect(setWorkspaceWatch).toHaveBeenCalledWith('/notes', 7);
    expect(refresh).toHaveBeenCalledWith(1);
    expect(renderWorkspace).toHaveBeenCalledWith('/notes');
    expect(saveSettings).toHaveBeenCalledWith({
      recentPaths: ['/notes', '/old'],
      defaultOpenPath: '/notes',
    });
    expect(persistSession).toHaveBeenCalledTimes(1);
  });

  it('routes unavailable workspace paths through the document-binding owner before refreshing', async () => {
    vi.useFakeTimers();
    const unavailable = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const setWorkspaceWatch = vi.fn().mockResolvedValue(undefined);
    const controller = new WorkspaceController({
      store: new AppStore({ workspacePath: '/notes', workspaceRevision: 1 }),
      fileAPI: { setWorkspaceWatch },
      getSettings: () => ({ workspaceReadDepth: 7 }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      renderWorkspace: vi.fn(),
      syncLocalResourceRoots: vi.fn().mockResolvedValue(undefined),
      requestTreeRefresh: refresh,
      persistSession: vi.fn(),
      onWorkspacePathUnavailable: unavailable,
      isWorkspaceAvailable: vi.fn().mockResolvedValue(false),
      onWorkspaceWatchError: vi.fn(),
    });

    await controller.handleWatcherEvent({ event: 'unlinkDir', path: '/notes', scope: 'workspace' });

    expect(unavailable).toHaveBeenCalledWith({
      event: 'unlinkDir',
      path: '/notes',
      scope: 'workspace',
    });
    expect(setWorkspaceWatch).toHaveBeenCalledWith(undefined, 7);
    controller.dispose();
    vi.useRealTimers();
  });
});

describe('ExplorerController', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body><div id="fileTree"></div></body>');
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('Element', dom.window.Element);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders untrusted names as text and persists expansion through its semantic callback', async () => {
    const store = new AppStore({ workspacePath: '/notes', workspaceRevision: 1 });
    const saveExpansion = vi.fn();
    const openPath = vi.fn().mockResolvedValue(undefined);
    const controller = new ExplorerController({
      store,
      fileAPI: {
        listDir: vi.fn().mockImplementation(async (path: string) =>
          path === '/notes'
            ? [
                { name: '<unsafe>.md', path: '/notes/<unsafe>.md', type: 'file' as const },
                { name: 'docs', path: '/notes/docs', type: 'directory' as const },
              ]
            : [{ name: 'guide.md', path: '/notes/docs/guide.md', type: 'file' as const }],
        ),
        createItem: vi.fn(),
      },
      fileTree: dom.window.document.getElementById('fileTree') as HTMLElement,
      getSettings: () => ({
        restoreWorkspace: true,
        workspaceReadDepth: 7,
        fileExplorer: { visibleExtensions: ['md'] },
      }),
      translate: (key) => key,
      treeIcon: () => '<svg></svg>',
      openPath,
      chooseWorkspace: vi.fn().mockResolvedValue(undefined),
      showMessage: vi.fn(),
      showContextMenu: vi.fn(),
      renameEntry: vi.fn(),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      revealEntry: vi.fn().mockResolvedValue(undefined),
      createEntry: vi.fn().mockResolvedValue(undefined),
      openWorkspaceInFolder: vi.fn().mockResolvedValue(undefined),
      saveExpansion,
      updateActiveSelection: vi.fn(),
    });

    await controller.refresh(1);

    const unsafe = dom.window.document.querySelector('.tree-name');
    expect(unsafe?.textContent).toBe('<unsafe>.md');
    expect(dom.window.document.querySelector('.tree-name img')).toBeNull();
    const file = dom.window.document.querySelector<HTMLElement>('.tree-file');
    file?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(openPath).toHaveBeenCalledWith('/notes/<unsafe>.md');

    const directory = dom.window.document.querySelector<HTMLElement>('.tree-dir');
    directory?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(saveExpansion).toHaveBeenCalledWith('/notes', ['/notes/docs']);
    expect(dom.window.document.querySelector('.tree-children .tree-file')).not.toBeNull();
  });
});

describe('DocumentController binding transitions', () => {
  it('recovers a prepared transition when committing its new binding fails', async () => {
    const recovered = vi.fn().mockResolvedValue(undefined);
    const controller = new DocumentController({
      fileBridge: {
        fileIdentity: vi.fn(),
        readFile: vi.fn(),
        dirname: vi.fn(),
      },
      findDocumentByIdentity: () => null,
      createDocument: () => null,
      prepareDocumentResources: vi.fn(),
      onExistingDocument: vi.fn(),
      onDocumentOpened: vi.fn(),
      onDocumentNotCreated: vi.fn(),
      readDocumentContent: () => '',
    });

    await expect(
      controller.transitionBindings({
        prepare: async () => 'prepared',
        commit: async () => {
          throw new Error('commit failed');
        },
        recover: recovered,
      }),
    ).rejects.toThrow('commit failed');

    expect(recovered).toHaveBeenCalledWith('prepared', expect.any(Error));
  });
});
