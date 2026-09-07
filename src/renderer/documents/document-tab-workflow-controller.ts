import type { DocumentCloseCallbacks } from './document-close-controller.js';
import type { DocumentController, OpenedDocument } from './document-controller.js';

export interface DocumentTabWorkflowControllerOptions<TDocument extends OpenedDocument> {
  readonly documentController: DocumentController<TDocument>;
  readonly getDocuments: () => readonly TDocument[];
  readonly getDocument: (id: string) => TDocument | null;
  readonly getActiveDocumentId: () => string | null;
  readonly createUntitledTitle: () => Promise<string>;
  readonly activate: (id: string) => void;
  readonly reportOpenFailure: (error: unknown) => void;
  readonly confirmClose: (document: TDocument, discard: boolean) => Promise<boolean>;
  readonly disposeRuntime: (document: TDocument) => Promise<void>;
  readonly removeDocument: (document: TDocument) => void;
  readonly finishClose: (document: TDocument, index: number, wasActive: boolean) => Promise<void>;
}

/** Owns document command order; tab rendering and editor activation stay in their domains. */
export class DocumentTabWorkflowController<TDocument extends OpenedDocument> {
  constructor(private readonly options: DocumentTabWorkflowControllerOptions<TDocument>) {}

  async openPath(filePath: string, activate = true, pendingAnchor = ''): Promise<TDocument | null> {
    try {
      return await this.options.documentController.openPath(filePath, activate, pendingAnchor);
    } catch (error) {
      this.options.reportOpenFailure(error);
      return null;
    }
  }

  async openPaths(paths: readonly string[]): Promise<void> {
    for (const filePath of paths) await this.openPath(filePath, false);
    const lastPath = paths.at(-1);
    const document = lastPath
      ? this.options.getDocuments().find((item) => item.filePath === lastPath)
      : null;
    if (document) this.activate(document.id);
  }

  async createUntitled(): Promise<TDocument | null> {
    return this.options.documentController.createUntitled(await this.options.createUntitledTitle());
  }

  activate(id: string): void {
    this.options.activate(id);
  }

  async close(id: string, discard = false): Promise<boolean> {
    const document = this.options.getDocument(id);
    if (!document) return false;
    const index = this.options.getDocuments().indexOf(document);
    const wasActive = this.options.getActiveDocumentId() === id;
    const callbacks: DocumentCloseCallbacks<TDocument> = {
      confirmClose: (candidate) => this.options.confirmClose(candidate, discard),
      // DocumentCloseController preserves runtime release before Store removal.
      disposeRuntime: this.options.disposeRuntime,
      removeDocument: this.options.removeDocument,
      afterClose: (candidate) => this.options.finishClose(candidate, index, wasActive),
    };
    return this.options.documentController.close(document, callbacks);
  }
}
