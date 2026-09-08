declare global {
  interface Window {
    appAPI: AppAPI;
    fileAPI: FileAPI;
  }
}

export type SupportedPlatform = 'linux' | 'darwin' | 'win32';

export interface FileChangedEvent {
  event:
    'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'rename' | 'unreadable' | 'watch-error';
  path: string;
  previousPath?: string;
  identity?: string;
  scope: 'workspace' | 'document';
  content?: string;
  encoding?: string;
  error?: 'permission-denied' | 'read-failed' | 'resource-limit';
}

export interface FileInfo {
  app: string;
  electron: string;
}

export type Unsubscribe = () => void;

export type ResourceHealthActionCode =
  | 'trashed'
  | 'revalidated-as-referenced'
  | 'changed-since-scan'
  | 'outside-workspace'
  | 'unsupported'
  | 'scan-incomplete'
  | 'not-found'
  | 'failed';

export interface ResourceHealthScanSummary {
  schemaVersion: 1;
  revision: string;
  documentRelativePath: string;
  imageDirectoryRelativePath: string;
  workspaceName: string;
  savedAt: number;
  completedAt: number;
  scannedSourceFiles: number;
  candidates: readonly {
    id: string;
    relativePath: string;
    name: string;
    size: number;
    modifiedAt: number;
    previewAvailable: boolean;
  }[];
  missingReferences: readonly {
    targetPath: string;
    source: string;
    locations: readonly { line: number; column: number; raw: string }[];
  }[];
  candidateBytes: number;
  limitations: {
    complete: boolean;
    skipped: Readonly<Record<string, number>>;
  };
}

export interface ResourceHealthActionResult {
  id: string;
  code: ResourceHealthActionCode;
}

export interface FileAPI {
  openFileDialog(defaultDirectory?: string): Promise<string | null>;
  openFolderDialog(defaultDirectory?: string): Promise<string | null>;
  saveFileDialog(defaultPath?: string, defaultDirectory?: string): Promise<string | null>;
  exportDialog(
    type: 'html' | 'pdf',
    defaultPath?: string,
    defaultDirectory?: string,
  ): Promise<string | null>;
  readFile(filePath: string): Promise<{ content: string; encoding: string }>;
  writeFile(filePath: string, content: string): Promise<void>;
  writeDocument(
    filePath: string,
    content: string,
    expectedContent?: string,
    expectedAbsent?: boolean,
  ): Promise<{ ok: boolean; error?: string }>;
  writeBinaryFile(filePath: string, bytes: Uint8Array): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  fileIdentity(filePath: string): Promise<string | null>;
  listDir(
    dirPath: string,
    workspacePath?: string,
  ): Promise<
    Array<{
      name: string;
      path: string;
      type: 'file' | 'directory';
      isSymlink?: boolean;
    }>
  >;
  createItem(parent: string, name: string, type: 'file' | 'directory'): Promise<string>;
  renameItem(oldPath: string, newName: string): Promise<string>;
  prepareRename(oldPath: string, newName: string): Promise<{ allowed: boolean; reason?: string }>;
  deleteItem(filePath: string): Promise<void>;
  basename(filePath: string): Promise<string>;
  dirname(filePath: string): Promise<string>;
  relative(from: string, to: string): Promise<string>;
  rebasePath(oldRoot: string, newRoot: string, candidatePath: string): Promise<string>;
  resolveMarkdownLink(sourceFile: string, href: string): Promise<string | null>;
  setWorkspaceWatch(rootPath?: string, depth?: number): Promise<void>;
  watchDocument(filePath: string, reconcile?: boolean): Promise<void>;
  unwatchDocument(filePath: string, identity?: string): Promise<void>;
  resolveRenamedDocument(filePath: string): Promise<string | null>;
  setResourceRoots(rootPaths: string[]): Promise<void>;
  onChanged(callback: (event: FileChangedEvent) => void): Unsubscribe;
  getDroppedPath(file: File): string;
}

export interface AppAPI {
  readonly platform: SupportedPlatform;
  getSettings(): Promise<Record<string, unknown>>;
  getPersistentState(): Promise<Record<string, unknown>>;
  getRecoveryCandidates(): Promise<Array<Record<string, unknown>>>;
  restoreRecovery(id: string): Promise<Record<string, unknown> | null>;
  saveRecovery(snapshot: Record<string, unknown>): Promise<void>;
  discardRecovery(id: string): Promise<void>;
  getDefaultSettings(): Promise<Record<string, unknown>>;
  saveSettings(settings: Record<string, unknown>): Promise<void>;
  resetSettings(): Promise<void>;
  savePersistentState(state: Record<string, unknown>): Promise<Record<string, unknown>>;
  clearPersistentState(): Promise<Record<string, unknown>>;
  getSettingsPath(): Promise<string>;
  getSettingsDisplayPath(): Promise<string>;
  getSystemLocale(): Promise<string>;
  getSystemTheme(): Promise<string>;
  isFullscreen(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  getInfo(): Promise<FileInfo>;
  setZoomFactor(zoom: number): Promise<void>;
  readClipboard(): Promise<{ text: string; html: string }>;
  writeClipboard(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  showItemInFolder(filePath: string): Promise<void>;
  openDirectory(dirPath: string): Promise<void>;
  isResourceHealthEligible(documentPath: string, workspacePath: string): Promise<boolean>;
  scanResourceHealth(
    documentPath: string,
    workspacePath: string,
  ): Promise<ResourceHealthScanSummary>;
  revealResourceHealthCandidate(revision: string, candidateId: string): Promise<void>;
  previewResourceHealthCandidate(revision: string, candidateId: string): Promise<string | null>;
  trashResourceHealthCandidates(
    revision: string,
    candidateIds: string[],
  ): Promise<readonly ResourceHealthActionResult[]>;
  discardResourceHealthScans(): void;
  exportPDF(html: string, defaultPath?: string, defaultDirectory?: string): Promise<string | null>;
  toggleFullscreen(): void;
  onMenuAction(callback: (action: string, value?: string) => void): Unsubscribe;
  onSystemThemeChanged(callback: (theme: string) => void): Unsubscribe;
  onRequestClose(callback: () => void): Unsubscribe;
  onFullscreenChanged(callback: (fullscreen: boolean) => void): Unsubscribe;
  onMaximizedChanged(callback: (maximized: boolean) => void): Unsubscribe;
  onOpenFiles(callback: (paths: string[]) => void): Unsubscribe;
  rendererReady(): void;
  closeConfirmed(): void;
  minimize(): void;
  maximize(): void;
  closeWindow(): void;
  toggleDevTools(): void;
}
