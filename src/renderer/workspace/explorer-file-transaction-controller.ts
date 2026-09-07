import type { DocumentBindingTransition } from '../documents/document-binding-transition.js';
import type { ExplorerEntry } from './explorer-controller.js';

export interface ExplorerTransactionDocument {
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
  readonly baseDir: string;
}

export interface ExplorerPathState {
  readonly recentFiles?: readonly { readonly path: string; readonly title: string }[];
  readonly workspaceTreeStates?: readonly {
    readonly workspacePath: string;
    readonly expandedPaths: readonly string[];
  }[];
}

interface RebasedDocument<TDocument> {
  readonly document: TDocument;
  readonly nextPath: string;
  readonly fileIdentity: string | null;
  readonly baseDir: string;
}

export interface ExplorerFileTransactionControllerOptions<
  TDocument extends ExplorerTransactionDocument,
> {
  readonly fileAPI: {
    createItem(parentPath: string, name: string, type: 'file' | 'directory'): Promise<string>;
    prepareRename(path: string, name: string): Promise<string>;
    renameItem(path: string, name: string): Promise<string>;
    deleteItem(path: string): Promise<void>;
    rebasePath(oldRoot: string, newRoot: string, candidatePath: string): Promise<string>;
    fileIdentity(path: string): Promise<string | null>;
    dirname(path: string): Promise<string>;
  };
  readonly getDocuments: () => readonly TDocument[];
  readonly nextUntitledName: (parentPath: string, type: 'file' | 'directory') => Promise<string>;
  readonly fileName: (path: string) => string;
  readonly openPath: (path: string) => Promise<void>;
  readonly confirmDelete: (entry: ExplorerEntry) => Promise<boolean>;
  readonly getPathState: () => ExplorerPathState;
  readonly applyPathState: (state: Required<ExplorerPathState>) => void;
  readonly persistPathState: (state: Required<ExplorerPathState>) => Promise<void>;
  readonly suspendWatches: (documents: readonly TDocument[]) => Promise<void>;
  readonly rebindWatches: (documents: readonly TDocument[]) => Promise<void>;
  readonly transitionBindings: <TResult>(
    transition: DocumentBindingTransition<TResult>,
  ) => Promise<TResult>;
  readonly updateDocumentBinding: (
    document: TDocument,
    binding: Omit<RebasedDocument<TDocument>, 'document'>,
  ) => void;
  readonly preserveDeletedDocument: (document: TDocument) => Promise<void>;
  readonly syncLocalResourceRoots: () => Promise<void>;
  readonly rebuildEditors: (documents: ReadonlySet<TDocument>) => readonly unknown[];
  readonly renderDocuments: () => void;
  readonly updateActiveDocumentUI: () => void;
  readonly refreshTree: () => Promise<void>;
  readonly persistSession: (throwOnFailure?: boolean) => Promise<void>;
  readonly showError: (error: unknown) => void;
}

/** Coordinates Explorer filesystem changes with document bindings without owning watchers or editors. */
export class ExplorerFileTransactionController<TDocument extends ExplorerTransactionDocument> {
  constructor(private readonly options: ExplorerFileTransactionControllerOptions<TDocument>) {}

  async create(parentPath: string, type: 'file' | 'directory'): Promise<void> {
    if (!parentPath) return;
    try {
      const created = await this.options.fileAPI.createItem(
        parentPath,
        await this.options.nextUntitledName(parentPath, type),
        type,
      );
      await this.options.refreshTree();
      if (type === 'file') await this.options.openPath(created);
    } catch (error) {
      this.options.showError(error);
    }
  }

  async rename(entry: ExplorerEntry, name: string): Promise<void> {
    let affectedDocuments: TDocument[] = [];
    const rebuilt = new Set<TDocument>();
    let filesystemCommitted = false;
    let pathState: Required<ExplorerPathState> | null = null;
    let pathStatePersisted = false;
    try {
      affectedDocuments = (await this.rebasedDocuments(entry.path, entry.path)).map(
        ({ document }) => document,
      );
      const destination = await this.options.fileAPI.prepareRename(entry.path, name);
      const bindings = await this.rebasedDocuments(entry.path, destination);
      pathState = await this.rebasedPathState(entry.path, destination);
      await this.options.suspendWatches(affectedDocuments);
      const renamed = await this.options.fileAPI.renameItem(entry.path, name);
      filesystemCommitted = true;
      if (renamed !== destination)
        throw new Error('The rename destination changed before the operation completed.');
      await this.options.transitionBindings({
        prepare: async () => bindings,
        commit: async (plans) => {
          for (const plan of plans) {
            const previousBaseDir = plan.document.baseDir;
            this.options.updateDocumentBinding(plan.document, plan);
            if (previousBaseDir !== plan.document.baseDir) rebuilt.add(plan.document);
          }
        },
      });
      this.options.applyPathState(pathState);
      await this.options.syncLocalResourceRoots();
      await this.options.persistPathState(pathState);
      pathStatePersisted = true;
      await this.options.rebindWatches(affectedDocuments);
      this.throwRebuildFailures(rebuilt, 'Unable to rebuild every renamed document.');
      this.options.renderDocuments();
      await this.options.refreshTree();
      await this.options.persistSession();
    } catch (error) {
      const failures: unknown[] = [error];
      try {
        await this.options.rebindWatches(affectedDocuments);
      } catch (rebindError) {
        failures.push(rebindError);
      }
      if (filesystemCommitted) {
        await this.recoverRename(pathState, pathStatePersisted, rebuilt, failures);
      } else {
        try {
          await this.options.refreshTree();
        } catch (refreshError) {
          failures.push(refreshError);
        }
      }
      this.options.showError(new AggregateError(failures, 'Unable to rename Explorer item.'));
    }
  }

