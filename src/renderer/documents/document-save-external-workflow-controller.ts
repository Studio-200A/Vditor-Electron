export interface SaveWorkflowFileState {
  readonly kind: 'deleted' | 'reappeared' | 'unreadable';
  readonly path: string;
  readonly identity: string | null;
  readonly content?: string;
  readonly encoding?: string;
  readonly clipboardContent?: string;
  readonly version: number;
}

export interface SaveWorkflowConflict {
  readonly identity: string | null;
  readonly content?: string;
  readonly encoding?: string;
  readonly version: number;
}

export interface SaveWorkflowDocument {
  readonly id: string;
  readonly title: string;
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly baseDir: string;
  readonly encoding: string;
  readonly lineEnding: 'LF' | 'CRLF';
  readonly expectedSavedContent: string;
  readonly contentRevision: number;
  readonly externalChangeIgnored: boolean;
  readonly externalConflict: SaveWorkflowConflict | null;
  readonly externalFileState: SaveWorkflowFileState | null;
}

export interface DocumentSaveExternalWorkflowControllerOptions<
  TDocument extends SaveWorkflowDocument,
> {
  readonly getDocuments: () => readonly TDocument[];
  readonly getActiveDocumentId: () => string | null;
  readonly fileIdentityOf: (document: TDocument) => string | null;
  readonly saveDocument: <TResult>(
    document: TDocument,
    operation: () => Promise<TResult>,
  ) => Promise<TResult>;
  readonly saveForIdentity: <TResult>(
    identity: string | null,
    operation: () => Promise<TResult>,
  ) => Promise<TResult>;
  readonly fileName: (filePath: string) => string;
  readonly saveFileDialog: (
    defaultName: string,
    defaultDirectory?: string,
  ) => Promise<string | null>;
  readonly fileIdentity: (filePath: string) => Promise<string | null>;
  readonly exists: (filePath: string) => Promise<boolean>;
  readonly readFile: (filePath: string) => Promise<{ content: string; encoding: string }>;
  readonly writeDocument: (
    filePath: string,
    content: string,
    expectedContent?: string,
    expectedAbsent?: boolean,
  ) => Promise<{
    expectedContent: string;
    error?: 'external-change' | 'permission-denied' | 'write-failed';
    content?: string;
    encoding?: string;
  }>;
  readonly dirname: (filePath: string) => Promise<string>;
  readonly resolveRenamedDocument: (filePath: string) => Promise<string | null>;
  readonly reconcileRenamedDocument: (
    document: TDocument,
    destination: string,
    identity: string | null,
  ) => Promise<boolean>;
  readonly suspendWatches: (documents: readonly TDocument[]) => Promise<void>;
  readonly rebindWatches: (documents: readonly TDocument[]) => Promise<void>;
  readonly releaseWatch: (filePath: string | null, identity: string | null) => Promise<void>;
  readonly watchDocument: (document: TDocument) => Promise<void>;
  readonly contentForPersistence: (document: TDocument) => string;
  readonly currentContent: (document: TDocument) => string;
  readonly beginExternalChange: (document: TDocument) => void;
  readonly cancelAutoSave: (document: TDocument) => void;
  readonly applyExternalContent: (document: TDocument, content: string) => void;
  readonly updateDocument: (document: TDocument, updates: Record<string, unknown>) => void;
  readonly createConflict: (
    document: TDocument,
    state: { path: string; identity: string | null; content?: string; encoding?: string },
  ) => void;
  readonly preserveUnavailable: (
    document: TDocument,
    kind: 'deleted' | 'unreadable',
    path: string,
    error?: string,
  ) => Promise<void>;
  readonly discardRecovery: (document: TDocument) => Promise<void>;
  readonly clearRecoveryState: (document: TDocument) => void;
  readonly scheduleRecovery: (document: TDocument) => void;
  readonly syncResources: () => Promise<void>;
  readonly rebuildEditor: (document: TDocument) => void;
  readonly rememberRecent: (filePath: string) => void;
  readonly refreshTree: () => Promise<void>;
  readonly hasWorkspace: () => boolean;
  readonly nextUntitledTitle: () => string;
  readonly recreateClipboardSnapshot: (document: TDocument) => string;
  readonly writeClipboard: (content: string) => Promise<void>;
  readonly detectLineEnding: (content: string) => 'LF' | 'CRLF';
  readonly confirm: (
    kind: 'overwrite' | 'recreate',
    document: TDocument,
    path?: string,
  ) => Promise<boolean>;
  readonly showMessage: (
    key:
      | 'saved'
      | 'path-open'
      | 'resolve-file-state'
      | 'resolve-conflict'
      | 'changed-again'
      | 'permission-denied'
      | 'save-failed'
      | 'reloaded'
      | 'ignored'
      | 'recreated'
      | 'recreated-copied'
      | 'recreated-clipboard-failed',
    document: TDocument,
    error?: unknown,
  ) => void;
  readonly showRecreateNotice: (
    key: 'recreated' | 'recreated-copied' | 'recreated-clipboard-failed',
  ) => void;
  readonly finish: () => void;
}

