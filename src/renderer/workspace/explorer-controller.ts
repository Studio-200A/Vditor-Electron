import type { FileAPI } from '../types/bridges.js';
import type { AppStore } from '../state/store.js';

export interface ExplorerEntry {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly link?: {
    readonly status: 'inside-workspace' | 'outside-workspace';
    readonly targetPath: string;
    readonly targetsWorkspaceRoot: boolean;
    readonly workspaceDepth?: number;
  };
}

export interface ExplorerSettings {
  readonly restoreWorkspace: boolean;
  readonly workspaceReadDepth: number;
  readonly fileExplorer: { readonly visibleExtensions?: readonly string[] };
  readonly workspaceTreeStates?: readonly {
    readonly workspacePath: string;
    readonly expandedPaths: readonly string[];
  }[];
}

export interface ExplorerControllerOptions {
  readonly store: AppStore;
  readonly fileAPI: Pick<FileAPI, 'listDir' | 'createItem'>;
  readonly fileTree: HTMLElement;
  readonly getSettings: () => ExplorerSettings;
  readonly translate: (key: string) => string;
  readonly treeIcon: (entry: ExplorerEntry) => string;
  readonly openPath: (path: string) => Promise<void>;
  readonly chooseWorkspace: () => Promise<void>;
  readonly showMessage: (message: string, isError?: boolean) => void;
  readonly showContextMenu: (
    event: MouseEvent,
    items: readonly {
      readonly label: string;
      readonly disabled?: boolean;
      readonly action: () => void;
    }[],
  ) => void;
  readonly renameEntry: (entry: ExplorerEntry, name: string) => Promise<void>;
  readonly deleteEntry: (entry: ExplorerEntry) => Promise<void>;
  readonly revealEntry: (path: string) => Promise<void>;
  readonly createEntry: (parentPath: string, type: 'file' | 'directory') => Promise<void>;
  readonly openWorkspaceInFolder: (path: string) => Promise<void>;
  readonly saveExpansion: (workspacePath: string, expandedPaths: readonly string[]) => void;
  readonly updateActiveSelection: () => void;
}

/** Owns application-owned file tree DOM and its expansion lifecycle. */
export class ExplorerController {
  private readonly store: AppStore;
  private readonly fileAPI: ExplorerControllerOptions['fileAPI'];
  private readonly fileTree: HTMLElement;
  private readonly getSettings: ExplorerControllerOptions['getSettings'];
  private readonly translate: ExplorerControllerOptions['translate'];
  private readonly treeIcon: ExplorerControllerOptions['treeIcon'];
  private readonly openPath: ExplorerControllerOptions['openPath'];
  private readonly chooseWorkspace: ExplorerControllerOptions['chooseWorkspace'];
  private readonly showMessage: ExplorerControllerOptions['showMessage'];
  private readonly showContextMenu: ExplorerControllerOptions['showContextMenu'];
  private readonly renameEntry: ExplorerControllerOptions['renameEntry'];
  private readonly deleteEntry: ExplorerControllerOptions['deleteEntry'];
  private readonly revealEntry: ExplorerControllerOptions['revealEntry'];
  private readonly createEntry: ExplorerControllerOptions['createEntry'];
  private readonly openWorkspaceInFolder: ExplorerControllerOptions['openWorkspaceInFolder'];
  private readonly saveExpansion: ExplorerControllerOptions['saveExpansion'];
  private readonly updateActiveSelection: ExplorerControllerOptions['updateActiveSelection'];

  constructor(options: ExplorerControllerOptions) {
    this.store = options.store;
    this.fileAPI = options.fileAPI;
    this.fileTree = options.fileTree;
    this.getSettings = options.getSettings;
    this.translate = options.translate;
    this.treeIcon = options.treeIcon;
    this.openPath = options.openPath;
    this.chooseWorkspace = options.chooseWorkspace;
    this.showMessage = options.showMessage;
    this.showContextMenu = options.showContextMenu;
    this.renameEntry = options.renameEntry;
    this.deleteEntry = options.deleteEntry;
    this.revealEntry = options.revealEntry;
    this.createEntry = options.createEntry;
    this.openWorkspaceInFolder = options.openWorkspaceInFolder;
    this.saveExpansion = options.saveExpansion;
    this.updateActiveSelection = options.updateActiveSelection;
  }

