/** Serializes save operations per document and releases completed operation handles. */
export class DocumentSaveController {
  private readonly operations = new Map<string, Promise<void>>();
  private readonly identityOperations = new Map<string, Promise<void>>();

  run<TResult>(documentId: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = this.operations.get(documentId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tracked = current.then(
      () => undefined,
      () => undefined,
    );
    this.operations.set(documentId, tracked);
    void tracked.finally(() => {
      if (this.operations.get(documentId) === tracked) this.operations.delete(documentId);
    });
    return current;
  }

  clear(documentId: string): void {
    this.operations.delete(documentId);
  }

  runForIdentity<TResult>(identity: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = this.identityOperations.get(identity) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tracked = current.then(
      () => undefined,
      () => undefined,
    );
    this.identityOperations.set(identity, tracked);
    void tracked.finally(() => {
      if (this.identityOperations.get(identity) === tracked)
        this.identityOperations.delete(identity);
    });
    return current;
  }
}