/** Owns safe document writes and the explicit actions that resolve external file states. */
export class DocumentSaveExternalWorkflowController<TDocument extends SaveWorkflowDocument> {
  private readonly unavailableClipboard = new Map<string, string>();

  constructor(private readonly options: DocumentSaveExternalWorkflowControllerOptions<TDocument>) {}

  async save(
    document: TDocument,
    saveAs = false,
    overwriteVersion: number | null = null,
    recreateVersion: number | null = null,
  ): Promise<boolean> {
    return this.performSave(document, saveAs, overwriteVersion, recreateVersion, null, null);
  }

  async reloadExternalChange(document: TDocument | null): Promise<void> {
    const conflict = document?.externalConflict;
    if (!document || !conflict || typeof conflict.content !== 'string') return;
    const identity = conflict.identity || this.options.fileIdentityOf(document);
    for (const item of this.relatedDocuments(document, identity)) {
      this.options.updateDocument(item, {
        content: conflict.content,
        savedContent: conflict.content,
        expectedSavedContent: conflict.content,
        modified: false,
        encoding: conflict.encoding || item.encoding,
        lineEnding: this.options.detectLineEnding(conflict.content),
        externalConflict: null,
        externalChangeIgnored: false,
      });
      this.options.applyExternalContent(item, conflict.content);
    }
    this.options.finish();
    this.options.showMessage('reloaded', document);
  }

  async reloadReappearedFile(document: TDocument | null): Promise<void> {
    const state = document?.externalFileState;
    if (!document || state?.kind !== 'reappeared' || typeof state.content !== 'string') return;
    const identity = state.identity || this.options.fileIdentityOf(document);
    for (const item of this.relatedDocuments(document, identity)) {
      this.options.updateDocument(item, {
        content: state.content,
        savedContent: state.content,
        expectedSavedContent: state.content,
        modified: false,
        encoding: state.encoding || item.encoding,
        lineEnding: this.options.detectLineEnding(state.content),
        externalConflict: null,
        externalChangeIgnored: false,
        externalFileState: null,
      });
      this.options.applyExternalContent(item, state.content);
      await this.options.discardRecovery(item);
    }
    this.options.finish();
    this.options.showMessage('reloaded', document);
  }

  async recreateFile(document: TDocument | null): Promise<boolean> {
    if (!document) return false;
    return this.confirmRecreate(document, (version) =>
      this.options.saveDocument(document, () =>
        this.performSave(document, false, null, version, null, document.filePath),
      ),
    );
  }

  async preserveUnavailable(
    document: TDocument,
    kind: 'deleted' | 'unreadable',
    path: string,
    error?: string,
  ): Promise<void> {
    const clipboardContent = this.options.recreateClipboardSnapshot(document);
    await this.options.preserveUnavailable(document, kind, path, error);
    this.unavailableClipboard.set(document.id, clipboardContent);
    const state = document.externalFileState;
    if (state && !state.clipboardContent)
      this.options.updateDocument(document, {
        externalFileState: { ...state, clipboardContent },
      });
  }

  async confirmExternalOverwrite(document: TDocument | null): Promise<boolean> {
    if (!document?.externalConflict || !document.filePath) return false;
    return this.confirmOverwrite(document, document.fileIdentity, document.filePath);
  }

  async keepAsUntitled(document: TDocument | null): Promise<void> {
    if (!document?.externalFileState) return;
    const previousPath = document.filePath;
    const previousIdentity = document.fileIdentity;
    this.options.cancelAutoSave(document);
    this.options.updateDocument(document, {
      filePath: null,
      fileIdentity: null,
      baseDir: '',
      title: this.options.nextUntitledTitle(),
      savedContent: '',
      expectedSavedContent: '',
      modified: this.options.currentContent(document) !== '',
      externalConflict: null,
      externalChangeIgnored: false,
      externalFileState: null,
    });
    await this.options.releaseWatch(previousPath, previousIdentity);
    await this.options.syncResources();
    this.options.scheduleRecovery(document);
    this.options.finish();
  }

  ignoreExternalChange(document: TDocument | null): void {
    if (!document?.externalConflict) return;
    this.options.updateDocument(document, { externalChangeIgnored: true });
    this.options.finish();
    this.options.showMessage('ignored', document);
  }