  async refresh(revision: number): Promise<void> {
    const workspacePath = this.store.getState().workspacePath;
    if (!workspacePath) {
      const button = document.createElement('button');
      button.id = 'openFolderEmpty';
      button.className = 'empty-action';
      button.textContent = this.translate('sidebar.openFolder');
      button.addEventListener('click', () => void this.chooseWorkspace());
      this.fileTree.replaceChildren(button);
      return;
    }
    const content = document.createDocumentFragment();
    await this.appendDirectory(content, workspacePath, 0, new Set([workspacePath]));
    const state = this.store.getState();
    if (state.workspacePath !== workspacePath || state.workspaceRevision !== revision) return;
    this.fileTree.replaceChildren(content);
    this.updateActiveSelection();
  }

  showEntryContextMenu(event: MouseEvent, entry: ExplorerEntry, row: HTMLElement): void {
    event.preventDefault();
    this.showContextMenu(event, [
      { label: this.translate('context.rename'), action: () => this.beginRename(entry, row) },
      { label: this.translate('context.trash'), action: () => void this.deleteEntry(entry) },
      { label: this.translate('context.reveal'), action: () => void this.revealEntry(entry.path) },
    ]);
  }

  private beginRename(entry: ExplorerEntry, row: HTMLElement): void {
    const label = row.querySelector<HTMLElement>('.tree-name');
    if (!label) return;
    const input = document.createElement('input');
    input.className = 'tree-rename-input';
    input.value = entry.name;
    label.replaceWith(input);
    let settled = false;
    const finish = async (commit: boolean): Promise<void> => {
      if (settled) return;
      settled = true;
      const name = this.renameName(entry, input.value.trim());
      if (!commit || !name || name === entry.name) {
        if (input.isConnected) input.replaceWith(label);
        return;
      }
      await this.renameEntry(entry, name);
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

  private renameName(entry: ExplorerEntry, proposedName: string): string {
    const extensionStart = entry.type === 'file' ? entry.name.lastIndexOf('.') : -1;
    if (extensionStart <= 0) return proposedName;
    const extension = entry.name.slice(extensionStart);
    const keepsExtension = proposedName.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase());
    const proposedExtensionStart = proposedName.lastIndexOf('.');
    const stem = keepsExtension
      ? proposedName.slice(0, -extension.length)
      : proposedExtensionStart > 0
        ? proposedName.slice(0, proposedExtensionStart)
        : proposedName;
    return stem ? `${stem}${extension}` : '';
  }

  showWorkspaceContextMenu(
    event: MouseEvent,
    parentPath = this.store.getState().workspacePath,
  ): void {
    event.preventDefault();
    const workspacePath = this.store.getState().workspacePath;
    this.showContextMenu(event, [
      {
        label: this.translate('context.changeWorkspace'),
        action: () => void this.chooseWorkspace(),
      },
      {
        label: this.translate('context.newFile'),
        disabled: !parentPath,
        action: () => void this.createEntry(parentPath, 'file'),
      },
      {
        label: this.translate('context.newFolder'),
        disabled: !parentPath,
        action: () => void this.createEntry(parentPath, 'directory'),
      },
      {
        label: this.translate('context.openWorkspace'),
        disabled: !workspacePath,
        action: () => void this.openWorkspaceInFolder(workspacePath),
      },
    ]);
  }

  private expandedPaths(): Set<string> {
    const { workspacePath } = this.store.getState();
    const settings = this.getSettings();
    if (!settings.restoreWorkspace || !workspacePath) return new Set();
    return new Set(
      settings.workspaceTreeStates?.find((item) => item.workspacePath === workspacePath)
        ?.expandedPaths ?? [],
    );
  }

  private persistExpansion(directoryPath: string, expanded: boolean): void {
    const { workspacePath } = this.store.getState();
    const settings = this.getSettings();
    if (!settings.restoreWorkspace || !workspacePath) return;
    const current = settings.workspaceTreeStates?.find(
      (item) => item.workspacePath === workspacePath,
    );
    const expandedPaths = new Set(current?.expandedPaths ?? []);
    if (expanded) expandedPaths.add(directoryPath);
    else expandedPaths.delete(directoryPath);
    this.saveExpansion(workspacePath, [...expandedPaths].slice(0, 500));
  }

  private async appendDirectory(
    container: DocumentFragment | HTMLElement,
    directoryPath: string,
    depth: number,
    ancestors: ReadonlySet<string>,
  ): Promise<void> {
    let entries: ExplorerEntry[];
    try {
      entries = await this.fileAPI.listDir(directoryPath, this.store.getState().workspacePath);
    } catch (error) {
      this.showMessage(error instanceof Error ? error.message : String(error), true);
      return;
    }
    const extensions = (this.getSettings().fileExplorer.visibleExtensions ?? ['md']).map(
      (extension) => extension.replace(/^\./, '').toLowerCase(),
    );
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (
        entry.type === 'file' &&
        !extensions.includes(entry.name.split('.').pop()?.toLowerCase() ?? '')
      )
        continue;
      const row = document.createElement('div');
      row.className = `tree-row tree-${entry.type === 'directory' ? 'dir' : 'file'}`;
      row.dataset.path = entry.path;
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = entry.type === 'directory' ? '›' : '';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.innerHTML = this.treeIcon(entry);
      const label = document.createElement('span');
      label.className = 'tree-name';
      label.dataset.tooltip = entry.name;
      label.textContent = entry.name;
      row.append(chevron, icon, label);
      if (entry.link) {
        row.classList.add('tree-link');
        row.dataset.linkStatus = entry.link.status;
        row.dataset.tooltip = this.translate('workspace.linkTitle');
      }
      container.appendChild(row);
      row.addEventListener('contextmenu', (event) => this.showEntryContextMenu(event, entry, row));
      if (entry.type === 'file') {
        row.addEventListener('click', () => void this.openPath(entry.path));
        continue;
      }
      await this.appendDirectoryEntry(container, row, entry, depth, ancestors, chevron);
    }
  }

