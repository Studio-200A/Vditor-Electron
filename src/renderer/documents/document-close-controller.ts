export interface ClosableDocument {
  readonly id: string;
}

export interface DocumentCloseCallbacks<TDocument extends ClosableDocument> {
  confirmClose(document: TDocument): Promise<boolean>;
  disposeRuntime(document: TDocument): Promise<void>;
  removeDocument(document: TDocument): void;
  afterClose(document: TDocument): Promise<void>;
}

/** Coordinates the required close order without owning editor runtime details. */
export class DocumentCloseController {
  private readonly closing = new Map<string, Promise<boolean>>();

  async close<TDocument extends ClosableDocument>(
    document: TDocument,
    callbacks: DocumentCloseCallbacks<TDocument>,
  ): Promise<boolean> {
    const existing = this.closing.get(document.id);
    if (existing) return existing;
    const closing = this.closeOnce(document, callbacks);
    this.closing.set(document.id, closing);
    try {
      return await closing;
    } finally {
      if (this.closing.get(document.id) === closing) this.closing.delete(document.id);
    }
  }

  private async closeOnce<TDocument extends ClosableDocument>(
    document: TDocument,
    callbacks: DocumentCloseCallbacks<TDocument>,
  ): Promise<boolean> {
    if (!(await callbacks.confirmClose(document))) return false;
    await callbacks.disposeRuntime(document);
    callbacks.removeDocument(document);
    await callbacks.afterClose(document);
    return true;
  }
}