  private async performSave(
    document: TDocument,
    saveAs: boolean,
    overwriteVersion: number | null,
    recreateVersion: number | null,
    queuedIdentity: string | null,
    selectedDestination: string | null,
  ): Promise<boolean> {
    if (!this.options.getDocuments().includes(document)) return false;
    const previousPath = document.filePath;
    const previousIdentity = document.fileIdentity;
    let destination = selectedDestination || document.filePath;
    if (!destination || (saveAs && !selectedDestination))
      destination = await this.options.saveFileDialog(destination || `${document.title}.md`);
    if (!destination) return false;
    const destinationIdentity = await this.options.fileIdentity(destination);
    const fileState = document.externalFileState;
    if (
      saveAs &&
      fileState?.identity === destinationIdentity &&
      recreateVersion !== fileState.version
    )
      return this.confirmRecreate(document, (version) =>
        this.performSave(document, false, null, version, queuedIdentity, destination),
      );
    if (queuedIdentity !== destinationIdentity)
      return this.options.saveForIdentity(destinationIdentity, () =>
        this.performSave(
          document,
          saveAs,
          overwriteVersion,
          recreateVersion,
          destinationIdentity,
          destination,
        ),
      );
    const occupied = this.options
      .getDocuments()
      .find(
        (item) => item !== document && this.options.fileIdentityOf(item) === destinationIdentity,
      );
    if (occupied) {
      this.options.showMessage('path-open', occupied);
      return false;
    }
    const conflict = document.externalConflict;
    const writesConflictedPath = Boolean(conflict && conflict.identity === destinationIdentity);
    const writesUnavailablePath = Boolean(fileState && fileState.identity === destinationIdentity);
    if (writesUnavailablePath && recreateVersion !== fileState?.version) {
      if (await this.reconcileRename(document, destination, destinationIdentity))
        return this.performSave(document, saveAs, overwriteVersion, null, null, document.filePath);
      this.options.showMessage('resolve-file-state', document);
      return false;
    }
    if (writesConflictedPath && overwriteVersion === null) {
      if (document.externalChangeIgnored)
        return this.confirmOverwrite(document, destinationIdentity, destination, false);
      this.options.showMessage('resolve-conflict', document);
      return false;
    }
    if (writesConflictedPath && overwriteVersion !== conflict?.version) {
      this.options.showMessage('changed-again', document);
      return false;
    }
    if (
      document.filePath &&
      document.fileIdentity === destinationIdentity &&
      !fileState &&
      !conflict
    ) {
      if (!(await this.options.exists(destination))) {
        if (await this.reconcileRename(document, destination, destinationIdentity))
          return this.performSave(
            document,
            saveAs,
            overwriteVersion,
            null,
            null,
            document.filePath,
          );
        await this.preserveUnavailable(document, 'deleted', destination);
        this.options.finish();
        return false;
      }
      try {
        const disk = await this.options.readFile(destination);
        if (disk.content !== document.expectedSavedContent) {
          this.options.beginExternalChange(document);
          this.options.createConflict(document, {
            path: destination,
            identity: destinationIdentity,
            content: disk.content,
            encoding: disk.encoding || document.encoding,
          });
          this.options.finish();
          return false;
        }
      } catch {
        await this.preserveUnavailable(document, 'unreadable', destination);
        this.options.finish();
        return false;
      }
    }
    const destinationChanged = Boolean(previousPath) && previousIdentity !== destinationIdentity;
    let watchesSuspended = false;
    try {
      if (destinationChanged) {
        await this.options.suspendWatches([document]);
        watchesSuspended = true;
      }
      const content = this.options.contentForPersistence(document);
      const diskContent =
        document.lineEnding === 'CRLF'
          ? content.replace(/\r?\n/g, '\r\n')
          : content.replace(/\r\n/g, '\n');
      const savedRevision = document.contentRevision;
      const expectation = await this.expectedWrite(
        document,
        destination,
        destinationIdentity,
        fileState,
        conflict,
        writesUnavailablePath,
      );
      if (!this.isCurrent(document, previousPath, previousIdentity)) return false;
      const result = await this.options.writeDocument(
        destination,
        diskContent,
        expectation.expectedContent,
        expectation.expectedAbsent,
      );
      if (!this.isCurrent(document, previousPath, previousIdentity)) return false;
      if (result.error) {
        if (result.error === 'external-change') {
          this.options.beginExternalChange(document);
          this.options.createConflict(document, {
            path: destination,
            identity: destinationIdentity,
            content: result.content,
            encoding: result.encoding || document.encoding,
          });
          this.options.finish();
        } else
          this.options.showMessage(
            result.error === 'permission-denied' ? 'permission-denied' : 'save-failed',
            document,
          );
        if (watchesSuspended) await this.options.rebindWatches([document]);
        return false;
      }
      const baseDir = await this.options.dirname(destination);
      if (!this.isCurrent(document, previousPath, previousIdentity)) return false;
      const previousBaseDir = document.baseDir;
      this.options.updateDocument(document, {
        filePath: destination,
        fileIdentity: destinationIdentity,
        title: this.options.fileName(destination),
        content,
        savedContent: content,
        expectedSavedContent: result.expectedContent,
        modified: document.contentRevision !== savedRevision,
        externalConflict: null,
        externalChangeIgnored: false,
        externalFileState: null,
        encoding: 'utf-8',
        baseDir,
      });
      await this.options.releaseWatch(previousPath, previousIdentity);
      await this.options.syncResources();
      await this.options.watchDocument(document);
      if (document.contentRevision === savedRevision) {
        await this.options.discardRecovery(document);
        this.options.clearRecoveryState(document);
      } else this.options.scheduleRecovery(document);
      if (previousBaseDir !== document.baseDir) this.options.rebuildEditor(document);
      this.options.rememberRecent(destination);
      if (this.options.hasWorkspace() && (!previousPath || saveAs || previousPath !== destination))
        await this.options.refreshTree();
      this.options.finish();
      this.options.showMessage('saved', document);
      return true;
    } catch (error) {
      if (watchesSuspended) await this.options.rebindWatches([document]);
      this.options.showMessage('save-failed', document, error);
      return false;
    }
  }