  private async appendDirectoryEntry(
    container: DocumentFragment | HTMLElement,
    row: HTMLElement,
    entry: ExplorerEntry,
    depth: number,
    ancestors: ReadonlySet<string>,
    chevron: HTMLElement,
  ): Promise<void> {
    const children = document.createElement('div');
    children.className = 'tree-children';
    children.dataset.parentPath = entry.path;
    container.appendChild(children);
    const targetDepth = entry.link?.workspaceDepth ?? depth + 1;
    const createsCycle = Boolean(
      entry.link && (entry.link.targetsWorkspaceRoot || ancestors.has(entry.link.targetPath)),
    );
    if (entry.link?.status === 'outside-workspace' || createsCycle) {
      const message = this.translate(
        createsCycle ? 'workspace.linkCycle' : 'workspace.linkOutsideWorkspace',
      );
      row.classList.add('depth-limited', createsCycle ? 'tree-link-cycle' : 'tree-link-outside');
      chevron.textContent = '·';
      const notice = document.createElement('div');
      notice.className = 'tree-depth-notice';
      notice.textContent = message;
      children.classList.add('depth-limit');
      children.appendChild(notice);
      row.addEventListener('click', () => this.showMessage(message));
      return;
    }
    if (targetDepth >= this.getSettings().workspaceReadDepth) {
      row.classList.add('depth-limited');
      chevron.textContent = '·';
      const message = this.translate('workspace.depthLimited');
      const notice = document.createElement('div');
      notice.className = 'tree-depth-notice';
      notice.textContent = message;
      children.classList.add('depth-limit');
      children.appendChild(notice);
      row.addEventListener('click', () => this.showMessage(message));
      return;
    }
    const loadChildren = async (): Promise<void> => {
      if (children.dataset.loaded) return;
      children.dataset.loaded = 'true';
      await this.appendDirectory(
        children,
        entry.path,
        targetDepth,
        new Set([...ancestors, entry.link?.targetPath ?? entry.path]),
      );
    };
    row.setAttribute('aria-expanded', 'false');
    row.addEventListener('click', () => {
      const expanded = row.classList.toggle('expanded');
      chevron.textContent = expanded ? '⌄' : '›';
      row.setAttribute('aria-expanded', String(expanded));
      this.persistExpansion(entry.path, expanded);
      if (expanded) void loadChildren();
    });
    if (this.expandedPaths().has(entry.path)) {
      row.classList.add('expanded');
      row.setAttribute('aria-expanded', 'true');
      chevron.textContent = '⌄';
      await loadChildren();
    }
  }
}
