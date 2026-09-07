export interface WatchedDocument {
  readonly filePath: string | null;
  readonly fileIdentity: string | null;
}

export interface DocumentWatchControllerOptions<TDocument extends WatchedDocument> {
  readonly getDocuments: () => readonly TDocument[];
  readonly fileIdentity: (filePath: string) => Promise<string | null>;
  readonly watch: (filePath: string, reconcile: boolean) => Promise<void>;
  readonly unwatch: (filePath: string, identity: string | null) => Promise<void>;
  readonly updateIdentity: (document: TDocument, identity: string | null) => void;
  readonly identityOf: (document: TDocument) => string | null;
}

/** Owns watcher suspension and rebind cleanup without changing document bindings itself. */
export class DocumentWatchController<TDocument extends WatchedDocument> {
  constructor(private readonly options: DocumentWatchControllerOptions<TDocument>) {}

  async watchDocument(document: TDocument): Promise<void> {
    if (!document.filePath) return;
    const filePath = document.filePath;
    const identity = await this.options.fileIdentity(filePath);
    if (!this.options.getDocuments().includes(document) || document.filePath !== filePath) return;
    this.options.updateIdentity(document, identity);
    await this.options.watch(filePath, true);
    if (
      !this.options.getDocuments().includes(document) ||
      document.filePath !== filePath ||
      document.fileIdentity !== identity
    )
      await this.release(filePath, identity);
  }

  async release(filePath: string | null, identity: string | null): Promise<void> {
    if (!filePath) return;
    const resolvedIdentity = identity ?? (await this.options.fileIdentity(filePath));
    if (
      !this.options
        .getDocuments()
        .some((document) => this.options.identityOf(document) === resolvedIdentity)
    )
      await this.options.unwatch(filePath, resolvedIdentity);
  }

  async suspend(documents: readonly TDocument[]): Promise<void> {
    const paths = new Map<string | null, string>();
    for (const document of documents) {
      if (document.filePath) paths.set(this.options.identityOf(document), document.filePath);
    }
    for (const [identity, filePath] of paths) {
      const openOutsideAffected = this.options
        .getDocuments()
        .some(
          (document) =>
            !documents.includes(document) && this.options.identityOf(document) === identity,
        );
      if (!openOutsideAffected) await this.options.unwatch(filePath, identity);
    }
  }

  async rebind(documents: readonly TDocument[]): Promise<void> {
    const byIdentity = new Map<string | null, TDocument>();
    for (const document of documents) {
      if (document.filePath) byIdentity.set(this.options.identityOf(document), document);
    }
    let pending = [...byIdentity.values()];
    let failures: unknown[] = [];
    for (let attempt = 0; attempt < 2 && pending.length; attempt += 1) {
      const next: TDocument[] = [];
      failures = [];
      for (const document of pending) {
        try {
          await this.watchDocument(document);
        } catch (error) {
          failures.push(error);
          next.push(document);
        }
      }
      pending = next;
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `Unable to restore ${failures.length} document watcher(s).`,
      );
  }
}