  private async expectedWrite(
    document: TDocument,
    destination: string,
    identity: string | null,
    state: SaveWorkflowFileState | null,
    conflict: SaveWorkflowConflict | null,
    unavailable: boolean,
  ): Promise<{ expectedContent?: string; expectedAbsent: boolean }> {
    if (document.filePath && document.fileIdentity === identity && !state && !conflict)
      return { expectedContent: document.expectedSavedContent, expectedAbsent: false };
    if (unavailable)
      return state?.kind === 'reappeared' && typeof state.content === 'string'
        ? { expectedContent: state.content, expectedAbsent: false }
        : { expectedAbsent: true };
    if (await this.options.exists(destination))
      return {
        expectedContent: (await this.options.readFile(destination)).content,
        expectedAbsent: false,
      };
    return { expectedAbsent: true };
  }

  private isCurrent(document: TDocument, path: string | null, identity: string | null): boolean {
    return (
      this.options.getDocuments().includes(document) &&
      document.filePath === path &&
      document.fileIdentity === identity
    );
  }

  private async reconcileRename(
    document: TDocument,
    destination: string,
    identity: string | null,
  ): Promise<boolean> {
    if (!document.filePath) return false;
    const renamed = await this.options.resolveRenamedDocument(document.filePath);
    return Boolean(
      renamed && (await this.options.reconcileRenamedDocument(document, renamed, identity)),
    );
  }

  private async confirmOverwrite(
    document: TDocument,
    identity: string | null,
    destination: string,
    serialize = true,
  ): Promise<boolean> {
    const conflict = document.externalConflict;
    if (!conflict || !(await this.options.confirm('overwrite', document))) return false;
    if (document.externalConflict?.version !== conflict.version) {
      this.options.showMessage('changed-again', document);
      return false;
    }
    const save = () =>
      this.performSave(document, false, conflict.version, null, identity, destination);
    return serialize ? this.options.saveDocument(document, save) : save();
  }

  private async confirmRecreate(
    document: TDocument,
    recreate: (version: number) => Promise<boolean>,
  ): Promise<boolean> {
    const state = document.externalFileState;
    if (
      !state ||
      state.kind === 'unreadable' ||
      !(await this.options.confirm('recreate', document, state.path))
    )
      return false;
    if (document.externalFileState?.version !== state.version) {
      this.options.showMessage('changed-again', document);
      return false;
    }
    // Saving clears the unavailable state, so preserve its recovery text before I/O.
    const clipboardContent =
      state.clipboardContent ||
      this.unavailableClipboard.get(document.id) ||
      this.options.recreateClipboardSnapshot(document);
    const recreated = await recreate(state.version);
    if (!recreated) return false;
    this.unavailableClipboard.delete(document.id);
    if (!clipboardContent) {
      this.options.showMessage('recreated', document);
      this.options.showRecreateNotice('recreated');
      return true;
    }
    try {
      await this.options.writeClipboard(clipboardContent);
      this.options.showMessage('recreated-copied', document);
      this.options.showRecreateNotice('recreated-copied');
    } catch {
      this.options.showMessage('recreated-clipboard-failed', document);
      this.options.showRecreateNotice('recreated-clipboard-failed');
    }
    return true;
  }

  private relatedDocuments(document: TDocument, identity: string | null): readonly TDocument[] {
    return this.options
      .getDocuments()
      .filter(
        (item) => item === document || (identity && this.options.fileIdentityOf(item) === identity),
      );
  }
}