  async delete(entry: ExplorerEntry): Promise<void> {
    if (!(await this.options.confirmDelete(entry))) return;
    let documents: TDocument[] = [];
    try {
      documents = (await this.rebasedDocuments(entry.path, entry.path)).map(
        ({ document }) => document,
      );
      await this.options.suspendWatches(documents);
      await this.options.fileAPI.deleteItem(entry.path);
      for (const document of documents)
        await this.options.transitionBindings({
          prepare: async () => document,
          commit: async (prepared) => this.options.preserveDeletedDocument(prepared),
        });
      await this.options.rebindWatches(documents);
      this.options.renderDocuments();
      this.options.updateActiveDocumentUI();
      await this.options.persistSession();
      await this.options.refreshTree();
    } catch (error) {
      try {
        await this.options.rebindWatches(documents);
      } catch (rebindError) {
        this.options.showError(
          new AggregateError([error, rebindError], 'Unable to delete Explorer item.'),
        );
        return;
      }
      this.options.showError(error);
    }
  }

  private async rebasedDocuments(
    oldRoot: string,
    newRoot: string,
  ): Promise<RebasedDocument<TDocument>[]> {
    const plans: RebasedDocument<TDocument>[] = [];
    for (const document of this.options.getDocuments()) {
      if (!document.filePath) continue;
      const nextPath = await this.options.fileAPI.rebasePath(oldRoot, newRoot, document.filePath);
      if (!nextPath) continue;
      plans.push({
        document,
        nextPath,
        fileIdentity: await this.options.fileAPI.fileIdentity(nextPath),
        baseDir: await this.options.fileAPI.dirname(nextPath),
      });
    }
    return plans;
  }

  private async rebasedPathState(
    oldRoot: string,
    newRoot: string,
  ): Promise<Required<ExplorerPathState>> {
    const state = this.options.getPathState();
    const recentFiles = await Promise.all(
      (state.recentFiles ?? []).map(async (item) => {
        const path = await this.options.fileAPI.rebasePath(oldRoot, newRoot, item.path);
        return path ? { ...item, path, title: this.options.fileName(path) } : item;
      }),
    );
    const workspaceTreeStates = await Promise.all(
      (state.workspaceTreeStates ?? []).map(async (item) => ({
        ...item,
        workspacePath:
          (await this.options.fileAPI.rebasePath(oldRoot, newRoot, item.workspacePath)) ||
          item.workspacePath,
        expandedPaths: await Promise.all(
          item.expandedPaths.map(
            async (path) => (await this.options.fileAPI.rebasePath(oldRoot, newRoot, path)) || path,
          ),
        ),
      })),
    );
    return { recentFiles, workspaceTreeStates };
  }

  private async recoverRename(
    pathState: Required<ExplorerPathState> | null,
    pathStatePersisted: boolean,
    rebuilt: ReadonlySet<TDocument>,
    failures: unknown[],
  ): Promise<void> {
    try {
      await this.options.syncLocalResourceRoots();
    } catch (error) {
      failures.push(error);
    }
    failures.push(...this.options.rebuildEditors(rebuilt));
    if (!pathStatePersisted && pathState) {
      try {
        await this.options.persistPathState(pathState);
      } catch (error) {
        failures.push(error);
      }
    }
    this.options.renderDocuments();
    try {
      await this.options.refreshTree();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.options.persistSession(true);
    } catch (error) {
      failures.push(error);
    }
  }

  private throwRebuildFailures(documents: ReadonlySet<TDocument>, message: string): void {
    const failures = this.options.rebuildEditors(documents);
    if (failures.length) throw new AggregateError(failures, message);
  }
}
